/**
 * 数据导出与导入
 * 支持导出/导入所有用户数据（配置、历史记录、技能等）
 */

import {
  getAllProviders,
  getActiveProvider,
  setActiveProviderId,
  saveProvider,
  deleteProvider,
  getTrustedScripts,
  trustScript,
  getThemeMode,
  setThemeMode,
  getLanguage,
  setLanguage,
  getFloatingBallEnabled,
  setFloatingBallEnabled,
  getSelectionQuoteEnabled,
  setSelectionQuoteEnabled,
  getRawExtractSites,
  setRawExtractSites,
  getMaxPageContentLength,
  setMaxPageContentLength,
  getMaxPdfExtractPages,
  setMaxPdfExtractPages,
  getMaxToolCalls,
  setMaxToolCalls,
  getLocalContextCompressionSettings,
  setLocalContextCompressionSettings,
  getFontSettings,
  setFontSettings,
  getPresetActions,
  setPresetActions,
  type AIProvider,
  type FontSettings,
  type LocalContextCompressionSettings,
  type TrustedScript,
  type ThemeMode,
  type Language,
  type PresetAction,
  removeTrustedScriptsBySkillId,
} from './storage';

import {
  getAllSessions,
  getAllSkills,
  getSkillFiles,
  saveSkill,
  saveSkillFile,
  getDB,
  getSharePageContent,
  setSharePageContent,
  getWebSearchEnabled,
  setWebSearchEnabled,
  type ChatSession,
  type Skill,
  type SkillFile,
} from './db';

import {
  getAllMcpServers,
  saveMcpServer,
  deleteMcpServer,
  type McpServerConfig,
} from './mcpStorage';
import {
  clearOAuthData,
  getOAuthData,
  setOAuthData,
  type McpOAuthData,
} from './mcpOAuth';

// ==================== 类型定义 ====================

const EXPORT_VERSION = 1;

export interface ExportData {
  version: number;
  exportedAt: number;
  data: {
    // WXT Storage 配置
    providers: AIProvider[];
    activeProviderId: string | null;
    trustedScripts: TrustedScript[];
    themeMode: ThemeMode;
    language: Language;
    floatingBallEnabled: boolean;
    selectionQuoteEnabled: boolean;
    fontSettings: FontSettings;
    rawExtractSites: string[];
    maxPageContentLength: number;
    maxPdfExtractPages: number;
    maxToolCalls: number;
    localContextCompressionSettings: LocalContextCompressionSettings;
    presetActions: PresetAction[];
    mcpServers: McpServerConfig[];
    mcpOAuthStates: ExportMcpOAuthState[];
    sharePageContent: boolean;
    webSearchEnabled: boolean;

    // IndexedDB 数据
    chatSessions: ChatSession[];
    skills: Skill[];
    skillFiles: ExportSkillFile[];
  };
}

/** SkillFile 的可序列化版本，content 使用 base64 */
interface ExportSkillFile {
  skillId: string;
  path: string;
  contentBase64: string;
  mimeType: string;
  size: number;
  isText: boolean;
}

interface ExportMcpOAuthState {
  serverId: string;
  data: McpOAuthData;
}

interface PreparedImportData {
  providers: AIProvider[];
  activeProviderId: string | null;
  trustedScripts: TrustedScript[];
  themeMode?: ThemeMode;
  language?: Language;
  floatingBallEnabled?: boolean;
  selectionQuoteEnabled?: boolean;
  fontSettings?: FontSettings;
  rawExtractSites: string[];
  maxPageContentLength?: number;
  maxPdfExtractPages?: number;
  maxToolCalls?: number;
  localContextCompressionSettings?: LocalContextCompressionSettings;
  presetActions: PresetAction[];
  mcpServers: McpServerConfig[];
  mcpOAuthStates: ExportMcpOAuthState[];
  sharePageContent?: boolean;
  webSearchEnabled?: boolean;
  chatSessions: ChatSession[];
  skills: Skill[];
  skillFiles: SkillFile[];
}

export interface ImportResult {
  success: boolean;
  error?: string;
  stats?: {
    providers: number;
    chatSessions: number;
    skills: number;
    skillFiles: number;
    mcpServers: number;
    mcpOAuthStates: number;
    presetActions: number;
  };
}

// ==================== 导出 ====================

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function exportAllData(): Promise<ExportData> {
  // 收集 WXT Storage 数据
  const [
    providers,
    activeProvider,
    trustedScripts,
    themeMode,
    language,
    floatingBallEnabled,
    selectionQuoteEnabled,
    fontSettings,
    rawExtractSites,
    maxPageContentLength,
    maxPdfExtractPages,
    maxToolCalls,
    localContextCompressionSettings,
    presetActions,
    mcpServers,
    sharePageContent,
    webSearchEnabled,
  ] = await Promise.all([
    getAllProviders(),
    getActiveProvider(),
    getTrustedScripts(),
    getThemeMode(),
    getLanguage(),
    getFloatingBallEnabled(),
    getSelectionQuoteEnabled(),
    getFontSettings(),
    getRawExtractSites(),
    getMaxPageContentLength(),
    getMaxPdfExtractPages(),
    getMaxToolCalls(),
    getLocalContextCompressionSettings(),
    getPresetActions(),
    getAllMcpServers(),
    getSharePageContent(),
    getWebSearchEnabled(),
  ]);

  // 收集 IndexedDB 数据
  const [chatSessions, skills] = await Promise.all([
    getAllSessions(),
    getAllSkills(),
  ]);

  const mcpOAuthStates = (
    await Promise.all(
      mcpServers.map(async (server) => ({
        serverId: server.id,
        data: await getOAuthData(server.id),
      })),
    )
  ).filter((state) => Object.keys(state.data).length > 0);

  // 收集所有 skill 的文件（ArrayBuffer → base64）
  const allSkillFiles: ExportSkillFile[] = [];
  for (const skill of skills) {
    const files = await getSkillFiles(skill.id);
    for (const file of files) {
      allSkillFiles.push({
        skillId: file.skillId,
        path: file.path,
        contentBase64: arrayBufferToBase64(file.content),
        mimeType: file.mimeType,
        size: file.size,
        isText: file.isText,
      });
    }
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    data: {
      providers,
      activeProviderId: activeProvider?.id ?? null,
      trustedScripts,
      themeMode,
      language,
      floatingBallEnabled,
      selectionQuoteEnabled,
      fontSettings,
      rawExtractSites,
      maxPageContentLength,
      maxPdfExtractPages,
      maxToolCalls,
      localContextCompressionSettings,
      presetActions,
      mcpServers,
      mcpOAuthStates,
      sharePageContent,
      webSearchEnabled,
      chatSessions,
      skills,
      skillFiles: allSkillFiles,
    },
  };
}

/** 将导出数据下载为 JSON 文件 */
export function downloadExportData(data: ExportData): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tactus-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== 导入 ====================

/** 验证导入数据的基本结构 */
function validateExportData(data: unknown): data is ExportData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (typeof d.version !== 'number') return false;
  if (typeof d.exportedAt !== 'number') return false;
  if (!d.data || typeof d.data !== 'object') return false;

  const inner = d.data as Record<string, unknown>;
  // 检查必要字段存在且类型正确
  if (!Array.isArray(inner.providers)) return false;
  if (!Array.isArray(inner.chatSessions)) return false;

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`INVALID_FORMAT:${field}`);
  }
  return value as T[];
}

function prepareImportData(raw: unknown): PreparedImportData {
  if (!validateExportData(raw)) {
    throw new Error('INVALID_FORMAT');
  }

  const { data } = raw;
  const exportedSkillFiles = requireArray<ExportSkillFile>(data.skillFiles, 'skillFiles');
  const exportedMcpOAuthStates = Array.isArray(data.mcpOAuthStates)
    ? data.mcpOAuthStates as ExportMcpOAuthState[]
    : [];

  const skillFiles = exportedSkillFiles.map((file) => ({
    skillId: file.skillId,
    path: file.path,
    content: base64ToArrayBuffer(file.contentBase64),
    mimeType: file.mimeType,
    size: file.size,
    isText: file.isText,
  }));

  const mcpOAuthStates = exportedMcpOAuthStates.map((state) => {
    if (!isRecord(state) || typeof state.serverId !== 'string' || !isRecord(state.data)) {
      throw new Error('INVALID_FORMAT:mcpOAuthStates');
    }
    return {
      serverId: state.serverId,
      data: state.data as McpOAuthData,
    };
  });

  return {
    providers: requireArray<AIProvider>(data.providers, 'providers'),
    activeProviderId: typeof data.activeProviderId === 'string' || data.activeProviderId === null
      ? data.activeProviderId
      : null,
    trustedScripts: requireArray<TrustedScript>(data.trustedScripts, 'trustedScripts'),
    themeMode: data.themeMode,
    language: data.language,
    floatingBallEnabled: data.floatingBallEnabled,
    selectionQuoteEnabled: data.selectionQuoteEnabled,
    fontSettings: data.fontSettings,
    rawExtractSites: requireArray<string>(data.rawExtractSites, 'rawExtractSites'),
    maxPageContentLength: data.maxPageContentLength,
    maxPdfExtractPages: data.maxPdfExtractPages,
    maxToolCalls: data.maxToolCalls,
    localContextCompressionSettings: data.localContextCompressionSettings,
    presetActions: requireArray<PresetAction>(data.presetActions, 'presetActions'),
    mcpServers: requireArray<McpServerConfig>(data.mcpServers, 'mcpServers'),
    mcpOAuthStates,
    sharePageContent: data.sharePageContent,
    webSearchEnabled: data.webSearchEnabled,
    chatSessions: requireArray<ChatSession>(data.chatSessions, 'chatSessions'),
    skills: requireArray<Skill>(data.skills, 'skills'),
    skillFiles,
  };
}

async function replaceAllData(data: PreparedImportData): Promise<void> {
  const [existingProviders, existingSkills, existingMcpServers, db] = await Promise.all([
    getAllProviders(),
    getAllSkills(),
    getAllMcpServers(),
    getDB(),
  ]);

  const oauthServerIds = new Set<string>([
    ...existingMcpServers.map((server) => server.id),
    ...data.mcpServers.map((server) => server.id),
    ...data.mcpOAuthStates.map((state) => state.serverId),
  ]);

  for (const provider of existingProviders) {
    await deleteProvider(provider.id);
  }

  for (const skill of existingSkills) {
    await removeTrustedScriptsBySkillId(skill.id);
  }

  for (const server of existingMcpServers) {
    await deleteMcpServer(server.id);
  }

  await Promise.all([
    db.clear('chatSessions'),
    db.clear('skills'),
    db.clear('skillFiles'),
  ]);

  for (const serverId of oauthServerIds) {
    await clearOAuthData(serverId);
  }

  for (const provider of data.providers) {
    await saveProvider(provider);
  }
  await setActiveProviderId(data.activeProviderId ?? null);

  for (const trustedScript of data.trustedScripts) {
    await trustScript(trustedScript.skillId, trustedScript.scriptName);
  }

  if (data.themeMode) await setThemeMode(data.themeMode);
  if (data.language) await setLanguage(data.language);
  if (typeof data.floatingBallEnabled === 'boolean') await setFloatingBallEnabled(data.floatingBallEnabled);
  if (typeof data.selectionQuoteEnabled === 'boolean') await setSelectionQuoteEnabled(data.selectionQuoteEnabled);
  if (data.fontSettings) await setFontSettings(data.fontSettings);
  await setRawExtractSites(data.rawExtractSites);
  if (typeof data.maxPageContentLength === 'number') await setMaxPageContentLength(data.maxPageContentLength);
  if (typeof data.maxPdfExtractPages === 'number') await setMaxPdfExtractPages(data.maxPdfExtractPages);
  if (typeof data.maxToolCalls === 'number') await setMaxToolCalls(data.maxToolCalls);
  if (data.localContextCompressionSettings) {
    await setLocalContextCompressionSettings(data.localContextCompressionSettings);
  }
  await setPresetActions(data.presetActions);
  if (typeof data.sharePageContent === 'boolean') await setSharePageContent(data.sharePageContent);
  if (typeof data.webSearchEnabled === 'boolean') await setWebSearchEnabled(data.webSearchEnabled);

  for (const server of data.mcpServers) {
    await saveMcpServer(server);
  }

  for (const state of data.mcpOAuthStates) {
    await setOAuthData(state.serverId, state.data);
  }

  for (const session of data.chatSessions) {
    await db.put('chatSessions', session);
  }

  for (const skill of data.skills) {
    await saveSkill(skill);
  }

  for (const file of data.skillFiles) {
    await saveSkillFile(file);
  }
}

/** 从 JSON 文件读取导入数据 */
export function readImportFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        resolve(data);
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    };
    reader.onerror = () => reject(new Error('FILE_READ_ERROR'));
    reader.readAsText(file);
  });
}

/** 导入所有数据（覆盖式） */
export async function importAllData(raw: unknown): Promise<ImportResult> {
  let snapshot: ExportData | null = null;
  try {
    const prepared = prepareImportData(raw);
    snapshot = await exportAllData();
    await replaceAllData(prepared);

    return {
      success: true,
      stats: {
        providers: prepared.providers.length,
        chatSessions: prepared.chatSessions.length,
        skills: prepared.skills.length,
        skillFiles: prepared.skillFiles.length,
        mcpServers: prepared.mcpServers.length,
        mcpOAuthStates: prepared.mcpOAuthStates.length,
        presetActions: prepared.presetActions.length,
      },
    };
  } catch (e) {
    if (snapshot) {
      try {
        const rollbackData = prepareImportData(snapshot);
        await replaceAllData(rollbackData);
      } catch (rollbackError) {
        console.error('[dataTransfer] 导入失败且回滚失败:', rollbackError);
      }
    }

    const errorMessage = e instanceof Error ? e.message : 'UNKNOWN_ERROR';
    return {
      success: false,
      error: errorMessage.startsWith('INVALID_FORMAT') ? 'INVALID_FORMAT' : errorMessage,
    };
  }
}
