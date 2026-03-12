import { describe, expect, it } from 'vitest';
import { loadOpenAIModule, loadAnthropicModule, loadGeminiModule } from '../../utils/api/provider-loaders';

describe('api provider loaders', () => {
  it('caches openai module', async () => {
    const first = await loadOpenAIModule();
    const second = await loadOpenAIModule();
    expect(second).toBe(first);
  });

  it('caches anthropic module', async () => {
    const first = await loadAnthropicModule();
    const second = await loadAnthropicModule();
    expect(second).toBe(first);
  });

  it('caches gemini module', async () => {
    const first = await loadGeminiModule();
    const second = await loadGeminiModule();
    expect(second).toBe(first);
  });
});
