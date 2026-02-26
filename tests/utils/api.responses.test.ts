import { describe, expect, it } from 'vitest';
import {
  buildResponsesReasoning,
  buildResponsesInstructions,
  buildResponsesPromptInjectionPayload,
  buildResponsesTools,
  buildSystemMessage,
  buildResponsesInput,
  buildSessionHeaders,
  estimateTokensFromApiMessages,
  resolveMaxOutputTokens,
  getLastContextUsage,
  setLastContextUsage,
  clearAllLastApiMessages,
  getLastApiMessages,
  parseResponsesStreamEvent,
  rollbackToolIterationMessages,
  setLastApiMessages,
  type ApiMessage,
} from '../../utils/api';
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE, type AIProvider } from '../../utils/storage';

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

  it('应保留 PDF 提取边界提示文本作为 function_call_output', () => {
    const messages: ApiMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_pdf_001',
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
        tool_call_id: 'call_pdf_001',
        content: '未检测到可提取的文本层，当前 PDF 可能是扫描版。',
      },
    ];

    const input = buildResponsesInput(messages);
    expect(input).toEqual([
      {
        type: 'function_call',
        call_id: 'call_pdf_001',
        name: 'extract_page_content',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_pdf_001',
        output: '未检测到可提取的文本层，当前 PDF 可能是扫描版。',
      },
    ]);
  });

  it('应在 includeSystemMessage=false 时跳过 system/developer 输入', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ];

    const input = buildResponsesInput(messages, { includeSystemMessage: false });
    expect(input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: 'hello',
      },
    ]);
  });
});

describe('lastApiMessages 会话隔离', () => {
  it('应按 sessionKey 分别读写上下文，互不污染', () => {
    const sessionA = 'session-a';
    const sessionB = 'session-b';
    const messagesA: ApiMessage[] = [{ role: 'system', content: 'A' }];
    const messagesB: ApiMessage[] = [{ role: 'system', content: 'B' }];

    setLastApiMessages([], sessionA);
    setLastApiMessages([], sessionB);
    setLastApiMessages(messagesA, sessionA);
    setLastApiMessages(messagesB, sessionB);

    expect(getLastApiMessages(sessionA)).toEqual(messagesA);
    expect(getLastApiMessages(sessionB)).toEqual(messagesB);
  });

  it('应兼容未传 sessionKey 的默认上下文', () => {
    const defaultMessages: ApiMessage[] = [{ role: 'system', content: 'default' }];

    setLastApiMessages(defaultMessages);

    expect(getLastApiMessages()).toEqual(defaultMessages);
  });

  it('clearAllLastApiMessages 应清空所有会话的上下文与统计快照', () => {
    const sessionA = 'session-clear-all-a';
    const sessionB = 'session-clear-all-b';

    setLastApiMessages([{ role: 'system', content: 'A' }], sessionA);
    setLastApiMessages([{ role: 'system', content: 'B' }], sessionB);
    setLastContextUsage({
      sessionKey: sessionA,
      exactBaseTokens: 12,
      pendingEstimateTokens: 0,
      currentTokensMixed: 12,
      totalTokensAccumulated: 12,
      contextWindowTokens: 1000,
      effectiveContextWindowTokens: 950,
      usageRatio: 12 / 950,
      precision: 'exact',
      source: 'responses_usage',
      lastSettledMessageCount: 1,
      updatedAt: Date.now(),
      tokenDetails: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 2,
        reasoningOutputTokens: 0,
      },
    }, sessionA);

    clearAllLastApiMessages();

    expect(getLastApiMessages(sessionA)).toEqual([]);
    expect(getLastApiMessages(sessionB)).toEqual([]);
    expect(getLastContextUsage(sessionA)).toBeNull();
    expect(getLastContextUsage(sessionB)).toBeNull();
  });

  it('清空会话上下文时应同步清空上下文统计快照', () => {
    const sessionKey = 'session-clear-usage';
    setLastContextUsage({
      sessionKey,
      exactBaseTokens: 120,
      pendingEstimateTokens: 0,
      currentTokensMixed: 120,
      totalTokensAccumulated: 120,
      contextWindowTokens: 200000,
      effectiveContextWindowTokens: 190000,
      usageRatio: 120 / 190000,
      precision: 'exact',
      source: 'responses_usage',
      lastSettledMessageCount: 1,
      updatedAt: Date.now(),
      tokenDetails: {
        inputTokens: 90,
        cachedInputTokens: 20,
        outputTokens: 30,
        reasoningOutputTokens: 5,
      },
    }, sessionKey);
    setLastApiMessages([{ role: 'system', content: 'system' }], sessionKey);
    expect(getLastContextUsage(sessionKey)).not.toBeNull();

    setLastApiMessages([], sessionKey);
    expect(getLastContextUsage(sessionKey)).toBeNull();
  });
});

describe('rollbackToolIterationMessages', () => {
  it('应在工具执行失败时回滚整轮 assistant/tool 增量消息', () => {
    const baseMessages: ApiMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'user-1' },
    ];
    const withPartialToolRound: ApiMessage[] = [
      ...baseMessages,
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'extract_page_content', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"ok":true}',
        tool_call_id: 'call-1',
      },
    ];

    expect(
      rollbackToolIterationMessages(withPartialToolRound, baseMessages.length),
    ).toEqual(baseMessages);
  });

  it('应在回滚索引越界时保持当前消息不变', () => {
    const messages: ApiMessage[] = [{ role: 'system', content: 'system' }];
    expect(rollbackToolIterationMessages(messages, 99)).toEqual(messages);
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

  it('应解析 web_search_call 状态事件', () => {
    const parsed = parseResponsesStreamEvent({
      type: 'response.web_search_call.searching',
      response_id: 'resp_search_1',
    });

    expect(parsed.responseId).toBe('resp_search_1');
    expect(parsed.webSearchStatus).toBe('searching');
  });

  it('应解析 response.completed 里的 usage 字段', () => {
    const parsed = parseResponsesStreamEvent({
      type: 'response.completed',
      response: {
        id: 'resp_usage_1',
        usage: {
          input_tokens: 120,
          input_tokens_details: {
            cached_tokens: 40,
          },
          output_tokens: 30,
          output_tokens_details: {
            reasoning_tokens: 5,
          },
          total_tokens: 150,
        },
      },
    });

    expect(parsed.responseId).toBe('resp_usage_1');
    expect(parsed.tokenUsage).toEqual({
      totalTokens: 150,
      inputTokens: 120,
      cachedInputTokens: 40,
      outputTokens: 30,
      reasoningOutputTokens: 5,
    });
  });

  it('应在 usage 缺失时保持兼容不抛错', () => {
    const parsed = parseResponsesStreamEvent({
      type: 'response.done',
      response: {
        id: 'resp_usage_missing',
      },
    });
    expect(parsed.responseId).toBe('resp_usage_missing');
    expect(parsed.tokenUsage).toBeUndefined();
  });
});

describe('estimateTokensFromApiMessages', () => {
  it('应在输入为空时返回 0', () => {
    expect(estimateTokensFromApiMessages([])).toBe(0);
  });

  it('应稳定估算文本与工具调用消息', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello world' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'extract_page_content',
              arguments: '{"limit":10}',
            },
          },
        ],
      },
    ];

    const estimate1 = estimateTokensFromApiMessages(messages);
    const estimate2 = estimateTokensFromApiMessages(messages);
    expect(estimate1).toBeGreaterThan(0);
    expect(estimate2).toBe(estimate1);
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
      systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      responsesSystemPromptMode: 'instructions',
      responsesReasoningEffort: 'high',
      responsesReasoningSummary: 'auto',
      contextWindowTokens: null,
      maxOutputTokens: null,
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

describe('buildResponsesTools', () => {
  function createProvider(overrides: Partial<AIProvider> = {}): AIProvider {
    return {
      id: 'provider_tools',
      name: 'Tools Provider',
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      models: ['gpt-5.2'],
      selectedModel: 'gpt-5.2',
      visionModelSupport: { 'gpt-5.2': false },
      apiMode: 'responses',
      systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      responsesSystemPromptMode: 'instructions',
      responsesReasoningEffort: 'medium',
      responsesReasoningSummary: 'auto',
      contextWindowTokens: null,
      maxOutputTokens: null,
      ...overrides,
    };
  }

  it('应在 responses 且联网开启时追加 web_search 工具', () => {
    const provider = createProvider({ apiMode: 'responses' });
    const baseTools = [{ type: 'function', name: 'extract_page_content' }];

    expect(buildResponsesTools(provider, baseTools, { webSearchEnabled: true })).toEqual([
      { type: 'function', name: 'extract_page_content' },
      { type: 'web_search', search_context_size: 'medium' },
    ]);
  });

  it('应在 responses 但联网关闭时不追加 web_search', () => {
    const provider = createProvider({ apiMode: 'responses' });
    const baseTools = [{ type: 'function', name: 'extract_page_content' }];

    expect(buildResponsesTools(provider, baseTools, { webSearchEnabled: false })).toEqual([
      { type: 'function', name: 'extract_page_content' },
    ]);
  });

  it('应在非 responses 模式下不追加 web_search', () => {
    const provider = createProvider({ apiMode: 'auto' });

    expect(buildResponsesTools(provider, undefined, { webSearchEnabled: true })).toBeUndefined();
  });

  it('应在 enableTools=false 时不注入任何 tools（包括 web_search）', () => {
    const provider = createProvider({ apiMode: 'responses' });
    const baseTools = [{ type: 'function', name: 'extract_page_content' }];

    expect(
      buildResponsesTools(
        provider,
        baseTools,
        { webSearchEnabled: true },
        { enableTools: false },
      ),
    ).toBeUndefined();
  });
});

describe('resolveMaxOutputTokens', () => {
  it('应返回合法的正整数 token 上限', () => {
    expect(resolveMaxOutputTokens({ maxOutputTokens: 2048 })).toBe(2048);
    expect(resolveMaxOutputTokens({ maxOutputTokens: 2048.9 })).toBe(2048);
  });

  it('应在空值或非法值时返回 undefined', () => {
    expect(resolveMaxOutputTokens({ maxOutputTokens: null })).toBeUndefined();
    expect(resolveMaxOutputTokens({ maxOutputTokens: 0 })).toBeUndefined();
    expect(resolveMaxOutputTokens({ maxOutputTokens: -1 })).toBeUndefined();
    expect(resolveMaxOutputTokens({ maxOutputTokens: Number.NaN })).toBeUndefined();
  });
});

describe('buildSystemMessage', () => {
  it('应拼接自定义系统提示词与上下文提示', () => {
    const provider = {
      systemPromptTemplate: '你是一个专业助手，请先给结论。',
    } as Pick<AIProvider, 'systemPromptTemplate'>;

    expect(buildSystemMessage(provider, '当前页面标题：示例页面')).toBe(
      '你是一个专业助手，请先给结论。\n\n当前页面标题：示例页面',
    );
  });

  it('应在系统提示词为空时回退默认模板', () => {
    const provider = {
      systemPromptTemplate: '   ',
    } as Pick<AIProvider, 'systemPromptTemplate'>;

    expect(buildSystemMessage(provider, 'context info')).toBe(
      `${DEFAULT_SYSTEM_PROMPT_TEMPLATE}\n\ncontext info`,
    );
  });

  it('应在上下文为空时仅返回系统提示词', () => {
    const provider = {
      systemPromptTemplate: '请用中文回答',
    } as Pick<AIProvider, 'systemPromptTemplate'>;

    expect(buildSystemMessage(provider, '   ')).toBe('请用中文回答');
  });
});

describe('buildResponsesInstructions', () => {
  it('应返回系统提示词文本', () => {
    expect(buildResponsesInstructions('system text')).toBe('system text');
  });
});

describe('buildResponsesPromptInjectionPayload', () => {
  it('应输出 instructions 并移除 input 中的 system', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ];

    expect(
      buildResponsesPromptInjectionPayload(messages, 'custom instructions'),
    ).toEqual({
      instructions: 'custom instructions',
      input: [
        {
          type: 'message',
          role: 'user',
          content: 'hello',
        },
      ],
    });
  });
});
