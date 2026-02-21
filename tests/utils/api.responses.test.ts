import { describe, expect, it } from 'vitest';
import {
  buildResponsesReasoning,
  buildResponsesInput,
  buildSessionHeaders,
  parseResponsesStreamEvent,
  type ApiMessage,
} from '../../utils/api';
import type { AIProvider } from '../../utils/storage';

describe('buildResponsesInput', () => {
  it('应正确转换用户多模态消息、工具调用与工具输出', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'system prompt' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '你好' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_001',
            type: 'function',
            function: {
              name: 'extract_page_content',
              arguments: '{}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_001',
        content: '{"ok":true}',
      },
    ];

    const input = buildResponsesInput(messages);

    expect(input).toEqual([
      {
        type: 'message',
        role: 'developer',
        content: 'system prompt',
      },
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: '你好' },
          { type: 'input_image', image_url: 'data:image/png;base64,abc' },
        ],
      },
      {
        type: 'function_call',
        call_id: 'call_001',
        name: 'extract_page_content',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_001',
        output: '{"ok":true}',
      },
    ]);
  });

  it('应跳过没有对应 function_call 的 function_call_output', () => {
    const messages: ApiMessage[] = [
      {
        role: 'tool',
        tool_call_id: 'call_orphan',
        content: '{"ok":false}',
      },
    ];

    const input = buildResponsesInput(messages);
    expect(input).toEqual([]);
  });
});

describe('buildSessionHeaders', () => {
  it('应在 sessionKey 存在时注入两个兼容 header', () => {
    const headers = buildSessionHeaders('  sess-123  ');
    expect(headers).toEqual({
      session_id: 'sess-123',
      'x-session-id': 'sess-123',
    });
  });

  it('应在 sessionKey 为空时返回 undefined', () => {
    expect(buildSessionHeaders('   ')).toBeUndefined();
    expect(buildSessionHeaders(undefined)).toBeUndefined();
  });
});

describe('parseResponsesStreamEvent', () => {
  it('应解析文本增量事件', () => {
    const parsed = parseResponsesStreamEvent({
      type: 'response.output_text.delta',
      delta: 'hello',
      response_id: 'resp_1',
    });

    expect(parsed.responseId).toBe('resp_1');
    expect(parsed.contentDelta).toBe('hello');
  });

  it('应解析函数参数完成事件', () => {
    const parsed = parseResponsesStreamEvent({
      type: 'response.function_call_arguments.done',
      call_id: 'call_1',
      name: 'extract_page_content',
      arguments: '{"force":true}',
    });

    expect(parsed.toolCallDone).toEqual({
      callId: 'call_1',
      name: 'extract_page_content',
      arguments: '{"force":true}',
    });
  });

  it('应解析 output item 的 function_call 事件', () => {
    const parsed = parseResponsesStreamEvent({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'call_2',
        name: 'activate_skill',
        arguments: '{"skill_name":"fetch-linuxdo-post"}',
      },
    });

    expect(parsed.toolCallItemDone).toEqual({
      callId: 'call_2',
      name: 'activate_skill',
      arguments: '{"skill_name":"fetch-linuxdo-post"}',
    });
  });
});

describe('buildResponsesReasoning', () => {
  function createProvider(overrides: Partial<AIProvider> = {}): AIProvider {
    return {
      id: 'provider_1',
      name: 'Test Provider',
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      models: ['gpt-5.2'],
      selectedModel: 'gpt-5.2',
      visionModelSupport: { 'gpt-5.2': false },
      apiMode: 'responses',
      responsesReasoningEffort: 'high',
      responsesReasoningSummary: 'auto',
      ...overrides,
    };
  }

  it('应在 responses 模式生成 reasoning 参数', () => {
    const provider = createProvider({
      apiMode: 'responses',
      selectedModel: 'gpt-5.2',
      responsesReasoningEffort: 'xhigh',
    });

    expect(buildResponsesReasoning(provider)).toEqual({
      effort: 'xhigh',
      summary: 'auto',
    });
  });

  it('应在非 responses 模式返回 undefined', () => {
    const provider = createProvider({ apiMode: 'auto' });
    expect(buildResponsesReasoning(provider)).toBeUndefined();
  });

  it('应在 effort 不兼容时自动降级并标记来源', () => {
    const provider = createProvider({
      selectedModel: 'gpt-5-pro',
      responsesReasoningEffort: 'xhigh',
    });

    expect(buildResponsesReasoning(provider)).toEqual({
      effort: 'high',
      summary: 'auto',
      downgradedFrom: 'xhigh',
    });
  });
});
