import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockStore {
  keyPath?: string | string[];
  records: Map<string, unknown>;
  indexes: Map<string, string>;
}

interface MockState {
  initialized: boolean;
  stores: Map<string, MockStore>;
  clearError: Error | null;
}

const mockState: MockState = {
  initialized: false,
  stores: new Map(),
  clearError: null,
};

function normalizeKey(key: unknown): string {
  return JSON.stringify(key);
}

function cloneValue<T>(value: T): T {
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
  async getAllFromIndex(storeName: string, indexName: string) {
    const store = ensureStore(storeName);
    const indexField = store.indexes.get(indexName);
    const values = Array.from(store.records.values()).map(item => cloneValue(item as Record<string, unknown>));
    if (!indexField) return values;
    return values.sort((a, b) => {
      const av = Number((a as Record<string, unknown>)?.[indexField] ?? 0);
      const bv = Number((b as Record<string, unknown>)?.[indexField] ?? 0);
      return av - bv;
    });
  },
  transaction(storeNames: string[]) {
    return {
      objectStore(name: string) {
        const store = ensureStore(name);
        return {
          index() {
            return {
              async openCursor() {
                return null;
              },
            };
          },
          async delete(key: unknown) {
            store.records.delete(normalizeKey(key));
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
      for (const store of mockState.stores.values()) {
        store.records.clear();
      }
      mockState.clearError = null;
    },
    __setClearErrorOnce: (message: string) => {
      mockState.clearError = new Error(message);
    },
  };
});

import {
  createSession,
  deleteAllSessions,
  deleteSkill,
  getAllSessions,
  getCurrentSession,
  getSkill,
  saveSkill,
} from '../../utils/db';

describe('deleteAllSessions', () => {
  beforeEach(async () => {
    const idbMock = await import('idb') as unknown as {
      __resetMockData: () => void;
    };
    idbMock.__resetMockData();
    await deleteAllSessions();
  });

  it('应在有历史数据时清空所有会话并重置当前会话', async () => {
    await createSession('provider-1');
    await createSession('provider-2');

    expect((await getAllSessions()).length).toBe(2);
    expect(await getCurrentSession()).not.toBeNull();

    await deleteAllSessions();

    expect(await getAllSessions()).toEqual([]);
    expect(await getCurrentSession()).toBeNull();
  });

  it('应在历史为空时安全执行', async () => {
    await expect(deleteAllSessions()).resolves.toBeUndefined();
    expect(await getAllSessions()).toEqual([]);
    expect(await getCurrentSession()).toBeNull();
  });

  it('应在数据库清空失败时抛出错误并保留原有会话', async () => {
    await createSession('provider-3');
    const idbMock = await import('idb') as unknown as {
      __setClearErrorOnce: (message: string) => void;
    };
    idbMock.__setClearErrorOnce('mock clear failed');

    await expect(deleteAllSessions()).rejects.toThrow('mock clear failed');
    expect((await getAllSessions()).length).toBe(1);
    expect(await getCurrentSession()).not.toBeNull();
  });
});

describe('deleteSkill', () => {
  beforeEach(async () => {
    const idbMock = await import('idb') as unknown as {
      __resetMockData: () => void;
    };
    idbMock.__resetMockData();
  });

  it('应在 trustedScripts 清理失败时终止删除并保留 skill 数据', async () => {
    const skillId = 'skill-keep';
    await saveSkill({
      id: skillId,
      metadata: {
        name: 'keep-skill',
        description: '用于删除失败回滚验证',
      },
      instructions: 'test',
      scripts: [],
      references: [],
      assets: [],
      source: 'imported',
      importedAt: Date.now(),
      location: '/tmp/keep-skill',
    });

    expect(await getSkill(skillId)).not.toBeNull();

    const localStorageArea = (globalThis as any).browser.storage.local;
    const originalSet = localStorageArea.set;
    localStorageArea.set = async () => {
      throw new Error('mock trusted scripts cleanup failed');
    };

    try {
      await expect(deleteSkill(skillId)).rejects.toThrow('mock trusted scripts cleanup failed');
    } finally {
      localStorageArea.set = originalSet;
    }

    expect(await getSkill(skillId)).not.toBeNull();
  });
});
