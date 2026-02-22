import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  clearPdfExtractorCacheForTests,
  extractPdfContent,
  isPdfUrl,
  resolvePdfSourceUrl,
} from '../../utils/pdfExtractor';

function createPdfPage(text: string) {
  return {
    getTextContent: vi.fn(async () => ({
      items: text ? [{ str: text }] : [],
    })),
    cleanup: vi.fn(),
  };
}

describe('pdfExtractor', () => {
  beforeEach(() => {
    clearPdfExtractorCacheForTests();
    getDocumentMock.mockReset();
    globalWorkerOptions.workerSrc = '';
    vi.restoreAllMocks();
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
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
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

  it('应在超页数时只提取限定页并给出提示', async () => {
    const pdfPage1 = createPdfPage('第1页');
    const pdfPage2 = createPdfPage('第2页');

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
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );

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

  it('应在无文本层时返回边界提示', async () => {
    const emptyPage = createPdfPage('');

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(emptyPage),
        getMetadata: vi.fn(async () => ({ info: {} })),
        destroy: vi.fn(async () => undefined),
      }),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );

    const result = await extractPdfContent('https://example.com/scan.pdf', { now: 3000 });
    expect(result.content).toContain('未检测到可提取的文本层');
    expect(result.textContent).toBe('');
    expect(result.note).toContain('未检测到可提取的文本层');
  });

  it('应在页面解析失败时释放 PDF 资源', async () => {
    const destroySpy = vi.fn(async () => undefined);

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

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );

    await expect(extractPdfContent('https://example.com/broken-page.pdf')).rejects.toThrow(
      'page parse failed',
    );
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('应在文档加载失败时释放 loading task', async () => {
    const loadingTaskDestroySpy = vi.fn(async () => undefined);
    const loadError = new Error('load failed');
    const loadingPromise = Promise.reject(loadError);
    void loadingPromise.catch(() => undefined);

    getDocumentMock.mockReturnValue({
      promise: loadingPromise,
      destroy: loadingTaskDestroySpy,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );

    await expect(extractPdfContent('https://example.com/load-failed.pdf')).rejects.toThrow(
      loadError.message,
    );
    expect(loadingTaskDestroySpy).toHaveBeenCalledTimes(1);
  });

  it('应在首次加载 PDF 引擎失败后允许下次重试', async () => {
    Object.defineProperty(globalWorkerOptions, 'workerSrc', {
      configurable: true,
      get: () => '',
      set: () => {
        throw new Error('worker init failed');
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );

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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
      })),
    );

    await expect(extractPdfContent('https://example.com/forbidden.pdf')).rejects.toThrow(
      '下载 PDF 失败: HTTP 403',
    );
  });
});
