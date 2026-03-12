import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@wxt-dev/storage';

interface MockStore {
  keyPath?: string | string[];
  records: Map<string, unknown>;
  indexes: Map<string, string>;
}

interface MockState {
  initialized: boolean;
  stores: Map<string, MockStore>;
  clearError: Error | null;
  putError: { storeName?: string; error: Error } | null;
}

const mockState: MockState = {
  initialized: false,
  stores: new Map(),
  clearError: null,
  putError: null,
};

function normalizeKey(key: unknown): string {
  return JSON.stringify(key);
}

function cloneValue<T>(value: T): T {
  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T;
  }
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function ensureStore(name: string): MockStore {
  const existing = mockState.stores.get(name);
  if (existing) return existing;
  const created: MockStore = {
    records: new Map<string, unknown>(),
    indexes: new Map<string, string>(),
  };
  mockState.stores.set(name, created);
  return created;
}

function resolveStoreKey(store: MockStore, value: unknown, key?: unknown): unknown {
  if (key !== undefined) return key;
  if (typeof store.keyPath === 'string' && value && typeof value === 'object') {
    return (value as Record<string, unknown>)[store.keyPath];
  }
  if (Array.isArray(store.keyPath) && value && typeof value === 'object') {
    return store.keyPath.map(part => (value as Record<string, unknown>)[part]);
  }
  return key;
}

function maybeThrowPutError(storeName: string): void {
  if (!mockState.putError) return;
  if (mockState.putError.storeName && mockState.putError.storeName !== storeName) return;
  const error = mockState.putError.error;
  mockState.putError = null;
  throw error;
}

const mockDb = {
  objectStoreNames: {
    contains(name: string) {
      return mockState.stores.has(name);
    },
  },
  createObjectStore(name: string, options?: { keyPath?: string | string[] }) {
    const store = ensureStore(name);
    store.keyPath = options?.keyPath;
    return {
      createIndex(indexName: string, keyPath: string) {
        store.indexes.set(indexName, keyPath);
      },
    };
  },
  async get(storeName: string, key: unknown) {
    const store = ensureStore(storeName);
    return cloneValue(store.records.get(normalizeKey(key)));
  },
  async put(storeName: string, value: unknown, key?: unknown) {
    maybeThrowPutError(storeName);
    const store = ensureStore(storeName);
    const finalKey = resolveStoreKey(store, value, key);
    store.records.set(normalizeKey(finalKey), cloneValue(value));
  },
  async delete(storeName: string, key: unknown) {
    const store = ensureStore(storeName);
    store.records.delete(normalizeKey(key));
  },
  async clear(storeName: string) {
    if (mockState.clearError) {
      const err = mockState.clearError;
      mockState.clearError = null;
      throw err;
    }
    const store = ensureStore(storeName);
    store.records.clear();
  },
  async getAll(storeName: string) {
    const store = ensureStore(storeName);
    return Array.from(store.records.values()).map(item => cloneValue(item));
  },
  async getFromIndex(storeName: string, indexName: string, query: unknown) {
    const store = ensureStore(storeName);
    const indexField = store.indexes.get(indexName);
    if (!indexField) return undefined;
    for (const value of store.records.values()) {
      if ((value as Record<string, unknown>)?.[indexField] === query) {
        return cloneValue(value);
      }
    }
    return undefined;
  },
  async getAllFromIndex(storeName: string, indexName: string, query?: unknown) {
    const store = ensureStore(storeName);
    const indexField = store.indexes.get(indexName);
    const values = Array.from(store.records.values()).map(item => cloneValue(item as Record<string, unknown>));
    if (!indexField) return values;
    const filtered = query === undefined
      ? values
      : values.filter(value => (value as Record<string, unknown>)?.[indexField] === query);
    return filtered.sort((a, b) => {
      const av = Number((a as Record<string, unknown>)?.[indexField] ?? 0);
      const bv = Number((b as Record<string, unknown>)?.[indexField] ?? 0);
      return av - bv;
    });
  },
  transaction(_storeNames: string[]) {
    return {
      objectStore(name: string) {
        const store = ensureStore(name);
        return {
          async delete(key: unknown) {
            store.records.delete(normalizeKey(key));
          },
          async put(value: unknown, key?: unknown) {
            maybeThrowPutError(name);
            const finalKey = resolveStoreKey(store, value, key);
            store.records.set(normalizeKey(finalKey), cloneValue(value));
          },
        };
      },
      done: Promise.resolve(),
    };
  },
};

vi.mock('idb', () => {
  return {
    openDB: async (_name: string, _version: number, options?: { upgrade?: (db: typeof mockDb) => void }) => {
      if (!mockState.initialized) {
        mockState.initialized = true;
        options?.upgrade?.(mockDb);
      }
      return mockDb;
    },
    __resetMockData: () => {
      mockState.initialized = false;
      mockState.stores = new Map();
      mockState.clearError = null;
      mockState.putError = null;
    },
    __setPutErrorOnce: (storeName: string, message: string) => {
      mockState.putError = { storeName, error: new Error(message) };
    },
  };
});

import {
  __resetDbForTests,
  createSession,
  getAllSessions,
} from '../../utils/db';
import { exportAllData, importAllData, type ExportData } from '../../utils/dataTransfer';
import {
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  getAllProviders,
  saveProvider,
  setActiveProviderId,
  type AIProvider,
} from '../../utils/storage';
import { saveMcpServer, type McpServerConfig } from '../../utils/mcpStorage';

interface IdbMockHooks {
  __resetMockData: () => void;
  __setPutErrorOnce: (storeName: string, message: string) => void;
}

function createProvider(id: string): AIProvider {
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
  };
}

function createMcpServer(id: string): McpServerConfig {
  return {
    id,
    name: `server-${id}`,
    url: `https://example.com/${id}`,
    enabled: true,
    authType: 'oauth',
  };
}

function createBackup(overrides: Partial<ExportData['data']> = {}): ExportData {
  return {
    version: 1,
    exportedAt: Date.now(),
    data: {
      providers: [],
      activeProviderId: null,
      trustedScripts: [],
      themeMode: 'system',
      language: 'en',
      floatingBallEnabled: true,
      selectionQuoteEnabled: true,
      fontSettings: {
        preset: 'system',
        customFamily: '',
      },
      rawExtractSites: [],
      maxPageContentLength: 30000,
      maxPdfExtractPages: 30,
      maxToolCalls: 100,
      localContextCompressionSettings: {
        enabled: true,
        autoCompactTokenLimit: null,
        keepRecentUserTokens: 4096,
        summaryMaxTokens: 256,
        compactPrompt: null,
        maxCompactionsPerTurn: 2,
      },
      presetActions: [],
      mcpServers: [],
      mcpOAuthStates: [],
      sharePageContent: false,
      webSearchEnabled: false,
      chatSessions: [],
      skills: [],
      skillFiles: [],
      ...overrides,
    },
  };
}

async function resetDbAndMocks(): Promise<void> {
  const idbMock = (await import('idb')) as unknown as IdbMockHooks;
  idbMock.__resetMockData();
  __resetDbForTests();
}

describe('dataTransfer', () => {
  beforeEach(async () => {
    await resetDbAndMocks();
    await setActiveProviderId(null);
  });

  it('坏备份在解析 skillFiles 失败时不应清空现有数据', async () => {
    const existingProvider = createProvider('provider-existing');
    await saveProvider(existingProvider);
    await setActiveProviderId(existingProvider.id);
    const existingSession = await createSession(existingProvider.id);

    const backup = createBackup({
      skillFiles: [{
        skillId: 'skill-1',
        path: 'script.js',
        contentBase64: '!!!invalid-base64!!!',
        mimeType: 'text/javascript',
        size: 10,
        isText: true,
      }],
    });

    const result = await importAllData(backup);

    expect(result.success).toBe(false);
    expect((await getAllProviders()).map(provider => provider.id)).toEqual([existingProvider.id]);
    expect((await getAllSessions()).map(session => session.id)).toEqual([existingSession.id]);
  });

  it('导入在写入阶段失败时应回滚到原有数据', async () => {
    const existingProvider = createProvider('provider-existing');
    await saveProvider(existingProvider);
    await setActiveProviderId(existingProvider.id);
    const existingSession = await createSession(existingProvider.id);

    const backup = createBackup({
      providers: [createProvider('provider-imported')],
      activeProviderId: 'provider-imported',
      chatSessions: [{
        id: 'session-imported',
        title: '导入会话',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        providerId: 'provider-imported',
      }],
    });

    const idbMock = (await import('idb')) as unknown as IdbMockHooks;
    idbMock.__setPutErrorOnce('chatSessions', 'mock put failed');

    const result = await importAllData(backup);

    expect(result.success).toBe(false);
    expect((await getAllProviders()).map(provider => provider.id)).toEqual([existingProvider.id]);
    expect((await getAllSessions()).map(session => session.id)).toEqual([existingSession.id]);
  });

  it('导出和导入应保留 MCP OAuth 状态而不是复用残留凭据', async () => {
    const server = createMcpServer('mcp-oauth');
    await saveMcpServer(server);

    const oauthStorage = storage.defineItem<Record<string, unknown>>('local:mcpOAuth_mcp-oauth', {
      fallback: {},
    });
    await oauthStorage.setValue({
      tokens: {
        access_token: 'token-original',
        token_type: 'Bearer',
      },
      clientInfo: {
        client_id: 'client-original',
      },
    });

    const backup = await exportAllData();
    expect(backup.data.mcpOAuthStates).toHaveLength(1);
    expect(backup.data.mcpOAuthStates[0]).toMatchObject({
      serverId: 'mcp-oauth',
      data: {
        tokens: {
          access_token: 'token-original',
        },
      },
    });

    await oauthStorage.setValue({
      tokens: {
        access_token: 'token-stale',
        token_type: 'Bearer',
      },
      clientInfo: {
        client_id: 'client-stale',
      },
    });

    const result = await importAllData(backup);

    expect(result.success).toBe(true);
    expect(await oauthStorage.getValue()).toMatchObject({
      tokens: {
        access_token: 'token-original',
      },
      clientInfo: {
        client_id: 'client-original',
      },
    });
  });
});
