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
  upgradeRuns: number;
}

const mockState: MockState = {
  initialized: false,
  stores: new Map(),
  clearError: null,
  upgradeRuns: 0,
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
          async put(value: unknown, key?: unknown) {
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
        mockState.upgradeRuns += 1;
        options?.upgrade?.(mockDb);
      }
      return mockDb;
    },
    __resetMockData: () => {
      mockState.initialized = false;
      mockState.stores = new Map();
      mockState.clearError = null;
    },
    __setClearErrorOnce: (message: string) => {
      mockState.clearError = new Error(message);
    },
    __getUpgradeRunCount: () => mockState.upgradeRuns,
  };
});

import {
  __resetDbForTests,
  createSession,
  deleteAllSessions,
  deleteSession,
  deleteSkill,
  getAllSessions,
  getCurrentSession,
  getSkillFiles,
  getSession,
  getSessionsPaginated,
  getSkill,
  saveSkillFile,
  saveSkill,
  setCurrentSessionId,
  updateSession,
} from '../../utils/db';
import { getTrustedScripts, trustScript } from '../../utils/storage';

interface IdbMockHooks {
  __resetMockData: () => void;
  __setClearErrorOnce: (message: string) => void;
  __getUpgradeRunCount: () => number;
}

async function resetDbAndMocks(): Promise<void> {
  const idbMock = (await import('idb')) as unknown as IdbMockHooks;
  idbMock.__resetMockData();
  __resetDbForTests();
}

describe('deleteAllSessions', () => {
  beforeEach(async () => {
    await resetDbAndMocks();
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
    const idbMock = (await import('idb')) as unknown as IdbMockHooks;
    idbMock.__setClearErrorOnce('mock clear failed');

    await expect(deleteAllSessions()).rejects.toThrow('mock clear failed');
    expect((await getAllSessions()).length).toBe(1);
    expect(await getCurrentSession()).not.toBeNull();
  });
});

describe('deleteSkill', () => {
  beforeEach(async () => {
    await resetDbAndMocks();
  });

  it('应删除 skill 元数据、文件和信任脚本', async () => {
    const skillId = 'skill-delete-success';
    await saveSkill({
      id: skillId,
      metadata: {
        name: 'delete-success',
        description: '用于成功删除验证',
      },
      instructions: 'test',
      scripts: [{ name: 'main.js', path: 'scripts/main.js', language: 'javascript', trusted: true }],
      references: [],
      assets: [],
      source: 'imported',
      importedAt: Date.now(),
      location: '/tmp/delete-success',
    });
    await saveSkillFile({
      skillId,
      path: 'scripts/main.js',
      content: new TextEncoder().encode('console.log("ok")').buffer,
      mimeType: 'application/javascript',
      size: 17,
      isText: true,
    });
    await trustScript(skillId, 'scripts/main.js');

    await deleteSkill(skillId);

    expect(await getSkill(skillId)).toBeNull();
    expect(await getSkillFiles(skillId)).toEqual([]);
    expect((await getTrustedScripts()).some(item => item.skillId === skillId)).toBe(false);
  });

  it('应在 trustedScripts 清理失败时回滚 skill 元数据和文件', async () => {
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
    await saveSkillFile({
      skillId,
      path: 'scripts/keep.js',
      content: new TextEncoder().encode('console.log("keep")').buffer,
      mimeType: 'application/javascript',
      size: 19,
      isText: true,
    });
    await trustScript(skillId, 'scripts/keep.js');

    expect(await getSkill(skillId)).not.toBeNull();
    expect((await getSkillFiles(skillId)).length).toBe(1);

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
    expect((await getSkillFiles(skillId)).length).toBe(1);
    expect((await getTrustedScripts()).some(item => item.skillId === skillId)).toBe(true);
  });
});

describe('chatSessions CRUD 与分页', () => {
  beforeEach(async () => {
    await resetDbAndMocks();
    await deleteAllSessions();
  });

  it('createSession 应创建会话并把当前会话切到最新会话', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2000);

    const first = await createSession('provider-a');
    const second = await createSession('provider-b');
    nowSpy.mockRestore();

    const current = await getCurrentSession();
    const sessions = await getAllSessions();

    expect(current?.id).toBe(second.id);
    expect(sessions.map(session => session.id)).toEqual([second.id, first.id]);
  });

  it('updateSession 应更新消息内容并刷新 updatedAt', async () => {
    const session = await createSession('provider-x');
    const updatedAtBefore = session.updatedAt;

    session.messages.push({
      role: 'user',
      content: 'hello',
      timestamp: 123,
    });

    await updateSession(session);
    const stored = await getSession(session.id);

    expect(stored?.messages).toHaveLength(1);
    expect(stored?.messages[0].content).toBe('hello');
    expect((stored?.updatedAt ?? 0) >= updatedAtBefore).toBe(true);
  });

  it('updateSession 应持久化会话级 contextUsage 统计', async () => {
    const session = await createSession('provider-context');

    session.contextUsage = {
      sessionKey: session.id,
      exactBaseTokens: 120,
      pendingEstimateTokens: 16,
      currentTokensMixed: 136,
      totalTokensAccumulated: 120,
      contextWindowTokens: 32768,
      effectiveContextWindowTokens: 31129,
      usageRatio: 136 / 31129,
      precision: 'mixed',
      source: 'responses_usage',
      lastSettledMessageCount: 4,
      updatedAt: 1234567890,
      tokenDetails: {
        inputTokens: 90,
        cachedInputTokens: 20,
        outputTokens: 30,
        reasoningOutputTokens: 5,
      },
    };

    await updateSession(session);
    const stored = await getSession(session.id);

    expect(stored?.contextUsage).toEqual(session.contextUsage);
  });

  it('updateSession 应持久化会话级 compressionMeta', async () => {
    const session = await createSession('provider-compression');

    session.compressionMeta = {
      trigger: 'pre-turn',
      beforeTokens: 32000,
      afterTokens: 8400,
      trimmedCount: 18,
      usedFallback: false,
      summaryPreview: '历史关键信息摘要',
      compactionCountInTurn: 1,
      updatedAt: 1234567900,
    };

    await updateSession(session);
    const stored = await getSession(session.id);

    expect(stored?.compressionMeta).toEqual(session.compressionMeta);
  });

  it('getSessionsPaginated 应按更新时间倒序分页', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(3000)
      .mockReturnValueOnce(3000);

    const s1 = await createSession('provider-1');
    const s2 = await createSession('provider-2');
    const s3 = await createSession('provider-3');
    nowSpy.mockRestore();

    const firstPage = await getSessionsPaginated(2, 0);
    const secondPage = await getSessionsPaginated(2, 2);

    expect(firstPage.sessions.map(session => session.id)).toEqual([s3.id, s2.id]);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.sessions.map(session => session.id)).toEqual([s1.id]);
    expect(secondPage.hasMore).toBe(false);
  });

  it('deleteSession 删除当前会话后应自动切换到剩余最新会话', async () => {
    const s1 = await createSession('provider-1');
    const s2 = await createSession('provider-2');
    await setCurrentSessionId(s1.id);

    await deleteSession(s1.id);
    const current = await getCurrentSession();

    expect(current?.id).toBe(s2.id);
  });
});

describe('idb mock reset', () => {
  beforeEach(async () => {
    await resetDbAndMocks();
  });

  it('重置后应可再次触发 upgrade/schema 初始化', async () => {
    const idbMock = (await import('idb')) as unknown as IdbMockHooks;
    const startUpgradeRuns = idbMock.__getUpgradeRunCount();

    await createSession('provider-first');
    const firstUpgradeRuns = idbMock.__getUpgradeRunCount();
    expect(firstUpgradeRuns).toBe(startUpgradeRuns + 1);

    await resetDbAndMocks();
    await createSession('provider-second');
    const secondUpgradeRuns = idbMock.__getUpgradeRunCount();
    expect(secondUpgradeRuns).toBe(firstUpgradeRuns + 1);
  });
});
