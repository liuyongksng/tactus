import { beforeEach, describe, expect, it, vi } from 'vitest';

const MB = 1024 * 1024;

type RuntimeMessageListener = (
  message: unknown,
  sender: { tab?: { id?: number } },
  sendResponse: (response: Record<string, unknown>) => void,
) => boolean | void;

interface TestBrowserMock {
  runtime: {
    onInstalled: { addListener: ReturnType<typeof vi.fn> };
    onConnect: { addListener: ReturnType<typeof vi.fn> };
    onMessage: { addListener: ReturnType<typeof vi.fn> };
  };
  action: {
    onClicked: { addListener: ReturnType<typeof vi.fn> };
  };
  sidePanel: {
    open: ReturnType<typeof vi.fn>;
    setPanelBehavior: ReturnType<typeof vi.fn>;
  };
  storage: {
    local: {
      set: ReturnType<typeof vi.fn>;
    };
  };
  scripting: {
    executeScript: ReturnType<typeof vi.fn>;
  };
}

function createBytes(length: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (seed + index) % 251;
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function decodeBase64Bytes(raw: unknown): Uint8Array {
  if (typeof raw !== 'string' || !raw) {
    throw new Error('测试数据缺少 base64 chunk');
  }
  return Uint8Array.from(Buffer.from(raw, 'base64'));
}

function createBrowserMock(): {
  browserMock: TestBrowserMock;
  getMessageListener: () => RuntimeMessageListener | null;
} {
  let messageListener: RuntimeMessageListener | null = null;

  const browserMock: TestBrowserMock = {
    runtime: {
      onInstalled: {
        addListener: vi.fn(),
      },
      onConnect: {
        addListener: vi.fn(),
      },
      onMessage: {
        addListener: vi.fn((listener: RuntimeMessageListener) => {
          messageListener = listener;
        }),
      },
    },
    action: {
      onClicked: {
        addListener: vi.fn(),
      },
    },
    sidePanel: {
      open: vi.fn(async () => undefined),
      setPanelBehavior: vi.fn(),
    },
    storage: {
      local: {
        set: vi.fn(async () => undefined),
      },
    },
    scripting: {
      executeScript: vi.fn(),
    },
  };

  return {
    browserMock,
    getMessageListener: () => messageListener,
  };
}

function createFetchMock(payloadByUrl: Map<string, Uint8Array>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const requestUrl = typeof input === 'string' ? input : input.toString();
    const payload = payloadByUrl.get(requestUrl);

    if (!payload) {
      return {
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }

    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => toArrayBuffer(payload),
    };
  });
}

async function setupBackground() {
  vi.resetModules();
  const { browserMock, getMessageListener } = createBrowserMock();
  vi.stubGlobal('browser', browserMock as any);
  vi.stubGlobal('chrome', browserMock as any);
  vi.stubGlobal('defineBackground', ((setup: () => void) => setup()) as any);

  const backgroundModule = await import('../../entrypoints/background');
  const messageListener = getMessageListener();

  if (!messageListener) {
    throw new Error('background 未注册 runtime.onMessage');
  }

  return {
    backgroundModule,
    messageListener,
  };
}

async function dispatchMessage(
  listener: RuntimeMessageListener,
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('等待 background 响应超时'));
      }
    }, 800);

    const sendResponse = (response: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };

    const keepAlive = listener(message, { tab: { id: 1 } }, sendResponse);
    if (keepAlive !== true && !settled) {
      settled = true;
      clearTimeout(timer);
      resolve({});
    }
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('background pdf download protocol', () => {
  it('应支持 INIT/CHUNK/RELEASE 全流程，且 chunk 为 4MB', async () => {
    const { backgroundModule, messageListener } = await setupBackground();
    backgroundModule.resetPdfDownloadCacheForTests();

    const url = 'https://example.com/main.pdf';
    const data = createBytes((4 * MB) + 127, 23);
    const fetchMock = createFetchMock(new Map([[url, data]]));
    vi.stubGlobal('fetch', fetchMock as any);

    const initResp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url,
    });

    expect(initResp.success).toBe(true);
    expect(initResp.chunkSize).toBe(4 * MB);
    expect(initResp.chunkCount).toBe(2);
    expect(initResp.totalBytes).toBe(data.byteLength);
    expect(initResp.fromCache).toBe(false);

    const downloadId = String(initResp.downloadId);

    const chunk0Resp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_CHUNK',
      downloadId,
      chunkIndex: 0,
    });
    expect(chunk0Resp.success).toBe(true);
    expect(chunk0Resp.chunkByteLength).toBe(4 * MB);
    expect(chunk0Resp.isLastChunk).toBe(false);

    const chunk1Resp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_CHUNK',
      downloadId,
      chunkIndex: 1,
    });
    expect(chunk1Resp.success).toBe(true);
    expect(chunk1Resp.chunkByteLength).toBe(127);
    expect(chunk1Resp.isLastChunk).toBe(true);

    const chunk0Bytes = decodeBase64Bytes(chunk0Resp.base64);
    const chunk1Bytes = decodeBase64Bytes(chunk1Resp.base64);
    const merged = new Uint8Array(chunk0Bytes.byteLength + chunk1Bytes.byteLength);
    merged.set(chunk0Bytes, 0);
    merged.set(chunk1Bytes, chunk0Bytes.byteLength);

    expect(Array.from(merged.slice(0, 32))).toEqual(Array.from(data.slice(0, 32)));
    expect(Array.from(merged.slice(-32))).toEqual(Array.from(data.slice(-32)));

    const releaseResp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId,
    });
    expect(releaseResp.success).toBe(true);
    expect(releaseResp.released).toBe(true);
  });

  it('同一 URL 重复 INIT 应命中缓存，不重复 fetch', async () => {
    const { backgroundModule, messageListener } = await setupBackground();
    backgroundModule.resetPdfDownloadCacheForTests();

    const url = 'https://example.com/cache-hit.pdf';
    const data = createBytes(1024, 31);
    const fetchMock = createFetchMock(new Map([[url, data]]));
    vi.stubGlobal('fetch', fetchMock as any);

    const firstInit = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url,
    });
    expect(firstInit.success).toBe(true);
    expect(firstInit.fromCache).toBe(false);

    const secondInit = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url,
    });
    expect(secondInit.success).toBe(true);
    expect(secondInit.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: String(firstInit.downloadId),
    });
    await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: String(secondInit.downloadId),
    });
  });

  it('同一 URL 并发 INIT 不应重复累计缓存字节', async () => {
    const { backgroundModule, messageListener } = await setupBackground();
    backgroundModule.resetPdfDownloadCacheForTests();

    const url = 'https://example.com/concurrent-init.pdf';
    const data = createBytes(2 * MB, 41);

    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>(resolve => {
      releaseFetch = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = typeof input === 'string' ? input : input.toString();
      if (requestUrl !== url) {
        return {
          ok: false,
          status: 404,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      await fetchGate;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => toArrayBuffer(data),
      };
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const initPromiseA = dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url,
    });
    const initPromiseB = dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url,
    });

    // 确保两个 INIT 都已进入 fetch 等待态
    await Promise.resolve();
    await Promise.resolve();
    releaseFetch();

    const [initA, initB] = await Promise.all([initPromiseA, initPromiseB]);
    expect(initA.success).toBe(true);
    expect(initB.success).toBe(true);
    expect((initA.cacheStats as { totalBytes: number }).totalBytes).toBe(data.byteLength);
    expect((initB.cacheStats as { totalBytes: number }).totalBytes).toBe(data.byteLength);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: String(initA.downloadId),
    });
    await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: String(initB.downloadId),
    });
  });

  it('应按 lastAccessed 执行 LRU 淘汰（entries=5）', async () => {
    const { backgroundModule, messageListener } = await setupBackground();
    backgroundModule.resetPdfDownloadCacheForTests();

    const urls = Array.from({ length: 6 }, (_, index) => `https://example.com/lru-${index}.pdf`);
    const payloadByUrl = new Map(urls.map((url, index) => [url, createBytes(512, index)]));
    const fetchMock = createFetchMock(payloadByUrl);
    vi.stubGlobal('fetch', fetchMock as any);

    const firstRoundIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const initResp = await dispatchMessage(messageListener, {
        type: 'PDF_DOWNLOAD_INIT',
        url: urls[index],
      });
      expect(initResp.success).toBe(true);
      firstRoundIds.push(String(initResp.downloadId));
      await dispatchMessage(messageListener, {
        type: 'PDF_DOWNLOAD_RELEASE',
        downloadId: String(initResp.downloadId),
      });
    }

    const touchResp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url: urls[0],
    });
    expect(touchResp.success).toBe(true);
    expect(touchResp.fromCache).toBe(true);
    await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: String(touchResp.downloadId),
    });

    const sixthResp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url: urls[5],
    });
    expect(sixthResp.success).toBe(true);
    await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: String(sixthResp.downloadId),
    });

    const evictedResp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url: urls[1],
    });
    expect(evictedResp.success).toBe(true);
    expect(evictedResp.fromCache).toBe(false);

    const keptResp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url: urls[0],
    });
    expect(keptResp.success).toBe(true);
    expect(keptResp.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(7);

    await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: String(evictedResp.downloadId),
    });
    await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: String(keptResp.downloadId),
    });

    expect(firstRoundIds.length).toBe(5);
  });

  it('应受 totalBytes 限制约束并可稳定淘汰', async () => {
    const { backgroundModule, messageListener } = await setupBackground();
    backgroundModule.resetPdfDownloadCacheForTests();
    backgroundModule.setPdfDownloadCacheConfigForTests({
      maxTotalBytes: 6 * MB,
      maxEntries: 5,
    });

    const urlA = 'https://example.com/size-a.pdf';
    const urlB = 'https://example.com/size-b.pdf';
    const fetchMock = createFetchMock(
      new Map([
        [urlA, createBytes(4 * MB, 7)],
        [urlB, createBytes(4 * MB, 9)],
      ]),
    );
    vi.stubGlobal('fetch', fetchMock as any);

    const initA = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url: urlA,
    });
    expect(initA.success).toBe(true);
    await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: String(initA.downloadId),
    });

    const initB = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url: urlB,
    });
    expect(initB.success).toBe(true);
    await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: String(initB.downloadId),
    });

    const initAAgain = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url: urlA,
    });
    expect(initAAgain.success).toBe(true);
    expect(initAAgain.fromCache).toBe(false);
    expect((initAAgain.cacheStats as { totalBytes: number }).totalBytes).toBeLessThanOrEqual(6 * MB);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('应清理过期会话，避免未 release 会话长期占用缓存槽位', async () => {
    const { backgroundModule, messageListener } = await setupBackground();
    backgroundModule.resetPdfDownloadCacheForTests();
    backgroundModule.setPdfDownloadCacheConfigForTests({
      maxEntries: 1,
      maxTotalBytes: 8 * MB,
      sessionTtlMs: 1000,
    });

    const urlA = 'https://example.com/stale-a.pdf';
    const urlB = 'https://example.com/stale-b.pdf';
    const fetchMock = createFetchMock(
      new Map([
        [urlA, createBytes(1024, 17)],
        [urlB, createBytes(1024, 19)],
      ]),
    );
    vi.stubGlobal('fetch', fetchMock as any);

    let now = 1000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      const initA = await dispatchMessage(messageListener, {
        type: 'PDF_DOWNLOAD_INIT',
        url: urlA,
      });
      expect(initA.success).toBe(true);
      expect(initA.fromCache).toBe(false);

      // 模拟页面异常中断，未调用 release，等待会话过期
      now += 3000;

      const initB = await dispatchMessage(messageListener, {
        type: 'PDF_DOWNLOAD_INIT',
        url: urlB,
      });
      expect(initB.success).toBe(true);
      expect(initB.fromCache).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await dispatchMessage(messageListener, {
        type: 'PDF_DOWNLOAD_RELEASE',
        downloadId: String(initB.downloadId),
      });
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('应支持一键清空 PDF 缓存与下载会话', async () => {
    const { backgroundModule, messageListener } = await setupBackground();
    backgroundModule.resetPdfDownloadCacheForTests();

    const url = 'https://example.com/clear-all.pdf';
    const fetchMock = createFetchMock(new Map([[url, createBytes(2048, 43)]]));
    vi.stubGlobal('fetch', fetchMock as any);

    const initBefore = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url,
    });
    expect(initBefore.success).toBe(true);
    expect(initBefore.fromCache).toBe(false);

    const clearResp = await dispatchMessage(messageListener, {
      type: 'PDF_CACHE_CLEAR_ALL',
    });
    expect(clearResp.success).toBe(true);
    expect(clearResp.cleared).toBe(true);
    expect((clearResp.after as { entries: number }).entries).toBe(0);
    expect((clearResp.after as { sessions: number }).sessions).toBe(0);

    const initAfter = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
      url,
    });
    expect(initAfter.success).toBe(true);
    expect(initAfter.fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('异常场景应返回稳定错误，不抛未捕获异常', async () => {
    const { backgroundModule, messageListener } = await setupBackground();
    backgroundModule.resetPdfDownloadCacheForTests();

    const missingUrlResp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_INIT',
    });
    expect(missingUrlResp.success).toBe(false);
    expect(String(missingUrlResp.error)).toContain('url 不能为空');

    const missingSessionResp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_CHUNK',
      downloadId: 'not-exists',
      chunkIndex: 0,
    });
    expect(missingSessionResp.success).toBe(false);
    expect(String(missingSessionResp.error)).toContain('下载会话不存在或已释放');

    const releaseUnknownResp = await dispatchMessage(messageListener, {
      type: 'PDF_DOWNLOAD_RELEASE',
      downloadId: 'not-exists',
    });
    expect(releaseUnknownResp.success).toBe(true);
    expect(releaseUnknownResp.released).toBe(false);
  });
});
