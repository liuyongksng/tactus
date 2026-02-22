const PDF_CACHE_LIMIT = 5;
const PDF_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PAGES = 30;
const TEXT_LAYER_EMPTY_MESSAGE = '未检测到可提取的文本层，当前 PDF 可能是扫描版。';
const PDF_VIEWER_PATH_PATTERNS = [
  /\/viewer\.html$/i,
  /\/web\/viewer\.html$/i,
  /\/pdfjs\/web\/viewer\.html$/i,
  /\/pdf\/viewer\.html$/i,
  /\/viewer$/i,
];

export interface PdfExtractOptions {
  maxPages?: number;
  now?: number;
}

export interface PdfExtractResult {
  title: string;
  content: string;
  textContent: string;
  excerpt: string;
  url: string;
  pageCount: number;
  extractedPages: number;
  note: string | null;
  fromCache: boolean;
}

interface PdfCacheRecord {
  expiresAt: number;
  result: Omit<PdfExtractResult, 'fromCache'>;
}

const pdfCache = new Map<string, PdfCacheRecord>();
let pdfJsApiPromise: Promise<{ getDocument: (typeof import('pdfjs-dist'))['getDocument'] }> | null = null;

const PDF_QUERY_KEYS = ['file', 'src', 'url'] as const;

function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function loadPdfJsApi(): Promise<{ getDocument: (typeof import('pdfjs-dist'))['getDocument'] }> {
  if (!pdfJsApiPromise) {
    pdfJsApiPromise = (async () => {
      const [pdfjs, workerModule] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.mjs?url'),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
      return {
        getDocument: pdfjs.getDocument,
      };
    })().catch(error => {
      pdfJsApiPromise = null;
      throw error;
    });
  }
  return pdfJsApiPromise;
}

function normalizeCandidate(candidate: string, baseUrl: string): string {
  const trimmed = candidate.trim();
  if (!trimmed) return '';

  const decoded = tryDecode(tryDecode(trimmed));
  if (!decoded) return '';

  try {
    return new URL(decoded, baseUrl).toString();
  } catch {
    return decoded;
  }
}

function looksLikePdfPath(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized.includes('application/pdf')) return true;
  return /\.pdf($|[?#])/i.test(normalized);
}

function pickTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split('/').pop() || 'PDF 文档';
    return filename || 'PDF 文档';
  } catch {
    return 'PDF 文档';
  }
}

function isPdfViewerContainer(parsed: URL): boolean {
  if (
    parsed.protocol === 'chrome-extension:'
    || parsed.protocol === 'moz-extension:'
    || parsed.protocol === 'edge-extension:'
  ) {
    return true;
  }

  return PDF_VIEWER_PATH_PATTERNS.some(pattern => pattern.test(parsed.pathname));
}

async function invokeCleanupIfPossible(
  handler: unknown,
  context: unknown,
): Promise<void> {
  if (typeof handler !== 'function') {
    return;
  }

  try {
    await Promise.resolve((handler as () => unknown).call(context));
  } catch {
    // ignore cleanup failures
  }
}

function setCache(key: string, result: Omit<PdfExtractResult, 'fromCache'>, now: number): void {
  pdfCache.delete(key);
  pdfCache.set(key, {
    expiresAt: now + PDF_CACHE_TTL_MS,
    result,
  });

  while (pdfCache.size > PDF_CACHE_LIMIT) {
    const oldestKey = pdfCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    pdfCache.delete(oldestKey);
  }
}

function getCache(key: string, now: number): Omit<PdfExtractResult, 'fromCache'> | null {
  const record = pdfCache.get(key);
  if (!record) return null;
  if (record.expiresAt <= now) {
    pdfCache.delete(key);
    return null;
  }
  pdfCache.delete(key);
  pdfCache.set(key, record);
  return record.result;
}

export function resolvePdfSourceUrl(pageUrl: string): string | null {
  if (!pageUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return null;
  }

  if (looksLikePdfPath(parsed.pathname)) {
    return parsed.toString();
  }

  if (!isPdfViewerContainer(parsed)) {
    return null;
  }

  for (const key of PDF_QUERY_KEYS) {
    const raw = parsed.searchParams.get(key);
    if (!raw) continue;

    const candidate = normalizeCandidate(raw, parsed.toString());
    if (candidate && looksLikePdfPath(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isPdfUrl(pageUrl: string): boolean {
  return resolvePdfSourceUrl(pageUrl) !== null;
}

function getItemText(item: unknown): string {
  if (item && typeof item === 'object' && 'str' in item) {
    const value = (item as { str?: unknown }).str;
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

export async function extractPdfContent(
  pageUrl: string,
  options: PdfExtractOptions = {},
): Promise<PdfExtractResult> {
  const sourceUrl = resolvePdfSourceUrl(pageUrl);
  if (!sourceUrl) {
    throw new Error('当前页面不是可识别的 PDF 地址');
  }

  const now = options.now ?? Date.now();
  const cached = getCache(sourceUrl, now);
  if (cached) {
    return {
      ...cached,
      fromCache: true,
    };
  }

  let response: Response;
  try {
    response = await fetch(sourceUrl, { credentials: 'include' });
  } catch (error) {
    throw new Error(`下载 PDF 失败: ${error instanceof Error ? error.message : '网络异常'}`);
  }

  if (!response.ok) {
    throw new Error(`下载 PDF 失败: HTTP ${response.status}`);
  }

  const data = await response.arrayBuffer();
  const { getDocument } = await loadPdfJsApi();
  const loadingTask = getDocument({
    data: new Uint8Array(data),
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
  });

  let pdf: Awaited<typeof loadingTask.promise> | null = null;
  try {
    pdf = await loadingTask.promise;
    const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
    const pageCount = pdf.numPages;
    const extractedPages = Math.min(pageCount, maxPages);
    const pageTexts: string[] = [];

    for (let pageNo = 1; pageNo <= extractedPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      try {
        const textContent = await page.getTextContent({ disableNormalization: false });
        const lines = textContent.items
          .map(getItemText)
          .map(text => text.trim())
          .filter(Boolean);
        pageTexts.push(lines.join(' '));
      } finally {
        page.cleanup();
      }
    }

    let note: string | null = null;
    if (pageCount > extractedPages) {
      note = `仅提取前 ${extractedPages} 页，共 ${pageCount} 页。`;
    }

    const mergedText = pageTexts.join('\n\n').trim();
    const hasTextLayer = mergedText.length > 0;
    if (!hasTextLayer) {
      note = note ? `${note} ${TEXT_LAYER_EMPTY_MESSAGE}` : TEXT_LAYER_EMPTY_MESSAGE;
    }

    let metaTitle = '';
    try {
      const metadata = await pdf.getMetadata();
      if (metadata?.info && 'Title' in metadata.info && typeof metadata.info.Title === 'string') {
        metaTitle = metadata.info.Title.trim();
      }
    } catch {
      // ignore metadata failures
    }

    const result: Omit<PdfExtractResult, 'fromCache'> = {
      title: metaTitle || pickTitleFromUrl(sourceUrl),
      content: hasTextLayer ? mergedText : TEXT_LAYER_EMPTY_MESSAGE,
      textContent: hasTextLayer ? mergedText : '',
      excerpt: hasTextLayer ? mergedText.slice(0, 200) : TEXT_LAYER_EMPTY_MESSAGE,
      url: sourceUrl,
      pageCount,
      extractedPages,
      note,
    };

    setCache(sourceUrl, result, now);
    return {
      ...result,
      fromCache: false,
    };
  } finally {
    if (pdf) {
      await invokeCleanupIfPossible((pdf as { destroy?: unknown }).destroy, pdf);
    } else {
      await invokeCleanupIfPossible((loadingTask as { destroy?: unknown }).destroy, loadingTask);
    }
  }
}

export function clearPdfExtractorCacheForTests(): void {
  pdfCache.clear();
  pdfJsApiPromise = null;
}
