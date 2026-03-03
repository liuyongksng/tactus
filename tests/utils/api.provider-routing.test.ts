import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE, type AIProvider } from '../../utils/storage';
import type { ChatMessage } from '../../utils/db';

const fetchAnthropicModelsMock = vi.fn();
const fetchGeminiModelsMock = vi.fn();
const streamChatAnthropicMock = vi.fn();
const streamChatGeminiMock = vi.fn();
const streamChatAnthropicSimpleMock = vi.fn();
const streamChatGeminiSimpleMock = vi.fn();

vi.mock('../../utils/anthropic', () => ({
  fetchAnthropicModels: (...args: unknown[]) => fetchAnthropicModelsMock(...args),
  streamChatAnthropic: (...args: unknown[]) => streamChatAnthropicMock(...args),
  streamChatAnthropicSimple: (...args: unknown[]) => streamChatAnthropicSimpleMock(...args),
}));

vi.mock('../../utils/gemini', () => ({
  fetchGeminiModels: (...args: unknown[]) => fetchGeminiModelsMock(...args),
  streamChatGemini: (...args: unknown[]) => streamChatGeminiMock(...args),
  streamChatGeminiSimple: (...args: unknown[]) => streamChatGeminiSimpleMock(...args),
}));

import { fetchModels, streamChat, streamChatSimple, type StreamEvent } from '../../utils/api';

function createProvider(providerType: AIProvider['providerType']): AIProvider {
  return {
    id: `provider-${providerType}`,
    name: `Provider-${providerType}`,
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    models: ['model-1'],
    selectedModel: 'model-1',
    visionModelSupport: { 'model-1': false },
    providerType,
    apiMode: 'auto',
    systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    responsesSystemPromptMode: 'instructions',
    responsesReasoningEffort: 'medium',
    responsesReasoningSummary: 'auto',
    contextWindowTokens: null,
    maxOutputTokens: null,
  };
}

async function collectStreamEvents(generator: AsyncGenerator<StreamEvent, void, unknown>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

async function collectTextChunks(generator: AsyncGenerator<string, void, unknown>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('api provider routing', () => {
  beforeEach(() => {
    fetchAnthropicModelsMock.mockReset();
    fetchGeminiModelsMock.mockReset();
    streamChatAnthropicMock.mockReset();
    streamChatGeminiMock.mockReset();
    streamChatAnthropicSimpleMock.mockReset();
    streamChatGeminiSimpleMock.mockReset();
  });

  it('fetchModels: providerType=anthropic 时应调用 Anthropic 模型获取函数', async () => {
    fetchAnthropicModelsMock.mockResolvedValue([{ id: 'claude-sonnet' }]);

    const models = await fetchModels('https://api.anthropic.com', 'k1', 'anthropic');

    expect(fetchAnthropicModelsMock).toHaveBeenCalledWith('https://api.anthropic.com', 'k1');
    expect(fetchGeminiModelsMock).not.toHaveBeenCalled();
    expect(models).toEqual([{ id: 'claude-sonnet' }]);
  });

  it('fetchModels: providerType=gemini 时应调用 Gemini 模型获取函数', async () => {
    fetchGeminiModelsMock.mockResolvedValue([{ id: 'gemini-2.5-pro' }]);

    const models = await fetchModels('https://generativelanguage.googleapis.com', 'k2', 'gemini');

    expect(fetchGeminiModelsMock).toHaveBeenCalledWith('https://generativelanguage.googleapis.com', 'k2');
    expect(fetchAnthropicModelsMock).not.toHaveBeenCalled();
    expect(models).toEqual([{ id: 'gemini-2.5-pro' }]);
  });

  it('streamChat: providerType=anthropic 时应路由到 streamChatAnthropic', async () => {
    streamChatAnthropicMock.mockImplementation(
      async function* (): AsyncGenerator<StreamEvent, void, unknown> {
        yield { type: 'content', content: 'hello' };
        yield { type: 'done' };
      },
    );

    const events = await collectStreamEvents(streamChat(createProvider('anthropic'), [] as ChatMessage[]));

    expect(streamChatAnthropicMock).toHaveBeenCalledTimes(1);
    expect(streamChatGeminiMock).not.toHaveBeenCalled();
    expect(events.map(event => event.type)).toEqual(['content', 'done']);
  });

  it('streamChatSimple: providerType=gemini 时应路由到 streamChatGeminiSimple', async () => {
    streamChatGeminiSimpleMock.mockImplementation(
      async function* (): AsyncGenerator<string, void, unknown> {
        yield 'chunk-1';
        yield 'chunk-2';
      },
    );

    const chunks = await collectTextChunks(streamChatSimple(createProvider('gemini'), [] as ChatMessage[]));

    expect(streamChatGeminiSimpleMock).toHaveBeenCalledTimes(1);
    expect(streamChatAnthropicSimpleMock).not.toHaveBeenCalled();
    expect(chunks).toEqual(['chunk-1', 'chunk-2']);
  });
});
