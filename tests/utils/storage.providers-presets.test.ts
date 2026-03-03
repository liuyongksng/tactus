import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  addPresetAction,
  deleteProvider,
  deletePresetAction,
  getAllProviders,
  getPresetActions,
  saveProvider,
  setActiveProviderId,
  setPresetActions,
  updatePresetAction,
  type AIProvider,
} from '../../utils/storage';

function createProvider(id: string, overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id,
    name: `Provider-${id}`,
    baseUrl: 'https://example.com/v1',
    apiKey: `key-${id}`,
    models: ['gpt-5.2'],
    selectedModel: 'gpt-5.2',
    visionModelSupport: { 'gpt-5.2': false },
    apiMode: 'auto',
    systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    responsesSystemPromptMode: 'instructions',
    responsesReasoningEffort: 'medium',
    responsesReasoningSummary: 'auto',
    contextWindowTokens: null,
    maxOutputTokens: null,
    ...overrides,
  };
}

describe('storage providerType/presetActions', () => {
  beforeEach(async () => {
    const providers = await getAllProviders();
    await Promise.all(providers.map(provider => deleteProvider(provider.id)));
    await setActiveProviderId(null);
    await setPresetActions([]);
  });

  it('应保留非 openai providerType，并将未知值归一化为默认 openai', async () => {
    await saveProvider(
      createProvider('provider-gemini', {
        providerType: 'gemini',
      }),
    );

    await saveProvider(
      createProvider('provider-invalid', {
        providerType: 'invalid' as any,
      }),
    );

    const providers = await getAllProviders();
    const geminiProvider = providers.find(provider => provider.id === 'provider-gemini');
    const invalidProvider = providers.find(provider => provider.id === 'provider-invalid');

    expect(geminiProvider?.providerType).toBe('gemini');
    expect(invalidProvider?.providerType).toBeUndefined();
  });

  it('presetActions 应支持新增、编辑、删除完整流程', async () => {
    const created = await addPresetAction('Summarize', 'Please summarize this page.');
    let presets = await getPresetActions();

    expect(presets).toHaveLength(1);
    expect(presets[0]?.id).toBe(created.id);
    expect(presets[0]?.name).toBe('Summarize');

    await updatePresetAction(created.id, 'Translate', 'Please translate this page.');
    presets = await getPresetActions();

    expect(presets).toHaveLength(1);
    expect(presets[0]?.name).toBe('Translate');
    expect(presets[0]?.content).toBe('Please translate this page.');

    await deletePresetAction(created.id);
    presets = await getPresetActions();
    expect(presets).toEqual([]);
  });
});
