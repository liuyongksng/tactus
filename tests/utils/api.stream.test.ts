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
