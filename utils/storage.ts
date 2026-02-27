/**
 * 存储层 - WXT Storage 用于需要跨页面同步的配置数据
 * AI Providers 和 Trusted Scripts 使用 WXT storage（自动同步）
 * 其他大数据继续使用 IndexedDB
 */

import { storage } from '@wxt-dev/storage';
import { createMutationGate } from './storageLock';

// ==================== 类型定义 ====================

export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  selectedModel: string;
  visionModelSupport: Record<string, boolean>;
  apiMode: ProviderApiMode;
  systemPromptTemplate: string;
  responsesSystemPromptMode: ResponsesSystemPromptMode;
  responsesReasoningEffort: ResponsesReasoningEffort;
  responsesReasoningSummary: ResponsesReasoningSummary;
  contextWindowTokens: number | null;
  maxOutputTokens: number | null;
}

export type ProviderApiMode = 'auto' | 'chat_completions' | 'responses';
export type ResponsesSystemPromptMode = 'instructions';
export type ResponsesReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ResponsesReasoningSummary = 'auto';

export const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You are a helpful AI assistant. Always respond using Markdown format for better readability. Use:
- Headers (##, ###) for sections
- **bold** and *italic* for emphasis
- \`code\` for inline code and \`\`\` for code blocks with language specification
- Lists (- or 1.) for enumerations
- > for quotes
- Tables when presenting structured data`;

export interface TrustedScript {
  skillId: string;
  scriptName: string;
  trustedAt: number;
}

export interface LocalContextCompressionSettings {
  enabled: boolean;
  autoCompactTokenLimit: number | null;
  keepRecentUserTokens: number;
  summaryMaxTokens: number;
  compactPrompt: string | null;
  maxCompactionsPerTurn: number;
}

const DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS: LocalContextCompressionSettings = {
  enabled: true,
  autoCompactTokenLimit: null,
  keepRecentUserTokens: 4096,
  summaryMaxTokens: 256,
  compactPrompt: null,
  maxCompactionsPerTurn: 2,
};

// ==================== Storage Items ====================

const providersStorage = storage.defineItem<AIProvider[]>('local:providers', {
  fallback: [],
});

const activeProviderIdStorage = storage.defineItem<string | null>('local:activeProviderId', {
  fallback: null,
});

const trustedScriptsStorage = storage.defineItem<TrustedScript[]>('local:trustedScripts', {
  fallback: [],
});

const localContextCompressionEnabledStorage = storage.defineItem<boolean>('local:localContextCompressionEnabled', {
  fallback: DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.enabled,
});

const localContextAutoCompactTokenLimitStorage = storage.defineItem<number | null>('local:localContextAutoCompactTokenLimit', {
  fallback: DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.autoCompactTokenLimit,
});

const localContextKeepRecentUserTokensStorage = storage.defineItem<number>('local:localContextKeepRecentUserTokens', {
  fallback: DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.keepRecentUserTokens,
});

const localContextCompressionSummaryMaxTokensStorage = storage.defineItem<number>('local:localContextCompressionSummaryMaxTokens', {
  fallback: DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.summaryMaxTokens,
});

const localContextCompactPromptStorage = storage.defineItem<string | null>('local:localContextCompactPrompt', {
  fallback: DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.compactPrompt,
});

const localContextMaxCompactionsPerTurnStorage = storage.defineItem<number>('local:localContextMaxCompactionsPerTurn', {
  fallback: DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.maxCompactionsPerTurn,
});

const runProvidersMutation = createMutationGate('providers');
const runTrustedScriptsMutation = createMutationGate('trusted-scripts');

// ==================== Theme Settings ====================

export type ThemeMode = 'light' | 'dark' | 'system';

const themeModeStorage = storage.defineItem<ThemeMode>('local:themeMode', {
  fallback: 'system',
});

export async function getThemeMode(): Promise<ThemeMode> {
  return await themeModeStorage.getValue();
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  await themeModeStorage.setValue(mode);
}

export function watchThemeMode(callback: (mode: ThemeMode) => void): () => void {
  return themeModeStorage.watch((newValue) => {
    callback(newValue);
  });
}

// 根据主题模式获取实际应用的主题
export function getResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

// 应用主题到 document
export function applyTheme(mode: ThemeMode): void {
  const theme = getResolvedTheme(mode);
  document.documentElement.setAttribute('data-theme', theme);
}

// ==================== Font Settings ====================

export type FontFamilyPreset = 'system' | 'serif' | 'monospace' | 'custom';

export interface FontSettings {
  preset: FontFamilyPreset;
  customFamily: string;
}

export const DEFAULT_FONT_SETTINGS: FontSettings = {
  preset: 'system',
  customFamily: '',
};

const DEFAULT_FONT_MONO_FAMILY = '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace';

const FONT_PRESET_FAMILIES: Record<Exclude<FontFamilyPreset, 'custom'>, string> = {
  system: '"Source Sans 3", system-ui, sans-serif',
  serif: '"Playfair Display", Georgia, "Times New Roman", serif',
  monospace: DEFAULT_FONT_MONO_FAMILY,
};

const fontSettingsStorage = storage.defineItem<FontSettings>('local:fontSettings', {
  fallback: DEFAULT_FONT_SETTINGS,
});

function normalizeFontPreset(value: unknown): FontFamilyPreset {
  if (value === 'serif' || value === 'monospace' || value === 'custom') {
    return value;
  }
  return 'system';
}

function normalizeFontSettings(value: unknown): FontSettings {
  const rawValue = (value ?? {}) as Partial<FontSettings>;
  return {
    preset: normalizeFontPreset(rawValue.preset),
    customFamily: typeof rawValue.customFamily === 'string' ? rawValue.customFamily.trim() : '',
  };
}

export function resolveFontFamily(settings?: FontSettings | null): string {
  const normalized = normalizeFontSettings(settings ?? DEFAULT_FONT_SETTINGS);
  if (normalized.preset === 'custom') {
    return normalized.customFamily || FONT_PRESET_FAMILIES.system;
  }
  return FONT_PRESET_FAMILIES[normalized.preset];
}

export async function getFontSettings(): Promise<FontSettings> {
  const value = await fontSettingsStorage.getValue();
  return normalizeFontSettings(value);
}

export async function setFontSettings(settings: FontSettings): Promise<void> {
  await fontSettingsStorage.setValue(normalizeFontSettings(settings));
}

export function watchFontSettings(callback: (settings: FontSettings) => void): () => void {
  return fontSettingsStorage.watch((newValue) => {
    callback(normalizeFontSettings(newValue));
  });
}

export function applyFontSettings(settings: FontSettings, target?: HTMLElement | null): void {
  const root = target ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!root) return;

  const normalized = normalizeFontSettings(settings);
  const family = resolveFontFamily(normalized);
  const monoFamily =
    normalized.preset === 'monospace' ? FONT_PRESET_FAMILIES.monospace : DEFAULT_FONT_MONO_FAMILY;

  root.style.setProperty('--font-body', family);
  root.style.setProperty('--font-display', family);
  root.style.setProperty('--font-mono', monoFamily);
}

// ==================== Language Settings ====================

export type Language = 'en' | 'zh-CN';

const languageStorage = storage.defineItem<Language>('local:language', {
  fallback: 'en',
});

export async function getLanguage(): Promise<Language> {
  return await languageStorage.getValue();
}

export async function setLanguage(lang: Language): Promise<void> {
  await languageStorage.setValue(lang);
}

export function watchLanguage(callback: (lang: Language) => void): () => void {
  return languageStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Floating Ball Settings ====================

const floatingBallEnabledStorage = storage.defineItem<boolean>('local:floatingBallEnabled', {
  fallback: true,
});

export async function getFloatingBallEnabled(): Promise<boolean> {
  return await floatingBallEnabledStorage.getValue();
}

export async function setFloatingBallEnabled(enabled: boolean): Promise<void> {
  await floatingBallEnabledStorage.setValue(enabled);
}

export function watchFloatingBallEnabled(callback: (enabled: boolean) => void): () => void {
  return floatingBallEnabledStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Selection Quote Settings ====================

const selectionQuoteEnabledStorage = storage.defineItem<boolean>('local:selectionQuoteEnabled', {
  fallback: true,
});

export async function getSelectionQuoteEnabled(): Promise<boolean> {
  return await selectionQuoteEnabledStorage.getValue();
}

export async function setSelectionQuoteEnabled(enabled: boolean): Promise<void> {
  await selectionQuoteEnabledStorage.setValue(enabled);
}

export function watchSelectionQuoteEnabled(callback: (enabled: boolean) => void): () => void {
  return selectionQuoteEnabledStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Raw Extract Sites Settings ====================

const rawExtractSitesStorage = storage.defineItem<string[]>('local:rawExtractSites', {
  fallback: [],
});

export async function getRawExtractSites(): Promise<string[]> {
  return await rawExtractSitesStorage.getValue();
}

export async function setRawExtractSites(sites: string[]): Promise<void> {
  await rawExtractSitesStorage.setValue(sites);
}

function normalizeRawExtractSite(site: string): string {
  return site.toLowerCase().trim();
}

export async function addRawExtractSite(site: string): Promise<void> {
  const sites = await rawExtractSitesStorage.getValue();
  const normalized = normalizeRawExtractSite(site);
  const existed = sites.some(existing => normalizeRawExtractSite(existing) === normalized);
  if (normalized && !existed) {
    sites.push(normalized);
    await rawExtractSitesStorage.setValue(sites);
  }
}

export async function removeRawExtractSite(site: string): Promise<void> {
  const sites = await rawExtractSitesStorage.getValue();
  const normalized = normalizeRawExtractSite(site);
  if (!normalized) return;
  await rawExtractSitesStorage.setValue(
    sites.filter(existing => normalizeRawExtractSite(existing) !== normalized),
  );
}

export function watchRawExtractSites(callback: (sites: string[]) => void): () => void {
  return rawExtractSitesStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Page Content Limit Settings ====================

const DEFAULT_MAX_PAGE_CONTENT_LENGTH = 30000;
const DEFAULT_MAX_PDF_EXTRACT_PAGES = 30;
const DEFAULT_MAX_TOOL_CALLS = 100;

const maxPageContentLengthStorage = storage.defineItem<number>('local:maxPageContentLength', {
  fallback: DEFAULT_MAX_PAGE_CONTENT_LENGTH,
});

const maxPdfExtractPagesStorage = storage.defineItem<number>('local:maxPdfExtractPages', {
  fallback: DEFAULT_MAX_PDF_EXTRACT_PAGES,
});

function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function normalizeNonNegativeInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : fallback;
}

export async function getMaxPageContentLength(): Promise<number> {
  const value = await maxPageContentLengthStorage.getValue();
  return normalizePositiveInt(value, DEFAULT_MAX_PAGE_CONTENT_LENGTH);
}

export async function setMaxPageContentLength(value: number): Promise<void> {
  await maxPageContentLengthStorage.setValue(normalizePositiveInt(value, DEFAULT_MAX_PAGE_CONTENT_LENGTH));
}

export function watchMaxPageContentLength(callback: (value: number) => void): () => void {
  return maxPageContentLengthStorage.watch((newValue) => {
    callback(normalizePositiveInt(newValue, DEFAULT_MAX_PAGE_CONTENT_LENGTH));
  });
}

export async function getMaxPdfExtractPages(): Promise<number> {
  const value = await maxPdfExtractPagesStorage.getValue();
  return normalizeNonNegativeInt(value, DEFAULT_MAX_PDF_EXTRACT_PAGES);
}

export async function setMaxPdfExtractPages(value: number): Promise<void> {
  await maxPdfExtractPagesStorage.setValue(normalizeNonNegativeInt(value, DEFAULT_MAX_PDF_EXTRACT_PAGES));
}

export function watchMaxPdfExtractPages(callback: (value: number) => void): () => void {
  return maxPdfExtractPagesStorage.watch((newValue) => {
    callback(normalizeNonNegativeInt(newValue, DEFAULT_MAX_PDF_EXTRACT_PAGES));
  });
}

// ==================== Tool Call Limit Settings ====================

const maxToolCallsStorage = storage.defineItem<number>('local:maxToolCalls', {
  fallback: DEFAULT_MAX_TOOL_CALLS,
});

export async function getMaxToolCalls(): Promise<number> {
  const value = await maxToolCallsStorage.getValue();
  return normalizePositiveInt(value, DEFAULT_MAX_TOOL_CALLS);
}

export async function setMaxToolCalls(value: number): Promise<void> {
  await maxToolCallsStorage.setValue(normalizePositiveInt(value, DEFAULT_MAX_TOOL_CALLS));
}

export function watchMaxToolCalls(callback: (value: number) => void): () => void {
  return maxToolCallsStorage.watch((newValue) => {
    callback(normalizePositiveInt(newValue, DEFAULT_MAX_TOOL_CALLS));
  });
}

function normalizeLocalCompressionOptionalPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function normalizeLocalCompressionPrompt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function getLocalContextCompressionSettings(): Promise<LocalContextCompressionSettings> {
  const [
    enabled,
    autoCompactTokenLimit,
    keepRecentUserTokens,
    summaryMaxTokens,
    compactPrompt,
    maxCompactionsPerTurn,
  ] = await Promise.all([
    localContextCompressionEnabledStorage.getValue(),
    localContextAutoCompactTokenLimitStorage.getValue(),
    localContextKeepRecentUserTokensStorage.getValue(),
    localContextCompressionSummaryMaxTokensStorage.getValue(),
    localContextCompactPromptStorage.getValue(),
    localContextMaxCompactionsPerTurnStorage.getValue(),
  ]);

  return {
    enabled: Boolean(enabled),
    autoCompactTokenLimit: normalizeLocalCompressionOptionalPositiveInt(autoCompactTokenLimit),
    keepRecentUserTokens: normalizeNonNegativeInt(
      typeof keepRecentUserTokens === 'number' ? keepRecentUserTokens : NaN,
      DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.keepRecentUserTokens,
    ),
    summaryMaxTokens: normalizePositiveInt(
      typeof summaryMaxTokens === 'number' ? summaryMaxTokens : NaN,
      DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.summaryMaxTokens,
    ),
    compactPrompt: normalizeLocalCompressionPrompt(compactPrompt),
    maxCompactionsPerTurn: normalizePositiveInt(
      typeof maxCompactionsPerTurn === 'number' ? maxCompactionsPerTurn : NaN,
      DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.maxCompactionsPerTurn,
    ),
  };
}

export async function setLocalContextCompressionSettings(
  settings: LocalContextCompressionSettings,
): Promise<void> {
  const normalized: LocalContextCompressionSettings = {
    enabled: Boolean(settings.enabled),
    autoCompactTokenLimit: normalizeLocalCompressionOptionalPositiveInt(settings.autoCompactTokenLimit),
    keepRecentUserTokens: normalizeNonNegativeInt(
      settings.keepRecentUserTokens,
      DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.keepRecentUserTokens,
    ),
    summaryMaxTokens: normalizePositiveInt(
      settings.summaryMaxTokens,
      DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.summaryMaxTokens,
    ),
    compactPrompt: normalizeLocalCompressionPrompt(settings.compactPrompt),
    maxCompactionsPerTurn: normalizePositiveInt(
      settings.maxCompactionsPerTurn,
      DEFAULT_LOCAL_CONTEXT_COMPRESSION_SETTINGS.maxCompactionsPerTurn,
    ),
  };

  await Promise.all([
    localContextCompressionEnabledStorage.setValue(normalized.enabled),
    localContextAutoCompactTokenLimitStorage.setValue(normalized.autoCompactTokenLimit),
    localContextKeepRecentUserTokensStorage.setValue(normalized.keepRecentUserTokens),
    localContextCompressionSummaryMaxTokensStorage.setValue(normalized.summaryMaxTokens),
    localContextCompactPromptStorage.setValue(normalized.compactPrompt),
    localContextMaxCompactionsPerTurnStorage.setValue(normalized.maxCompactionsPerTurn),
  ]);
}

// 检查 URL 是否匹配原始提取网站列表
export function isRawExtractSite(url: string, sites: string[]): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return sites.some(site => hostname.includes(site));
  } catch {
    return false;
  }
}

// 检测浏览器语言并返回匹配的语言设置
export function detectBrowserLanguage(): Language {
  const browserLang = navigator.language || (navigator as any).userLanguage || 'en';
  // 检查是否为简体中文
  if (browserLang.toLowerCase().startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en';
}

// 初始化语言设置（仅在首次安装时调用）
export async function initializeLanguage(): Promise<void> {
  const detectedLang = detectBrowserLanguage();
  await setLanguage(detectedLang);
}

// ==================== Watch Helpers ====================

export function watchProviders(callback: (providers: AIProvider[]) => void): () => void {
  return providersStorage.watch((newValue) => {
    callback(newValue.map(normalizeProvider));
  });
}

export function watchActiveProviderId(callback: (id: string | null) => void): () => void {
  return activeProviderIdStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Providers ====================

export async function getAllProviders(): Promise<AIProvider[]> {
  const providers = await providersStorage.getValue();
  return providers.map(normalizeProvider);
}

export async function getProvider(id: string): Promise<AIProvider | undefined> {
  const providers = await providersStorage.getValue();
  const provider = providers.find((p: AIProvider) => p.id === id);
  return provider ? normalizeProvider(provider) : undefined;
}

export async function saveProvider(provider: AIProvider): Promise<void> {
  await runProvidersMutation(async () => {
    const providers = (await providersStorage.getValue()).map(normalizeProvider);
    const normalizedProvider = normalizeProvider(provider);
    const index = providers.findIndex((p: AIProvider) => p.id === provider.id);
    const nextProviders = [...providers];
    if (index >= 0) {
      nextProviders[index] = normalizedProvider;
    } else {
      nextProviders.push(normalizedProvider);
    }
    await providersStorage.setValue(nextProviders);
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await runProvidersMutation(async () => {
    const providers = (await providersStorage.getValue()).map(normalizeProvider);
    await providersStorage.setValue(providers.filter((p: AIProvider) => p.id !== id));
  });
}

export async function getActiveProvider(): Promise<AIProvider | null> {
  const activeId = await activeProviderIdStorage.getValue();
  if (!activeId) return null;
  const provider = await getProvider(activeId);
  return provider ? normalizeProvider(provider) : null;
}

export async function setActiveProviderId(id: string | null): Promise<void> {
  await activeProviderIdStorage.setValue(id);
}

type LegacyProvider = Partial<AIProvider> & {
  supportsVision?: boolean;
  visionModelSupport?: Record<string, boolean> | undefined;
};

const ALL_REASONING_EFFORTS: ResponsesReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

const MODEL_REASONING_EFFORT_RULES: Array<{ pattern: RegExp; efforts: ResponsesReasoningEffort[] }> = [
  { pattern: /^gpt-5-pro(?:$|[-_.])/i, efforts: ['high'] },
  { pattern: /^gpt-5\.2-pro(?:$|[-_.])/i, efforts: ['medium', 'high', 'xhigh'] },
  { pattern: /^gpt-5\.2(?:$|[-_.])/i, efforts: ['none', 'low', 'medium', 'high', 'xhigh'] },
  { pattern: /^gpt-5\.1(?:$|[-_.])/i, efforts: ['none', 'low', 'medium', 'high'] },
];

function normalizeApiMode(value: unknown): ProviderApiMode {
  if (value === 'chat_completions' || value === 'responses') {
    return value;
  }
  return 'auto';
}

function normalizeModelList(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  return Array.from(
    new Set(
      models
        .filter((model): model is string => typeof model === 'string')
        .map(model => model.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeModelNameForReasoning(model: string | null | undefined): string {
  if (typeof model !== 'string') return '';
  return model.trim().toLowerCase();
}

export function getReasoningEffortsForModel(model?: string | null): ResponsesReasoningEffort[] {
  const normalized = normalizeModelNameForReasoning(model);
  if (!normalized) return [...ALL_REASONING_EFFORTS];

  for (const rule of MODEL_REASONING_EFFORT_RULES) {
    if (rule.pattern.test(normalized)) {
      return [...rule.efforts];
    }
  }

  return [...ALL_REASONING_EFFORTS];
}

export function getDefaultReasoningEffortForModel(model?: string | null): ResponsesReasoningEffort {
  const efforts = getReasoningEffortsForModel(model);
  if (efforts.includes('medium')) return 'medium';
  if (efforts.includes('high')) return 'high';
  return efforts[0];
}

function normalizeResponsesReasoningEffort(
  value: unknown,
  model?: string | null,
): ResponsesReasoningEffort {
  const supported = getReasoningEffortsForModel(model);
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase() as ResponsesReasoningEffort;
    if (supported.includes(normalized)) {
      return normalized;
    }
  }
  return getDefaultReasoningEffortForModel(model);
}

function normalizeResponsesReasoningSummary(value: unknown): ResponsesReasoningSummary {
  return value === 'auto' ? 'auto' : 'auto';
}

function normalizeSystemPromptTemplate(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  }
  const normalized = value.trim();
  return normalized || DEFAULT_SYSTEM_PROMPT_TEMPLATE;
}

function normalizeResponsesSystemPromptMode(value: unknown): ResponsesSystemPromptMode {
  return 'instructions';
}

function normalizeVisionModelSupport(
  models: string[],
  provider: LegacyProvider,
): Record<string, boolean> {
  const rawSupport = provider.visionModelSupport;
  const supportMap: Record<string, boolean> =
    rawSupport && typeof rawSupport === 'object' && !Array.isArray(rawSupport)
      ? rawSupport
      : {};
  const legacySupportsVision = Boolean(provider.supportsVision);
  const normalized: Record<string, boolean> = {};
  for (const model of models) {
    const value = supportMap[model];
    normalized[model] = typeof value === 'boolean' ? value : legacySupportsVision;
  }
  return normalized;
}

function normalizeOptionalPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function normalizeProvider(provider: AIProvider): AIProvider {
  const legacyProvider = provider as LegacyProvider;
  const models = normalizeModelList(legacyProvider.models);
  const selectedModel =
    typeof legacyProvider.selectedModel === 'string' && models.includes(legacyProvider.selectedModel)
      ? legacyProvider.selectedModel
      : models[0] || '';
  const visionModelSupport = normalizeVisionModelSupport(models, legacyProvider);
  const apiMode = normalizeApiMode(legacyProvider.apiMode);
  const systemPromptTemplate = normalizeSystemPromptTemplate(legacyProvider.systemPromptTemplate);
  const responsesSystemPromptMode = normalizeResponsesSystemPromptMode(legacyProvider.responsesSystemPromptMode);
  const responsesReasoningEffort = normalizeResponsesReasoningEffort(
    legacyProvider.responsesReasoningEffort,
    selectedModel,
  );
  const responsesReasoningSummary = normalizeResponsesReasoningSummary(legacyProvider.responsesReasoningSummary);
  const contextWindowTokens = normalizeOptionalPositiveInt(legacyProvider.contextWindowTokens);
  const maxOutputTokens = normalizeOptionalPositiveInt(legacyProvider.maxOutputTokens);

  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    models,
    selectedModel,
    visionModelSupport,
    apiMode,
    systemPromptTemplate,
    responsesSystemPromptMode,
    responsesReasoningEffort,
    responsesReasoningSummary,
    contextWindowTokens,
    maxOutputTokens,
  };
}

export function isVisionSupportedForModel(
  provider: AIProvider | null | undefined,
  model?: string | null,
): boolean {
  if (!provider) return false;
  const targetModel = model ?? provider.selectedModel;
  if (!targetModel) return false;
  return Boolean(provider.visionModelSupport?.[targetModel]);
}

// ==================== Trusted Scripts ====================

export async function isScriptTrusted(skillId: string, scriptName: string): Promise<boolean> {
  const scripts = await trustedScriptsStorage.getValue();
  return scripts.some((s: TrustedScript) => s.skillId === skillId && s.scriptName === scriptName);
}

export async function trustScript(skillId: string, scriptName: string): Promise<void> {
  await runTrustedScriptsMutation(async () => {
    const scripts = await trustedScriptsStorage.getValue();
    if (!scripts.some((s: TrustedScript) => s.skillId === skillId && s.scriptName === scriptName)) {
      await trustedScriptsStorage.setValue([
        ...scripts,
        { skillId, scriptName, trustedAt: Date.now() },
      ]);
    }
  });
}

export async function untrustScript(skillId: string, scriptName: string): Promise<void> {
  await runTrustedScriptsMutation(async () => {
    const scripts = await trustedScriptsStorage.getValue();
    await trustedScriptsStorage.setValue(
      scripts.filter((s: TrustedScript) => !(s.skillId === skillId && s.scriptName === scriptName))
    );
  });
}

export async function getTrustedScripts(): Promise<TrustedScript[]> {
  return await trustedScriptsStorage.getValue();
}

// 删除某个 skill 的所有信任记录
export async function removeTrustedScriptsBySkillId(skillId: string): Promise<void> {
  await runTrustedScriptsMutation(async () => {
    const scripts = await trustedScriptsStorage.getValue();
    await trustedScriptsStorage.setValue(scripts.filter((s: TrustedScript) => s.skillId !== skillId));
  });
}

// ==================== 重新导出 IndexedDB 的其他功能 ====================

export type {
  ChatMessage,
  ApiMessageRecord,
  ChatSession,
} from './db';

// Session functions
export {
  getAllSessions,
  getSession,
  getCurrentSession,
  setCurrentSessionId,
  createSession,
  updateSession,
  deleteSession,
  generateSessionTitle,
} from './db';

// Settings
export {
  getSharePageContent,
  setSharePageContent,
} from './db';
