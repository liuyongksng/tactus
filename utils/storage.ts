/**
 * 存储层 - WXT Storage 用于需要跨页面同步的配置数据
 * AI Providers 和 Trusted Scripts 使用 WXT storage（自动同步）
 * 其他大数据继续使用 IndexedDB
 */

import { storage } from '@wxt-dev/storage';

// ==================== 类型定义 ====================

export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  selectedModel: string;
}

export interface TrustedScript {
  skillId: string;
  scriptName: string;
  trustedAt: number;
}

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

// ==================== Watch Helpers ====================

export function watchProviders(callback: (providers: AIProvider[]) => void): () => void {
  return providersStorage.watch((newValue) => {
    callback(newValue);
  });
}

export function watchActiveProviderId(callback: (id: string | null) => void): () => void {
  return activeProviderIdStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Providers ====================

export async function getAllProviders(): Promise<AIProvider[]> {
  return await providersStorage.getValue();
}

export async function getProvider(id: string): Promise<AIProvider | undefined> {
  const providers = await providersStorage.getValue();
  return providers.find((p: AIProvider) => p.id === id);
}

export async function saveProvider(provider: AIProvider): Promise<void> {
  const providers = await providersStorage.getValue();
  const index = providers.findIndex((p: AIProvider) => p.id === provider.id);
  if (index >= 0) {
    providers[index] = provider;
  } else {
    providers.push(provider);
  }
  await providersStorage.setValue(providers);
}

export async function deleteProvider(id: string): Promise<void> {
  const providers = await providersStorage.getValue();
  await providersStorage.setValue(providers.filter((p: AIProvider) => p.id !== id));
}

export async function getActiveProvider(): Promise<AIProvider | null> {
  const activeId = await activeProviderIdStorage.getValue();
  if (!activeId) return null;
  const provider = await getProvider(activeId);
  return provider || null;
}

export async function setActiveProviderId(id: string | null): Promise<void> {
  await activeProviderIdStorage.setValue(id);
}

// ==================== Trusted Scripts ====================

export async function isScriptTrusted(skillId: string, scriptName: string): Promise<boolean> {
  const scripts = await trustedScriptsStorage.getValue();
  return scripts.some((s: TrustedScript) => s.skillId === skillId && s.scriptName === scriptName);
}

export async function trustScript(skillId: string, scriptName: string): Promise<void> {
  const scripts = await trustedScriptsStorage.getValue();
  if (!scripts.some((s: TrustedScript) => s.skillId === skillId && s.scriptName === scriptName)) {
    scripts.push({ skillId, scriptName, trustedAt: Date.now() });
    await trustedScriptsStorage.setValue(scripts);
  }
}

export async function untrustScript(skillId: string, scriptName: string): Promise<void> {
  const scripts = await trustedScriptsStorage.getValue();
  await trustedScriptsStorage.setValue(
    scripts.filter((s: TrustedScript) => !(s.skillId === skillId && s.scriptName === scriptName))
  );
}

export async function getTrustedScripts(): Promise<TrustedScript[]> {
  return await trustedScriptsStorage.getValue();
}

// 删除某个 skill 的所有信任记录
export async function removeTrustedScriptsBySkillId(skillId: string): Promise<void> {
  const scripts = await trustedScriptsStorage.getValue();
  await trustedScriptsStorage.setValue(scripts.filter((s: TrustedScript) => s.skillId !== skillId));
}

// ==================== 重新导出 IndexedDB 的其他功能 ====================

export type {
  ChatMessage,
  ApiMessageRecord,
  ChatSession,
} from './db';

export {
  // Session functions
  getAllSessions,
  getSession,
  getCurrentSession,
  setCurrentSessionId,
  createSession,
  updateSession,
  deleteSession,
  generateSessionTitle,
  
  // Settings
  getSharePageContent,
  setSharePageContent,
} from './db';
