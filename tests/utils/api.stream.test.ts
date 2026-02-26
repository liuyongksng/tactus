import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../utils/db';
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE, type AIProvider } from '../../utils/storage';

vi.mock('openai', () => {
  class MockAPIError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'MockAPIError';
    }
  }

  type MockHandler = (...args: unknown[]) => Promise<AsyncIterable<unknown>>;

  const state = {
    chatHandlers: [] as MockHandler[],
    responsesHandlers: [] as MockHandler[],
  };

  class MockOpenAI {
    static APIError = MockAPIError;

    chat = {
      completions: {
        create: async (...args: unknown[]) => {
          const handler = state.chatHandlers.shift();
          if (!handler) {
            throw new Error('missing mock handler for chat.completions.create');
          }
          return handler(...args);
        },
      },
    };

    responses = {
      create: async (...args: unknown[]) => {
        const handler = state.responsesHandlers.shift();
        if (!handler) {
          throw new Error('missing mock handler for responses.create');
        }
        return handler(...args);
      },
    };
  }

  return {
    default: MockOpenAI,
    __queueChatCreate: (handler: MockHandler) => {
      state.chatHandlers.push(handler);
    },
    __queueResponsesCreate: (handler: MockHandler) => {
      state.responsesHandlers.push(handler);
    },
    __resetOpenAIMock: () => {
      state.chatHandlers = [];
      state.responsesHandlers = [];
    },
  };
});

import {
  getLastContextUsage,
  getLastApiMessages,
  setLastApiMessages,
  streamChat,
  type ApiMessage,
  type StreamEvent,
} from '../../utils/api';

interface OpenAIMockHooks {
  __queueChatCreate: (handler: (...args: unknown[]) => Promise<AsyncIterable<unknown>>) => void;
  __queueResponsesCreate: (handler: (...args: unknown[]) => Promise<AsyncIterable<unknown>>) => void;
  __resetOpenAIMock: () => void;
}

const RETRY_CONFIG = {
  maxRetries: 1,
  baseDelay: 0,
  maxDelay: 0,
  timeout: 200,
};

function createProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'provider-stream',
    name: 'Stream Provider',
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    models: ['gpt-5.2'],
    selectedModel: 'gpt-5.2',
    visionModelSupport: { 'gpt-5.2': false },
    apiMode: 'chat_completions',
    systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    responsesSystemPromptMode: 'instructions',
    responsesReasoningEffort: 'medium',
    responsesReasoningSummary: 'auto',
    contextWindowTokens: null,
    maxOutputTokens: null,
    ...overrides,
  };
}

function createUserMessage(content: string): ChatMessage {
  return {
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

async function collectEvents(generator: AsyncGenerator<StreamEvent, void, unknown>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

async function* fromChunks(chunks: unknown[]): AsyncGenerator<unknown, void, unknown> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('streamChat 主链路', () => {
  beforeEach(async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;
    openaiMock.__resetOpenAIMock();
    setLastApiMessages([]);
  });

  it('responses 失败时应自动回退到 chat.completions', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;
    const OpenAIModule = (await import('openai')) as unknown as {
      default: { APIError: new (status: number, message: string) => Error };
    };
    const MockAPIError = OpenAIModule.default.APIError;

    openaiMock.__queueResponsesCreate(async () => {
      throw new MockAPIError(400, 'invalid request');
    });
    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [{ delta: { content: 'fallback-ok' } }],
        },
      ]),
    );

    const provider = createProvider({ apiMode: 'auto' });
    const events = await collectEvents(
      streamChat(provider, [createUserMessage('hello')], undefined, { enableTools: false }, RETRY_CONFIG),
    );

    expect(events.some(event => event.type === 'content' && event.content === 'fallback-ok')).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('网络异常后应触发重试并最终成功返回内容', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;

    openaiMock.__queueChatCreate(async () => {
      throw new TypeError('fetch failed');
    });
    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [{ delta: { content: 'retry-success' } }],
        },
      ]),
    );

    const provider = createProvider({ apiMode: 'chat_completions' });
    const events = await collectEvents(
      streamChat(provider, [createUserMessage('retry')], undefined, { enableTools: false }, RETRY_CONFIG),
    );

    expect(
      events.some(event => event.type === 'error' && event.retrying === true),
    ).toBe(true);
    expect(events.some(event => event.type === 'content' && event.content === 'retry-success')).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('chat.completions 请求应注入 max_completion_tokens', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;
    let capturedRequest: Record<string, unknown> | null = null;

    openaiMock.__queueChatCreate(async (...args: unknown[]) => {
      capturedRequest = args[0] as Record<string, unknown>;
      return fromChunks([
        {
          choices: [{ delta: { content: 'chat-with-limit' } }],
        },
      ]);
    });

    const events = await collectEvents(
      streamChat(
        createProvider({ apiMode: 'chat_completions', maxOutputTokens: 4096 }),
        [createUserMessage('hello')],
        undefined,
        { enableTools: false },
        RETRY_CONFIG,
      ),
    );

    expect(capturedRequest?.['max_completion_tokens']).toBe(4096);
    expect(events.some(event => event.type === 'content' && event.content === 'chat-with-limit')).toBe(true);
  });

  it('responses 请求应注入 max_output_tokens', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;
    let capturedRequest: Record<string, unknown> | null = null;

    openaiMock.__queueResponsesCreate(async (...args: unknown[]) => {
      capturedRequest = args[0] as Record<string, unknown>;
      return fromChunks([
        {
          type: 'response.output_text.delta',
          delta: 'responses-with-limit',
        },
      ]);
    });

    const events = await collectEvents(
      streamChat(
        createProvider({ apiMode: 'responses', maxOutputTokens: 2048 }),
        [createUserMessage('hello')],
        undefined,
        { enableTools: false },
        RETRY_CONFIG,
      ),
    );

    expect(capturedRequest?.['max_output_tokens']).toBe(2048);
    expect(events.some(event => event.type === 'content' && event.content === 'responses-with-limit')).toBe(true);
  });

  it('chat.completions 请求默认应注入 stream_options.include_usage', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;
    let capturedRequest: Record<string, unknown> | null = null;

    openaiMock.__queueChatCreate(async (...args: unknown[]) => {
      capturedRequest = args[0] as Record<string, unknown>;
      return fromChunks([
        {
          choices: [{ delta: { content: 'chat-include-usage' } }],
        },
      ]);
    });

    await collectEvents(
      streamChat(
        createProvider({ id: 'provider-include-usage', apiMode: 'chat_completions' }),
        [createUserMessage('include usage')],
        undefined,
        { enableTools: false },
        RETRY_CONFIG,
      ),
    );

    expect(capturedRequest?.['stream_options']).toEqual({ include_usage: true });
  });

  it('网关不支持 include_usage 时应自动降级并继续成功', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;
    const OpenAIModule = (await import('openai')) as unknown as {
      default: { APIError: new (status: number, message: string) => Error };
    };
    const MockAPIError = OpenAIModule.default.APIError;

    let firstRequest: Record<string, unknown> | null = null;
    let secondRequest: Record<string, unknown> | null = null;
    let thirdRequest: Record<string, unknown> | null = null;

    openaiMock.__queueChatCreate(async (...args: unknown[]) => {
      firstRequest = args[0] as Record<string, unknown>;
      throw new MockAPIError(400, 'Unknown parameter: stream_options.include_usage');
    });
    openaiMock.__queueChatCreate(async (...args: unknown[]) => {
      secondRequest = args[0] as Record<string, unknown>;
      return fromChunks([
        {
          choices: [{ delta: { content: 'fallback-without-include-usage' } }],
        },
      ]);
    });

    const provider = createProvider({
      id: 'provider-no-include-usage',
      apiMode: 'chat_completions',
    });

    const firstEvents = await collectEvents(
      streamChat(provider, [createUserMessage('first run')], undefined, { enableTools: false }, RETRY_CONFIG),
    );

    expect(firstRequest?.['stream_options']).toEqual({ include_usage: true });
    expect(secondRequest?.['stream_options']).toBeUndefined();
    expect(
      firstEvents.some(event => event.type === 'content' && event.content === 'fallback-without-include-usage'),
    ).toBe(true);

    openaiMock.__queueChatCreate(async (...args: unknown[]) => {
      thirdRequest = args[0] as Record<string, unknown>;
      return fromChunks([
        {
          choices: [{ delta: { content: 'second-run-no-include-usage' } }],
        },
      ]);
    });

    const secondEvents = await collectEvents(
      streamChat(provider, [createUserMessage('second run')], undefined, { enableTools: false }, RETRY_CONFIG),
    );

    expect(thirdRequest?.['stream_options']).toBeUndefined();
    expect(
      secondEvents.some(event => event.type === 'content' && event.content === 'second-run-no-include-usage'),
    ).toBe(true);
  });

  it('responses 链路拿到 usage 时应产出 context_usage 事件', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;

    openaiMock.__queueResponsesCreate(async () =>
      fromChunks([
        {
          type: 'response.output_text.delta',
          delta: 'responses-usage-content',
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_usage_event',
            usage: {
              input_tokens: 90,
              input_tokens_details: {
                cached_tokens: 30,
              },
              output_tokens: 20,
              output_tokens_details: {
                reasoning_tokens: 4,
              },
              total_tokens: 110,
            },
          },
        },
      ]),
    );

    const events = await collectEvents(
      streamChat(
        createProvider({ apiMode: 'responses', contextWindowTokens: 200000 }),
        [createUserMessage('responses usage event')],
        { sessionKey: 'session-responses-usage' },
        { enableTools: false },
        RETRY_CONFIG,
      ),
    );

    const usageEvent = events.find(
      event => event.type === 'context_usage' && event.usage.source === 'responses_usage',
    );
    expect(usageEvent).toBeDefined();
    if (usageEvent && usageEvent.type === 'context_usage') {
      expect(usageEvent.usage.exactBaseTokens).toBe(110);
      expect(usageEvent.usage.precision).toBe('exact');
    }
  });

  it('chat.completions 链路拿到 chunk usage 时应产出 context_usage 事件', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;

    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [{ delta: { content: 'chat-usage-content' } }],
          usage: {
            prompt_tokens: 80,
            prompt_tokens_details: {
              cached_tokens: 12,
            },
            completion_tokens: 24,
            completion_tokens_details: {
              reasoning_tokens: 6,
            },
            total_tokens: 104,
          },
        },
      ]),
    );

    const events = await collectEvents(
      streamChat(
        createProvider({
          id: 'provider-chat-usage-event',
          apiMode: 'chat_completions',
          contextWindowTokens: 100000,
          maxOutputTokens: 20000,
        }),
        [createUserMessage('chat usage event')],
        { sessionKey: 'session-chat-usage' },
        { enableTools: false },
        RETRY_CONFIG,
      ),
    );

    const usageEvent = events.find(
      event => event.type === 'context_usage' && event.usage.source === 'chat_usage',
    );
    expect(usageEvent).toBeDefined();
    if (usageEvent && usageEvent.type === 'context_usage') {
      expect(usageEvent.usage.exactBaseTokens).toBe(104);
      expect(usageEvent.usage.precision).toBe('exact');
      expect(usageEvent.usage.effectiveContextWindowTokens).toBe(80000);
    }
  });

  it('工具执行失败重试时应回滚失败轮消息并仅保留成功轮', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;

    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-failed',
                    function: { name: 'extract_page_content', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );
    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-success',
                    function: { name: 'extract_page_content', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );
    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [{ delta: { content: 'tool-final-answer' } }],
        },
      ]),
    );

    let executorRuns = 0;
    const events = await collectEvents(
      streamChat(
        createProvider({ apiMode: 'chat_completions' }),
        [createUserMessage('tool test')],
        undefined,
        {
          enableTools: true,
          toolExecutor: async toolCall => {
            executorRuns += 1;
            if (executorRuns === 1) {
              return {
                tool_call_id: toolCall.id,
                name: toolCall.name,
                result: 'boom',
                success: false,
              };
            }
            return {
              tool_call_id: toolCall.id,
              name: toolCall.name,
              result: '{"ok":true}',
              success: true,
            };
          },
        },
        RETRY_CONFIG,
      ),
    );

    expect(executorRuns).toBe(2);
    expect(events.some(event => event.type === 'thinking' && event.message.includes('工具执行失败'))).toBe(true);
    expect(events.some(event => event.type === 'content' && event.content === 'tool-final-answer')).toBe(true);

    const finalMessages = getLastApiMessages() as ApiMessage[];
    const serialized = JSON.stringify(finalMessages);
    expect(serialized.includes('call-failed')).toBe(false);
    expect(serialized.includes('call-success')).toBe(true);
  });

  it('工具失败回滚后应恢复回滚前 usage 快照，避免保留失败轮的精确 token', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;
    const sessionKey = 'session-tool-rollback-usage';

    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-usage-failed',
                    function: { name: 'extract_page_content', arguments: '{}' },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 600,
            completion_tokens: 50,
            total_tokens: 650,
          },
        },
      ]),
    );
    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-usage-success',
                    function: { name: 'extract_page_content', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );
    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [{ delta: { content: 'rollback-usage-final' } }],
        },
      ]),
    );

    let executorRuns = 0;
    const events = await collectEvents(
      streamChat(
        createProvider({ apiMode: 'chat_completions' }),
        [createUserMessage('rollback usage check')],
        { sessionKey },
        {
          enableTools: true,
          toolExecutor: async toolCall => {
            executorRuns += 1;
            if (executorRuns === 1) {
              return {
                tool_call_id: toolCall.id,
                name: toolCall.name,
                result: 'boom',
                success: false,
              };
            }
            return {
              tool_call_id: toolCall.id,
              name: toolCall.name,
              result: '{"ok":true}',
              success: true,
            };
          },
        },
        RETRY_CONFIG,
      ),
    );

    const failureThinkingIndex = events.findIndex(
      event => event.type === 'thinking' && event.message.includes('工具执行失败'),
    );
    expect(failureThinkingIndex).toBeGreaterThan(-1);

    const rollbackUsageEvent = events
      .slice(failureThinkingIndex + 1)
      .find(event => event.type === 'context_usage');
    expect(rollbackUsageEvent).toBeDefined();
    if (rollbackUsageEvent && rollbackUsageEvent.type === 'context_usage') {
      expect(rollbackUsageEvent.usage.exactBaseTokens).toBeNull();
      expect(rollbackUsageEvent.usage.precision).toBe('estimated');
    }

    const finalUsage = getLastContextUsage(sessionKey);
    expect(finalUsage?.exactBaseTokens).toBeNull();
  });

  it('工具执行器抛异常时应触发重试并回滚失败轮消息', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;

    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-throw-first',
                    function: { name: 'extract_page_content', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );
    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-throw-second',
                    function: { name: 'extract_page_content', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );
    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [{ delta: { content: 'tool-throw-final-answer' } }],
        },
      ]),
    );

    let executorRuns = 0;
    const events = await collectEvents(
      streamChat(
        createProvider({ apiMode: 'chat_completions' }),
        [createUserMessage('tool throw test')],
        undefined,
        {
          enableTools: true,
          toolExecutor: async toolCall => {
            executorRuns += 1;
            if (executorRuns === 1) {
              throw new Error('tool executor crashed');
            }
            return {
              tool_call_id: toolCall.id,
              name: toolCall.name,
              result: '{"ok":true}',
              success: true,
            };
          },
        },
        RETRY_CONFIG,
      ),
    );

    expect(executorRuns).toBe(2);
    expect(events.some(event => event.type === 'thinking' && event.message.includes('工具执行'))).toBe(true);
    expect(events.some(event => event.type === 'content' && event.content === 'tool-throw-final-answer')).toBe(true);

    const finalMessages = getLastApiMessages() as ApiMessage[];
    const serialized = JSON.stringify(finalMessages);
    expect(serialized.includes('call-throw-first')).toBe(false);
    expect(serialized.includes('call-throw-second')).toBe(true);
  });

  it('responses 模式下工具执行器抛异常时应触发重试并回滚失败轮消息', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;

    openaiMock.__queueResponsesCreate(async () =>
      fromChunks([
        {
          type: 'response.function_call_arguments.done',
          call_id: 'resp-call-throw-first',
          name: 'extract_page_content',
          arguments: '{}',
        },
      ]),
    );
    openaiMock.__queueResponsesCreate(async () =>
      fromChunks([
        {
          type: 'response.function_call_arguments.done',
          call_id: 'resp-call-throw-second',
          name: 'extract_page_content',
          arguments: '{}',
        },
      ]),
    );
    openaiMock.__queueResponsesCreate(async () =>
      fromChunks([
        {
          type: 'response.output_text.delta',
          delta: 'responses-tool-throw-final-answer',
        },
      ]),
    );

    let executorRuns = 0;
    const events = await collectEvents(
      streamChat(
        createProvider({ apiMode: 'responses' }),
        [createUserMessage('responses tool throw test')],
        undefined,
        {
          enableTools: true,
          toolExecutor: async toolCall => {
            executorRuns += 1;
            if (executorRuns === 1) {
              throw new Error('responses tool executor crashed');
            }
            return {
              tool_call_id: toolCall.id,
              name: toolCall.name,
              result: '{"ok":true}',
              success: true,
            };
          },
        },
        RETRY_CONFIG,
      ),
    );

    expect(executorRuns).toBe(2);
    expect(events.some(event => event.type === 'thinking' && event.message.includes('工具执行异常'))).toBe(true);
    expect(
      events.some(event => event.type === 'content' && event.content === 'responses-tool-throw-final-answer'),
    ).toBe(true);

    const finalMessages = getLastApiMessages() as ApiMessage[];
    const serialized = JSON.stringify(finalMessages);
    expect(serialized.includes('resp-call-throw-first')).toBe(false);
    expect(serialized.includes('resp-call-throw-second')).toBe(true);
  });

  it('PDF 边界提示作为成功工具结果时不应触发失败重试', async () => {
    const openaiMock = (await import('openai')) as unknown as OpenAIMockHooks;

    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-pdf-note',
                    function: { name: 'extract_page_content', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );
    openaiMock.__queueChatCreate(async () =>
      fromChunks([
        {
          choices: [{ delta: { content: '已知该 PDF 为扫描件，建议 OCR。' } }],
        },
      ]),
    );

    let executorRuns = 0;
    const events = await collectEvents(
      streamChat(
        createProvider({ apiMode: 'chat_completions' }),
        [createUserMessage('读取这个 PDF')],
        undefined,
        {
          enableTools: true,
          toolExecutor: async toolCall => {
            executorRuns += 1;
            return {
              tool_call_id: toolCall.id,
              name: toolCall.name,
              result: '未检测到可提取的文本层，当前 PDF 可能是扫描版。',
              success: true,
            };
          },
        },
        RETRY_CONFIG,
      ),
    );

    expect(executorRuns).toBe(1);
    expect(events.some(event => event.type === 'thinking' && event.message.includes('工具执行失败'))).toBe(false);
    expect(events.some(event => event.type === 'content' && event.content.includes('建议 OCR'))).toBe(true);
  });
});
