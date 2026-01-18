/**
 * IndexedDB 存储层 - 使用 idb 库
 * 统一管理所有数据存储
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// 数据库 Schema 定义
export interface AppDBSchema extends DBSchema {
  // AI 服务商配置
  providers: {
    key: string;
    value: AIProvider;
  };
  
  // 聊天会话
  chatSessions: {
    key: string;
    value: ChatSession;
    indexes: { 'by-updatedAt': number };
  };
  
  // Skills 元数据
  skills: {
    key: string;
    value: Skill;
    indexes: { 'by-name': string; 'by-importedAt': number };
  };
  
  // Skill 文件内容
  skillFiles: {
    key: [string, string]; // [skillId, relativePath]
    value: SkillFile;
    indexes: { 'by-skillId': string };
  };
  
  // 已信任的脚本
  trustedScripts: {
    key: [string, string]; // [skillId, scriptName]
    value: TrustedScript;
    indexes: { 'by-skillId': string };
  };
  
  // 通用设置
  settings: {
    key: string;
    value: any;
  };
}

// 类型定义
export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  selectedModel: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  pageContext?: string;
  quote?: string;
}

export interface ApiMessageRecord {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  apiMessages?: ApiMessageRecord[];
  createdAt: number;
  updatedAt: number;
  providerId?: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, any>;
  allowedTools?: string[];
}

export interface SkillScript {
  name: string;
  path: string;
  language: 'javascript';
  trusted: boolean;
}

export interface SkillResource {
  name: string;
  path: string;
  type: 'reference' | 'asset';
}

export interface Skill {
  id: string;
  metadata: SkillMetadata;
  instructions: string;
  scripts: SkillScript[];
  references: SkillResource[];
  assets: SkillResource[];
  source: 'imported' | 'builtin';
  importedAt: number;
  location: string;
}

export interface SkillFile {
  skillId: string;
  path: string;
  content: ArrayBuffer;
  mimeType: string;
  size: number;
  isText: boolean;
}

export interface TrustedScript {
  skillId: string;
  scriptName: string;
  trustedAt: number;
}

// 数据库实例
const DB_NAME = 'TCAgentDB';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<AppDBSchema> | null = null;

// 获取数据库实例
export async function getDB(): Promise<IDBPDatabase<AppDBSchema>> {
  if (dbInstance) return dbInstance;
  
  dbInstance = await openDB<AppDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // providers store
      if (!db.objectStoreNames.contains('providers')) {
        db.createObjectStore('providers', { keyPath: 'id' });
      }
      
      // chatSessions store
      if (!db.objectStoreNames.contains('chatSessions')) {
        const sessionStore = db.createObjectStore('chatSessions', { keyPath: 'id' });
        sessionStore.createIndex('by-updatedAt', 'updatedAt');
      }
      
      // skills store
      if (!db.objectStoreNames.contains('skills')) {
        const skillStore = db.createObjectStore('skills', { keyPath: 'id' });
        skillStore.createIndex('by-name', 'metadata.name');
        skillStore.createIndex('by-importedAt', 'importedAt');
      }
      
      // skillFiles store
      if (!db.objectStoreNames.contains('skillFiles')) {
        const fileStore = db.createObjectStore('skillFiles', { keyPath: ['skillId', 'path'] });
        fileStore.createIndex('by-skillId', 'skillId');
      }
      
      // trustedScripts store
      if (!db.objectStoreNames.contains('trustedScripts')) {
        const trustStore = db.createObjectStore('trustedScripts', { keyPath: ['skillId', 'scriptName'] });
        trustStore.createIndex('by-skillId', 'skillId');
      }
      
      // settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    },
  });
  
  return dbInstance;
}

// ==================== Settings ====================

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDB();
  const value = await db.get('settings', key);
  return value !== undefined ? value : fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await getDB();
  await db.put('settings', value, key);
}

// ==================== Providers ====================
// 已迁移到 utils/storage.ts 使用 WXT storage

// ==================== Chat Sessions ====================

export async function getAllSessions(): Promise<ChatSession[]> {
  const db = await getDB();
  const sessions = await db.getAllFromIndex('chatSessions', 'by-updatedAt');
  return sessions
    .map(s => ({ ...s, messages: s.messages || [] }))
    .reverse(); // 最新的在前
}

export async function getSession(id: string): Promise<ChatSession | null> {
  const db = await getDB();
  const session = await db.get('chatSessions', id);
  return session || null;
}

export async function getCurrentSession(): Promise<ChatSession | null> {
  const currentId = await getSetting<string | null>('currentSessionId', null);
  if (!currentId) return null;
  return getSession(currentId);
}

export async function setCurrentSessionId(id: string | null): Promise<void> {
  await setSetting('currentSessionId', id);
}

export async function createSession(providerId?: string): Promise<ChatSession> {
  const session: ChatSession = {
    id: crypto.randomUUID(),
    title: '新对话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    providerId,
  };
  const db = await getDB();
  await db.put('chatSessions', session);
  await setCurrentSessionId(session.id);
  return session;
}

export async function updateSession(session: ChatSession): Promise<void> {
  const db = await getDB();
  const updated = {
    ...session,
    messages: JSON.parse(JSON.stringify(session.messages || [])),
    updatedAt: Date.now(),
  };
  await db.put('chatSessions', updated);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('chatSessions', id);
  
  const currentId = await getSetting<string | null>('currentSessionId', null);
  if (currentId === id) {
    const sessions = await getAllSessions();
    await setCurrentSessionId(sessions[0]?.id || null);
  }
}

export async function generateSessionTitle(firstMessage: string): Promise<string> {
  const maxLen = 20;
  const title = firstMessage.replace(/\n/g, ' ').trim();
  return title.length > maxLen ? title.substring(0, maxLen) + '...' : title;
}

// ==================== Skills ====================

export async function getAllSkills(): Promise<Skill[]> {
  const db = await getDB();
  return db.getAll('skills');
}

export async function getSkill(id: string): Promise<Skill | null> {
  const db = await getDB();
  const skill = await db.get('skills', id);
  return skill || null;
}

export async function getSkillByName(name: string): Promise<Skill | null> {
  const db = await getDB();
  const skill = await db.getFromIndex('skills', 'by-name', name);
  return skill || null;
}

export async function saveSkill(skill: Skill): Promise<void> {
  const db = await getDB();
  await db.put('skills', skill);
}

export async function deleteSkill(id: string): Promise<void> {
  const db = await getDB();
  
  // 删除关联的文件
  const tx = db.transaction(['skills', 'skillFiles'], 'readwrite');
  
  // 删除 skill 文件
  const fileIndex = tx.objectStore('skillFiles').index('by-skillId');
  let cursor = await fileIndex.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  
  // 删除 skill 本身
  await tx.objectStore('skills').delete(id);
  
  await tx.done;
  
  // 删除信任记录（从 WXT storage）
  const { removeTrustedScriptsBySkillId } = await import('./storage');
  await removeTrustedScriptsBySkillId(id);
}

// ==================== Skill Files ====================

export async function saveSkillFile(file: SkillFile): Promise<void> {
  const db = await getDB();
  await db.put('skillFiles', file);
}

export async function getSkillFile(skillId: string, path: string): Promise<SkillFile | null> {
  const db = await getDB();
  const file = await db.get('skillFiles', [skillId, path]);
  return file || null;
}

export async function getSkillFiles(skillId: string): Promise<SkillFile[]> {
  const db = await getDB();
  return db.getAllFromIndex('skillFiles', 'by-skillId', skillId);
}

export async function deleteSkillFile(skillId: string, path: string): Promise<void> {
  const db = await getDB();
  await db.delete('skillFiles', [skillId, path]);
}

// 辅助函数：获取文件文本内容
export async function getSkillFileAsText(skillId: string, path: string): Promise<string | null> {
  const file = await getSkillFile(skillId, path);
  if (!file || !file.isText) return null;
  return new TextDecoder().decode(file.content);
}

// ==================== Trusted Scripts ====================
// 已迁移到 utils/storage.ts 使用 WXT storage

// ==================== Share Page Content Setting ====================

export async function getSharePageContent(): Promise<boolean> {
  return getSetting('sharePageContent', false);
}

export async function setSharePageContent(value: boolean): Promise<void> {
  await setSetting('sharePageContent', value);
}
