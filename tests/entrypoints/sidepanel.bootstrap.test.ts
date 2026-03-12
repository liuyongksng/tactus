import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAllProvidersMock = vi.fn();
const getActiveProviderMock = vi.fn();
const getFontSettingsMock = vi.fn();
const getLanguageMock = vi.fn();
const getMaxPageContentLengthMock = vi.fn();
const getMaxPdfExtractPagesMock = vi.fn();
const getMaxToolCallsMock = vi.fn();
const getPresetActionsMock = vi.fn();
const getSelectionQuoteEnabledMock = vi.fn();
const getThemeModeMock = vi.fn();
const getSharePageContentMock = vi.fn();
const getWebSearchEnabledMock = vi.fn();

vi.mock('../../utils/storage', () => ({
  getAllProviders: () => getAllProvidersMock(),
  getActiveProvider: () => getActiveProviderMock(),
  getFontSettings: () => getFontSettingsMock(),
  getLanguage: () => getLanguageMock(),
  getMaxPageContentLength: () => getMaxPageContentLengthMock(),
  getMaxPdfExtractPages: () => getMaxPdfExtractPagesMock(),
  getMaxToolCalls: () => getMaxToolCallsMock(),
  getPresetActions: () => getPresetActionsMock(),
  getSelectionQuoteEnabled: () => getSelectionQuoteEnabledMock(),
  getThemeMode: () => getThemeModeMock(),
}));

vi.mock('../../utils/db', () => ({
  getSharePageContent: () => getSharePageContentMock(),
  getWebSearchEnabled: () => getWebSearchEnabledMock(),
}));

describe('sidepanel bootstrap helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
  });

  it('loadSidepanelShellState 应汇总首屏必需状态', async () => {
    const providers = [{ id: 'provider-1', selectedModel: 'gpt-4.1-mini' }];
    const presetActions = [{ id: 'preset-1', name: '总结', content: '请总结一下' }];
    const fontSettings = { mode: 'system', customFamily: '' };

    getAllProvidersMock.mockResolvedValue(providers);
    getActiveProviderMock.mockResolvedValue({ id: 'provider-1' });
    getSharePageContentMock.mockResolvedValue(true);
    getWebSearchEnabledMock.mockResolvedValue(false);
    getSelectionQuoteEnabledMock.mockResolvedValue(true);
    getMaxPageContentLengthMock.mockResolvedValue(12000);
    getMaxPdfExtractPagesMock.mockResolvedValue(18);
    getMaxToolCallsMock.mockResolvedValue(12);
    getPresetActionsMock.mockResolvedValue(presetActions);
    getLanguageMock.mockResolvedValue('zh-CN');
    getThemeModeMock.mockResolvedValue('dark');
    getFontSettingsMock.mockResolvedValue(fontSettings);

    const { loadSidepanelShellState } = await import('../../entrypoints/sidepanel/useBootstrap');
    await expect(loadSidepanelShellState()).resolves.toEqual({
      providers,
      activeProviderId: 'provider-1',
      sharePageContent: true,
      webSearchEnabled: false,
      selectionQuoteEnabled: true,
      maxPageContentLength: 12000,
      maxPdfExtractPages: 18,
      maxToolCalls: 12,
      presetActions,
      language: 'zh-CN',
      themeMode: 'dark',
      fontSettings,
    });
  });

  it('scheduleSidepanelDeferredWork 应支持 idle 分支取消与 setTimeout 回退', async () => {
    const { scheduleSidepanelDeferredWork } = await import('../../entrypoints/sidepanel/useBootstrap');

    const idleState: { callback: (() => void) | null } = { callback: null };
    const cancelIdleCallbackMock = vi.fn();
    (globalThis as {
      requestIdleCallback?: (callback: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    }).requestIdleCallback = (callback) => {
      idleState.callback = callback;
      return 7;
    };
    (globalThis as {
      cancelIdleCallback?: (handle: number) => void;
    }).cancelIdleCallback = cancelIdleCallbackMock;

    const idleTask = vi.fn();
    const cancelIdleTask = scheduleSidepanelDeferredWork(idleTask);
    cancelIdleTask();

    expect(cancelIdleCallbackMock).toHaveBeenCalledWith(7);
    const runIdleCallback = idleState.callback ?? (() => {
      throw new Error('requestIdleCallback 未捕获到回调');
    });
    runIdleCallback();
    await Promise.resolve();
    expect(idleTask).not.toHaveBeenCalled();

    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;

    const fallbackTask = vi.fn();
    const cancelFallbackTask = scheduleSidepanelDeferredWork(fallbackTask);
    cancelFallbackTask();
    vi.runAllTimers();
    await Promise.resolve();
    expect(fallbackTask).not.toHaveBeenCalled();

    const nextTask = vi.fn();
    scheduleSidepanelDeferredWork(nextTask);
    vi.runAllTimers();
    await Promise.resolve();
    expect(nextTask).toHaveBeenCalledTimes(1);
  });
});
