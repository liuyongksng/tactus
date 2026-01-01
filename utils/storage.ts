import { storage } from '#imports';

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

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  providerId?: string;
}

// Storage items
export const providersStorage = storage.defineItem<AIProvider[]>('local:providers', {
  fallback: [],
});

export const activeProviderIdStorage = storage.defineItem<string | null>('local:activeProviderId', {
  fallback: null,
});

export const currentSessionIdStorage = storage.defineItem<string | null>('local:currentSessionId', {
  fallback: null,
});

export const chatSessionsStorage = storage.defineItem<ChatSession[]>('local:chatSessions', {
  fallback: [],
});

export const sharePageContentStorage = storage.defineItem<boolean>('local:sharePageContent', {
  fallback: false,
});

// Chat session helper functions
export async function getAllSessions(): Promise<ChatSession[]> {
  const sessions = await chatSessionsStorage.getValue();
  // 确保每个 session 都有 messages 数组
  return sessions
    .map(s => ({ ...s, messages: s.messages || [] }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSession(id: string): Promise<ChatSession | null> {
  const sessions = await chatSessionsStorage.getValue();
  return sessions.find(s => s.id === id) || null;
}

export async function getCurrentSession(): Promise<ChatSession | null> {
  const currentId = await currentSessionIdStorage.getValue();
  if (!currentId) return null;
  return getSession(currentId);
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
  const sessions = await chatSessionsStorage.getValue();
  sessions.push(session);
  await chatSessionsStorage.setValue(sessions);
  await currentSessionIdStorage.setValue(session.id);
  return session;
}

export async function updateSession(session: ChatSession): Promise<void> {
  const sessions = await chatSessionsStorage.getValue();
  const index = sessions.findIndex(s => s.id === session.id);
  if (index >= 0) {
    // 深拷贝 messages 确保数据正确保存
    sessions[index] = { 
      ...session, 
      messages: JSON.parse(JSON.stringify(session.messages || [])),
      updatedAt: Date.now() 
    };
    await chatSessionsStorage.setValue(sessions);
  }
}

export async function deleteSession(id: string): Promise<void> {
  const sessions = await chatSessionsStorage.getValue();
  await chatSessionsStorage.setValue(sessions.filter(s => s.id !== id));
  const currentId = await currentSessionIdStorage.getValue();
  if (currentId === id) {
    const remaining = await chatSessionsStorage.getValue();
    await currentSessionIdStorage.setValue(remaining[0]?.id || null);
  }
}

export async function generateSessionTitle(firstMessage: string): Promise<string> {
  const maxLen = 20;
  const title = firstMessage.replace(/\n/g, ' ').trim();
  return title.length > maxLen ? title.substring(0, maxLen) + '...' : title;
}

// Helper functions
export async function getActiveProvider(): Promise<AIProvider | null> {
  const providers = await providersStorage.getValue();
  const activeId = await activeProviderIdStorage.getValue();
  return providers.find(p => p.id === activeId) || null;
}

export async function saveProvider(provider: AIProvider): Promise<void> {
  const providers = await providersStorage.getValue();
  const index = providers.findIndex(p => p.id === provider.id);
  if (index >= 0) {
    providers[index] = provider;
  } else {
    providers.push(provider);
  }
  await providersStorage.setValue(providers);
}

export async function deleteProvider(id: string): Promise<void> {
  const providers = await providersStorage.getValue();
  await providersStorage.setValue(providers.filter(p => p.id !== id));
  const activeId = await activeProviderIdStorage.getValue();
  if (activeId === id) {
    await activeProviderIdStorage.setValue(null);
  }
}
