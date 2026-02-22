import { beforeEach, describe, expect, it, vi } from 'vitest';

const PDF_HEADER_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d];

const { getDocumentMock, globalWorkerOptions } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
  globalWorkerOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist', () => ({
  getDocument: getDocumentMock,
  GlobalWorkerOptions: globalWorkerOptions,
}));

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: 'mock-worker-url',
}));

import {
  clearPdfExtractorRuntimeCache,
  clearPdfExtractorCacheForTests,
  extractPdfContent,
  formatPdfExtractionProgressText,
  isPdfUrl,
  resolvePdfSourceUrl,
} from '../../utils/pdfExtractor';

interface RuntimeChunkMessage {
  type: string;
  downloadId?: string;
  sessionId?: string;
  chunkIndex?: number;
  index?: number;
  url?: string;
}

function createPdfBytes(content = 'test'): Uint8Array {
  const encoder = new TextEncoder();
  const body = encoder.encode(content);
  return Uint8Array.from([...PDF_HEADER_BYTES, ...body, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const cloned = new Uint8Array(bytes.length);
  cloned.set(bytes);
  return cloned.buffer as ArrayBuffer;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function createPdfPage(text: string) {
  return {
    getTextContent: vi.fn(async () => ({
      items: text ? [{ str: text }] : [],
    })),
    cleanup: vi.fn(),
  };
}

function createFetchResponse(bytes: Uint8Array, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => {
        if (key.toLowerCase() === 'content-length') {
          return String(bytes.length);
        }
        return null;
      },
    },
    arrayBuffer: async () => toArrayBuffer(bytes),
  };
}

function setRuntimeSendMessage(
  impl: (message: RuntimeChunkMessage) => Promise<unknown> | unknown,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(impl);
  (globalThis as any).browser.runtime.sendMessage = mock;
  (globalThis as any).chrome.runtime.sendMessage = mock;
  return mock;
}

describe('pdfExtractor', () => {
  beforeEach(() => {
    clearPdfExtractorCacheForTests();
    getDocumentMock.mockReset();
    globalWorkerOptions.workerSrc = '';
    vi.restoreAllMocks();
    setRuntimeSendMessage(async () => undefined);
  });

  it('应识别直接 PDF 地址与 viewer 包装地址', () => {
    expect(isPdfUrl('https://example.com/docs/report.pdf')).toBe(true);
    expect(
      resolvePdfSourceUrl(
        'chrome-extension://abcd/viewer.html?src=https%3A%2F%2Fexample.com%2Fa.pdf',
      ),
    ).toBe('https://example.com/a.pdf');
    expect(
      resolvePdfSourceUrl(
        'https://example.com/article?url=https%3A%2F%2Fexample.com%2Fa.pdf',
      ),
    ).toBeNull();
    expect(isPdfUrl('https://example.com/article')).toBe(false);
  });

  it('应成功提取 PDF 文本并支持缓存命中', async () => {
    const pdfPage1 = createPdfPage('第一页内容');
    const pdfPage2 = createPdfPage('第二页内容');
    const pdfBytes = createPdfBytes('fetch-cache');

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi
          .fn()
          .mockResolvedValueOnce(pdfPage1)
          .mockResolvedValueOnce(pdfPage2),
        getMetadata: vi.fn(async () => ({ info: { Title: '测试 PDF' } })),
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
    });

    const fetchMock = vi.fn(async () => createFetchResponse(pdfBytes));
    vi.stubGlobal('fetch', fetchMock);

    const first = await extractPdfContent('https://example.com/test.pdf', { now: 1000 });
    expect(first.title).toBe('测试 PDF');
    expect(first.content).toContain('第一页内容');
    expect(first.content).toContain('第二页内容');
    expect(first.fromCache).toBe(false);

    const second = await extractPdfContent('https://example.com/test.pdf', { now: 1001 });
    expect(second.fromCache).toBe(true);
    expect(second.content).toBe(first.content);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('应在 runtime chunk 模式下拉取并在 finally 释放 session', async () => {
    const pdfBytes = createPdfBytes('runtime-chunk');
    const chunkA = pdfBytes.slice(0, 6);
    const chunkB = pdfBytes.slice(6);
    const progressList: string[] = [];

    const runtimeMock = setRuntimeSendMessage(async (message: RuntimeChunkMessage) => {
      switch (message.type) {
        case 'PDF_DOWNLOAD_INIT':
          return {
            downloadId: 'session-1',
            totalBytes: pdfBytes.length,
            chunkCount: 2,
          };
        case 'PDF_DOWNLOAD_CHUNK':
          if (message.chunkIndex === 0) {
            return {
              index: 0,
              start: 0,
              end: chunkA.length,
              base64: toBase64(chunkA),
            };
          }
          return {
            index: 1,
            start: chunkA.length,
            end: chunkA.length + chunkB.length,
            base64: toBase64(chunkB),
            };
        case 'PDF_DOWNLOAD_RELEASE':
          return { success: true };
        default:
          return undefined;
      }
    });

    const fetchMock = vi.fn(async () => {
      throw new Error('不应走 fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const pdfPage = createPdfPage('runtime page');
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(pdfPage),
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
    });

    const result = await extractPdfContent('https://example.com/runtime.pdf', {
      onProgress: progress => {
        progressList.push(progress.message);
      },
    });

    expect(result.content).toContain('runtime page');
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(runtimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PDF_DOWNLOAD_RELEASE', downloadId: 'session-1' }),
    );
    expect(progressList.some(text => text.includes('PDF 下载'))).toBe(true);
    expect(progressList.some(text => text.includes('PDF 解析'))).toBe(true);
  });

  it('runtime 报缓存限制错误时应回退到 fetch 下载', async () => {
    const pdfBytes = createPdfBytes('runtime-fallback');
    const pdfPage = createPdfPage('fallback page');

    setRuntimeSendMessage(async (message: RuntimeChunkMessage) => {
      if (message.type === 'PDF_DOWNLOAD_INIT') {
        return {
          success: false,
          error: 'PDF 缓存空间不足，请先释放旧会话后重试',
        };
      }
      return undefined;
    });

    const fetchMock = vi.fn(async () => createFetchResponse(pdfBytes));
    vi.stubGlobal('fetch', fetchMock);

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(pdfPage),
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
    });

    const result = await extractPdfContent('https://example.com/runtime-fallback.pdf');
    expect(result.content).toContain('fallback page');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('应在 runtime chunk 越界时抛错并释放 session', async () => {
    const pdfBytes = createPdfBytes('chunk-boundary');
    const releaseCalled: RuntimeChunkMessage[] = [];

    const runtimeMock = setRuntimeSendMessage(async (message: RuntimeChunkMessage) => {
      switch (message.type) {
        case 'PDF_DOWNLOAD_INIT':
          return { downloadId: 'session-overflow', totalBytes: pdfBytes.length, chunkCount: 1 };
        case 'PDF_DOWNLOAD_CHUNK':
          return {
            index: 0,
            start: 0,
            end: pdfBytes.length + 1,
            chunk: Array.from(pdfBytes),
          };
        case 'PDF_DOWNLOAD_RELEASE':
          releaseCalled.push(message);
          return { success: true };
        default:
          return undefined;
      }
    });
    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(pdfBytes)));

    await expect(extractPdfContent('https://example.com/out-of-range.pdf')).rejects.toThrow('chunk越界');
    expect(runtimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PDF_DOWNLOAD_RELEASE', downloadId: 'session-overflow' }),
    );
    expect(releaseCalled.length).toBe(1);
  });

  it('应在 runtime chunk 总字节不一致时抛错', async () => {
    const pdfBytes = createPdfBytes('size-mismatch');
    const chunk = pdfBytes.slice(0, 8);

    setRuntimeSendMessage(async (message: RuntimeChunkMessage) => {
      switch (message.type) {
        case 'PDF_DOWNLOAD_INIT':
          return {
            downloadId: 'session-mismatch',
            totalBytes: pdfBytes.length + 10,
            chunkCount: 1,
          };
        case 'PDF_DOWNLOAD_CHUNK':
          return {
            index: 0,
            start: 0,
            end: chunk.length,
            chunk: Array.from(chunk),
          };
        case 'PDF_DOWNLOAD_RELEASE':
          return { success: true };
        default:
          return undefined;
      }
    });
    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(pdfBytes)));

    await expect(extractPdfContent('https://example.com/size-mismatch.pdf')).rejects.toThrow(
      '总字节不一致',
    );
  });

  it('应在 PDF 文件头不合法时抛错', async () => {
    const invalidBytes = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(invalidBytes)));

    await expect(extractPdfContent('https://example.com/invalid-header.pdf')).rejects.toThrow(
      '%PDF-',
    );
  });

  it('应在并发请求时复用同一个提取任务', async () => {
    const pdfBytes = createPdfBytes('dedupe');
    const pdfPage = createPdfPage('并发复用');

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(pdfPage),
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
    });

    let resolveFetch!: (value: unknown) => void;
    const fetchPending = new Promise(resolve => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => fetchPending as Promise<unknown>);
    vi.stubGlobal('fetch', fetchMock);

    const p1 = extractPdfContent('https://example.com/dedupe.pdf', { now: 5000 });
    const p2 = extractPdfContent('https://example.com/dedupe.pdf', { now: 5000 });

    resolveFetch(createFetchResponse(pdfBytes));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.content).toContain('并发复用');
    expect(r2.content).toContain('并发复用');
    expect(r1.fromCache).toBe(false);
    expect(r2.fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
  });

  it('手动清理提取缓存后，应重新下载并重新提取', async () => {
    const pdfBytes = createPdfBytes('clear-runtime-cache');
    const pageA = createPdfPage('第一次提取');
    const pageB = createPdfPage('第二次提取');

    const getPageMock = vi.fn()
      .mockResolvedValueOnce(pageA)
      .mockResolvedValueOnce(pageB);
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: getPageMock,
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
    });

    const fetchMock = vi.fn(async () => createFetchResponse(pdfBytes));
    vi.stubGlobal('fetch', fetchMock);

    const first = await extractPdfContent('https://example.com/runtime-clear.pdf', { now: 7000 });
    expect(first.fromCache).toBe(false);

    clearPdfExtractorRuntimeCache();

    const second = await extractPdfContent('https://example.com/runtime-clear.pdf', { now: 7001 });
    expect(second.fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('应在超页数时只提取限定页并给出提示', async () => {
    const pdfPage1 = createPdfPage('第1页');
    const pdfPage2 = createPdfPage('第2页');
    const pdfBytes = createPdfBytes('max-pages');

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 4,
        getPage: vi
          .fn()
          .mockResolvedValueOnce(pdfPage1)
          .mockResolvedValueOnce(pdfPage2),
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
    });

    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(pdfBytes)));

    const result = await extractPdfContent('https://example.com/large.pdf', {
      maxPages: 2,
      now: 2000,
    });

    expect(result.pageCount).toBe(4);
    expect(result.extractedPages).toBe(2);
    expect(result.note).toContain('仅提取前 2 页，共 4 页');
    expect(result.content).toContain('第1页');
    expect(result.content).toContain('第2页');
  });

  it('maxPages 为 0 时应提取全部页', async () => {
    const pdfPage1 = createPdfPage('第1页');
    const pdfPage2 = createPdfPage('第2页');
    const pdfPage3 = createPdfPage('第3页');
    const pdfBytes = createPdfBytes('all-pages');

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 3,
        getPage: vi
          .fn()
          .mockResolvedValueOnce(pdfPage1)
          .mockResolvedValueOnce(pdfPage2)
          .mockResolvedValueOnce(pdfPage3),
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
    });

    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(pdfBytes)));

    const result = await extractPdfContent('https://example.com/all-pages.pdf', {
      maxPages: 0,
      now: 2100,
    });

    expect(result.pageCount).toBe(3);
    expect(result.extractedPages).toBe(3);
    expect(result.note).toBeNull();
    expect(result.content).toContain('第1页');
    expect(result.content).toContain('第2页');
    expect(result.content).toContain('第3页');
  });

  it('maxChars 达到上限时应提前停止提取并给出提示', async () => {
    const pdfPage1 = createPdfPage('第一页内容很长');
    const pdfPage2 = createPdfPage('第2页不应读取');
    const pdfBytes = createPdfBytes('max-chars');
    const getPageMock = vi
      .fn()
      .mockResolvedValueOnce(pdfPage1)
      .mockResolvedValueOnce(pdfPage2);

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 4,
        getPage: getPageMock,
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
    });

    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(pdfBytes)));

    const result = await extractPdfContent('https://example.com/max-chars.pdf', {
      maxPages: 0,
      maxChars: 6,
      now: 2200,
    });

    expect(result.pageCount).toBe(4);
    expect(result.extractedPages).toBe(1);
    expect(result.note).toContain('文本达到 6 字符上限');
    expect(result.note).toContain('第 1 页提前停止提取');
    expect(result.content).toContain('第一页内容很长');
    expect(result.content).not.toContain('第2页不应读取');
    expect(getPageMock).toHaveBeenCalledTimes(1);
  });

  it('同一 URL 在不同提取参数下应使用独立缓存', async () => {
    const pdfBytes = createPdfBytes('cache-key-by-options');
    const fetchMock = vi.fn(async () => createFetchResponse(pdfBytes));
    vi.stubGlobal('fetch', fetchMock);

    getDocumentMock.mockImplementation(() => {
      const page1 = createPdfPage('第1页');
      const page2 = createPdfPage('第2页');
      return {
        promise: Promise.resolve({
          numPages: 2,
          getPage: vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2),
          getMetadata: vi.fn(async () => ({ info: {} })),
          destroy: vi.fn(async () => undefined),
        }),
        destroy: vi.fn(async () => undefined),
      };
    });

    const first = await extractPdfContent('https://example.com/cache-options.pdf', {
      maxPages: 1,
      now: 2300,
    });
    const second = await extractPdfContent('https://example.com/cache-options.pdf', {
      maxPages: 0,
      now: 2301,
    });

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.extractedPages).toBe(1);
    expect(second.extractedPages).toBe(2);
  });

  it('应在无文本层时返回边界提示', async () => {
    const emptyPage = createPdfPage('');
    const pdfBytes = createPdfBytes('empty-text-layer');

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(emptyPage),
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
    });

    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(pdfBytes)));

    const result = await extractPdfContent('https://example.com/scan.pdf', { now: 3000 });
    expect(result.content).toContain('未检测到可提取的文本层');
    expect(result.textContent).toBe('');
    expect(result.note).toContain('未检测到可提取的文本层');
  });

  it('应在页面解析失败时释放 PDF 资源', async () => {
    const destroySpy = vi.fn(async () => undefined);
    const pdfBytes = createPdfBytes('page-failed');

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => {
          throw new Error('page parse failed');
        }),
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: destroySpy,
      }),
      destroy: vi.fn(async () => undefined),
    });

    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(pdfBytes)));

    await expect(extractPdfContent('https://example.com/broken-page.pdf')).rejects.toThrow(
      'page parse failed',
    );
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('应在文档加载失败时统一清理 release 与 loadingTask.destroy', async () => {
    const pdfBytes = createPdfBytes('load-failed');
    const loadingTaskDestroySpy = vi.fn(async () => undefined);
    const loadError = new Error('load failed');
    const loadingPromise = Promise.reject(loadError);
    void loadingPromise.catch(() => undefined);

    getDocumentMock.mockReturnValue({
      promise: loadingPromise,
      destroy: loadingTaskDestroySpy,
    });

    const releaseMessages: RuntimeChunkMessage[] = [];
    setRuntimeSendMessage(async (message: RuntimeChunkMessage) => {
      switch (message.type) {
        case 'PDF_DOWNLOAD_INIT':
          return {
            downloadId: 'session-load-failed',
            totalBytes: pdfBytes.length,
            chunkCount: 1,
          };
        case 'PDF_DOWNLOAD_CHUNK':
          return {
            index: 0,
            start: 0,
            end: pdfBytes.length,
            chunk: Array.from(pdfBytes),
          };
        case 'PDF_DOWNLOAD_RELEASE':
          releaseMessages.push(message);
          return { success: true };
        default:
          return undefined;
      }
    });

    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(pdfBytes)));

    await expect(extractPdfContent('https://example.com/load-failed.pdf')).rejects.toThrow(
      loadError.message,
    );
    expect(loadingTaskDestroySpy).toHaveBeenCalledTimes(1);
    expect(releaseMessages).toHaveLength(1);
  });

  it('应在首次加载 PDF 引擎失败后允许下次重试', async () => {
    Object.defineProperty(globalWorkerOptions, 'workerSrc', {
      configurable: true,
      get: () => '',
      set: () => {
        throw new Error('worker init failed');
      },
    });

    const pdfBytes = createPdfBytes('worker-retry');
    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(pdfBytes)));

    await expect(extractPdfContent('https://example.com/retry.pdf')).rejects.toThrow(
      'worker init failed',
    );

    Object.defineProperty(globalWorkerOptions, 'workerSrc', {
      configurable: true,
      writable: true,
      value: '',
    });

    const pdfPage = createPdfPage('恢复后可提取');
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(pdfPage),
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
    });

    const recovered = await extractPdfContent('https://example.com/retry.pdf');
    expect(recovered.content).toContain('恢复后可提取');
  });

  it('应在下载失败时抛出错误', async () => {
    const pdfBytes = createPdfBytes('http-failed');
    vi.stubGlobal('fetch', vi.fn(async () => createFetchResponse(pdfBytes, 403)));

    await expect(extractPdfContent('https://example.com/forbidden.pdf')).rejects.toThrow(
      '下载 PDF 失败: HTTP 403',
    );
  });

  it('应输出可读的进度文案', () => {
    expect(
      formatPdfExtractionProgressText({
        stage: 'download',
        loadedBytes: 50,
        totalBytes: 100,
        message: '',
      }),
    ).toContain('50%');
    expect(
      formatPdfExtractionProgressText({
        stage: 'parse',
        loadedBytes: 2,
        totalBytes: 5,
        currentPage: 2,
        totalPages: 5,
        message: '',
      }),
    ).toContain('2/5');
    expect(
      formatPdfExtractionProgressText(
        {
          stage: 'parse',
          loadedBytes: 2,
          totalBytes: 5,
          currentPage: 2,
          totalPages: 5,
          message: '',
        },
        'en',
      ),
    ).toContain('2/5 pages');
  });
});
