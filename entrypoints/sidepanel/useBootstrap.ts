import {
  getActiveProvider,
  getAllProviders,
  getFontSettings,
  getLanguage,
  getMaxPageContentLength,
  getMaxPdfExtractPages,
  getMaxToolCalls,
  getPresetActions,
  getSelectionQuoteEnabled,
  getThemeMode,
  type AIProvider,
  type FontSettings,
  type Language,
  type PresetAction,
  type ThemeMode,
} from '../../utils/storage';
import { getSharePageContent, getWebSearchEnabled } from '../../utils/db';

export interface SidepanelShellState {
  providers: AIProvider[];
  activeProviderId: string | null;
  sharePageContent: boolean;
  webSearchEnabled: boolean;
  selectionQuoteEnabled: boolean;
  maxPageContentLength: number;
  maxPdfExtractPages: number;
  maxToolCalls: number;
  presetActions: PresetAction[];
  language: Language;
  themeMode: ThemeMode;
  fontSettings: FontSettings;
}

export const SIDEPANEL_PERF_MARKS = {
  bootstrapStart: 'sidepanel-bootstrap-start',
  shellReady: 'sidepanel-shell-ready',
  inputReady: 'sidepanel-input-ready',
  capabilitiesReady: 'sidepanel-capabilities-ready',
} as const;

function canUsePerformance(): boolean {
  return typeof performance !== 'undefined'
    && typeof performance.mark === 'function'
    && typeof performance.measure === 'function';
}

export function markSidepanelPerformance(markName: string): void {
  if (!canUsePerformance()) {
    return;
  }
  performance.mark(markName);
}

export function measureSidepanelPerformance(
  measureName: string,
  startMark: string,
  endMark: string,
): void {
  if (!canUsePerformance()) {
    return;
  }
  try {
    performance.measure(measureName, startMark, endMark);
  } catch {
    // 忽略重复 measure 或 mark 缺失错误，避免影响主流程。
  }
}

export async function loadSidepanelShellState(): Promise<SidepanelShellState> {
  const [
    providers,
    activeProvider,
    sharePageContent,
    webSearchEnabled,
    selectionQuoteEnabled,
    maxPageContentLength,
    maxPdfExtractPages,
    maxToolCalls,
    presetActions,
    language,
    themeMode,
    fontSettings,
  ] = await Promise.all([
    getAllProviders(),
    getActiveProvider(),
    getSharePageContent(),
    getWebSearchEnabled(),
    getSelectionQuoteEnabled(),
    getMaxPageContentLength(),
    getMaxPdfExtractPages(),
    getMaxToolCalls(),
    getPresetActions(),
    getLanguage(),
    getThemeMode(),
    getFontSettings(),
  ]);

  return {
    providers,
    activeProviderId: activeProvider?.id ?? null,
    sharePageContent,
    webSearchEnabled,
    selectionQuoteEnabled,
    maxPageContentLength,
    maxPdfExtractPages,
    maxToolCalls,
    presetActions,
    language,
    themeMode,
    fontSettings,
  };
}

export function scheduleSidepanelDeferredWork(task: () => void | Promise<void>): () => void {
  let cancelled = false;
  const timerApi = globalThis as typeof globalThis & {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  };

  const runTask = () => {
    if (cancelled) {
      return;
    }
    void Promise.resolve(task());
  };

  const idleCallback = (globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void) => number;
    cancelIdleCallback?: (handle: number) => void;
  }).requestIdleCallback;
  const cancelIdleCallback = (globalThis as typeof globalThis & {
    cancelIdleCallback?: (handle: number) => void;
  }).cancelIdleCallback;

  if (typeof idleCallback === 'function') {
    const handle = idleCallback(() => {
      runTask();
    });
    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(handle);
      }
    };
  }

  const timeoutHandle = timerApi.setTimeout(() => {
    runTask();
  }, 0);

  return () => {
    cancelled = true;
    timerApi.clearTimeout(timeoutHandle);
  };
}
