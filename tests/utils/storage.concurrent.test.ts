import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  deleteProvider,
  getAllProviders,
  getLocalContextCompressionSettings,
  getTrustedScripts,
  removeTrustedScriptsBySkillId,
  saveProvider,
  setLocalContextCompressionSettings,
  setActiveProviderId,
  trustScript,
  untrustScript,
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

describe('storage 并发写入', () => {
  beforeEach(async () => {
    const providers = await getAllProviders();
    await Promise.all(providers.map(provider => deleteProvider(provider.id)));
    await setActiveProviderId(null);

    const scripts = await getTrustedScripts();
    const skillIds = Array.from(new Set(scripts.map(script => script.skillId)));
    await Promise.all(skillIds.map(skillId => removeTrustedScriptsBySkillId(skillId)));
  });

  it('saveProvider 并发写入时不应丢失其中一个 provider', async () => {
    await Promise.all([
      saveProvider(createProvider('provider-a')),
      saveProvider(createProvider('provider-b')),
    ]);

    const providers = await getAllProviders();
    const ids = providers.map(provider => provider.id).sort();

    expect(ids).toEqual(['provider-a', 'provider-b']);
  });

  it('deleteProvider 并发删除时应同时删除目标项', async () => {
    await saveProvider(createProvider('provider-a'));
    await saveProvider(createProvider('provider-b'));
    await saveProvider(createProvider('provider-c'));

    await Promise.all([
      deleteProvider('provider-a'),
      deleteProvider('provider-b'),
    ]);

    const providers = await getAllProviders();
    expect(providers.map(provider => provider.id)).toEqual(['provider-c']);
  });

  it('saveProvider 应将无效 token 配置归一化为 null', async () => {
    await saveProvider(
      createProvider('provider-token', {
        contextWindowTokens: -10,
        maxOutputTokens: Number.NaN,
      }),
    );

    const providers = await getAllProviders();
    const provider = providers.find(item => item.id === 'provider-token');
    expect(provider?.contextWindowTokens).toBeNull();
    expect(provider?.maxOutputTokens).toBeNull();
  });

  it('trustScript 并发写入时不应丢失脚本信任记录', async () => {
    await Promise.all([
      trustScript('skill-1', 'script-a'),
      trustScript('skill-1', 'script-b'),
    ]);

    const scripts = await getTrustedScripts();
    const names = scripts
      .filter(script => script.skillId === 'skill-1')
      .map(script => script.scriptName)
      .sort();

    expect(names).toEqual(['script-a', 'script-b']);
  });

  it('untrustScript 并发删除时应同时移除两个脚本', async () => {
    await trustScript('skill-1', 'script-a');
    await trustScript('skill-1', 'script-b');
    await trustScript('skill-1', 'script-c');

    await Promise.all([
      untrustScript('skill-1', 'script-a'),
      untrustScript('skill-1', 'script-b'),
    ]);

    const scripts = await getTrustedScripts();
    const names = scripts
      .filter(script => script.skillId === 'skill-1')
      .map(script => script.scriptName);

    expect(names).toEqual(['script-c']);
  });

  it('本地压缩配置保存后应按规则归一化', async () => {
    await setLocalContextCompressionSettings({
      enabled: true,
      autoCompactTokenLimit: -100,
      keepRecentUserTokens: -1,
      summaryMaxTokens: 0,
      compactPrompt: '   ',
      maxCompactionsPerTurn: 0,
    });

    const settings = await getLocalContextCompressionSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.autoCompactTokenLimit).toBeNull();
    expect(settings.keepRecentUserTokens).toBe(4096);
    expect(settings.summaryMaxTokens).toBe(256);
    expect(settings.compactPrompt).toBeNull();
    expect(settings.maxCompactionsPerTurn).toBe(2);
  });
});
