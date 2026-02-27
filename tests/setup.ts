import { beforeEach } from 'vitest';

const localStore = new Map<string, unknown>();
const syncStore = new Map<string, unknown>();
const sessionStore = new Map<string, unknown>();

beforeEach(() => {
  localStore.clear();
  syncStore.clear();
  sessionStore.clear();
});

function resolveStore(area: 'local' | 'sync' | 'session'): Map<string, unknown> {
  if (area === 'sync') return syncStore;
  if (area === 'session') return sessionStore;
  return localStore;
}

function createArea(area: 'local' | 'sync' | 'session') {
  const listeners = new Set<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void>();

  return {
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      const store = resolveStore(area);
      if (keys == null) {
        return Object.fromEntries(store.entries());
      }
      if (typeof keys === 'string') {
        return { [keys]: store.get(keys) };
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map(key => [key, store.get(key)]));
      }
      const output: Record<string, unknown> = {};
      for (const [key, fallback] of Object.entries(keys)) {
        output[key] = store.has(key) ? store.get(key) : fallback;
      }
      return output;
    },
    async set(items: Record<string, unknown>) {
      const store = resolveStore(area);
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(items)) {
        const oldValue = store.get(key);
        store.set(key, value);
        changes[key] = { oldValue, newValue: value };
      }
      if (Object.keys(changes).length > 0) {
        for (const listener of listeners) {
          listener(changes, area);
        }
      }
    },
    async remove(keys: string | string[]) {
      const store = resolveStore(area);
      const list = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const key of list) {
        if (store.has(key)) {
          changes[key] = { oldValue: store.get(key), newValue: undefined };
        }
        store.delete(key);
      }
      if (Object.keys(changes).length > 0) {
        for (const listener of listeners) {
          listener(changes, area);
        }
      }
    },
    onChanged: {
      addListener(listener: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void) {
        listeners.add(listener);
      },
      removeListener(listener: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void) {
        listeners.delete(listener);
      },
    },
  };
}

const browserMock = {
  runtime: {
    id: 'vitest-browser-runtime',
    sendMessage: async () => undefined,
    onMessage: {
      addListener: () => undefined,
      removeListener: () => undefined,
    },
  },
  storage: {
    local: createArea('local'),
    sync: createArea('sync'),
    session: createArea('session'),
  },
};

(globalThis as any).browser = browserMock;
(globalThis as any).chrome = browserMock;
