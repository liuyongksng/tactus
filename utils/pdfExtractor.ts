import {
  formatPdfExtractionProgressText,
  type PdfExtractProgress,
} from './pdfProgress';

const PDF_CACHE_LIMIT = 5;
const PDF_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PAGES = 30;
const PDF_PARSE_YIELD_EVERY_PAGES = 8;
const PDF_SIGNATURE_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
const TEXT_LAYER_EMPTY_MESSAGE = '未检测到可提取的文本层，当前 PDF 可能是扫描版。';
const PDF_VIEWER_PATH_PATTERNS = [
  /\/viewer\.html$/i,
  /\/web\/viewer\.html$/i,
  /\/pdfjs\/web\/viewer\.html$/i,
  /\/pdf\/viewer\.html$/i,
  /\/viewer$/i,
];
const RUNTIME_CHUNK_PROTOCOLS = [
  {
    init: 'PDF_DOWNLOAD_INIT',
    chunk: 'PDF_DOWNLOAD_CHUNK',
    release: 'PDF_DOWNLOAD_RELEASE',
  },
  {
    init: 'PDF_CHUNK_INIT',
    chunk: 'PDF_CHUNK_GET',
    release: 'PDF_CHUNK_RELEASE',
  },
  {
    init: 'PDF_FETCH_INIT',
    chunk: 'PDF_FETCH_CHUNK',
    release: 'PDF_FETCH_RELEASE',
  },
  {
    init: 'PDF_RUNTIME_CHUNK_INIT',
    chunk: 'PDF_RUNTIME_CHUNK_GET',
    release: 'PDF_RUNTIME_CHUNK_RELEASE',
  },
] as const;

type PdfLoadingTask = ReturnType<(typeof import('pdfjs-dist'))['getDocument']>;
type PdfDocumentProxy = Awaited<PdfLoadingTask['promise']>;
type PdfProgressListener = (progress: PdfExtractProgress) => void;

export { formatPdfExtractionProgressText };
export type { PdfExtractProgress };

export interface PdfExtractOptions {
  maxPages?: number;
  maxChars?: number;
  now?: number;
  onProgress?: PdfProgressListener;
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

interface InflightPdfRecord {
  promise: Promise<Omit<PdfExtractResult, 'fromCache'>>;
  listeners: Set<PdfProgressListener>;
  lastProgress: PdfExtractProgress | null;
}

interface RuntimeChunkInitInfo {
  downloadId: string;
  totalBytes: number;
  chunkCount: number;
}

interface RuntimeChunkData {
  index: number;
  start: number;
  end: number;
  bytes: Uint8Array;
}

interface PdfDownloadResult {
  bytes: Uint8Array;
  release: (() => Promise<void>) | null;
}

interface RuntimeMessenger {
  sendMessage: (message: unknown) => Promise<unknown>;
}

const pdfCache = new Map<string, PdfCacheRecord>();
const inflightPdfMap = new Map<string, InflightPdfRecord>();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getRuntimeMessenger(): RuntimeMessenger | null {
  const runtimeFromBrowser = (globalThis as { browser?: { runtime?: RuntimeMessenger } }).browser?.runtime;
  if (runtimeFromBrowser?.sendMessage) return runtimeFromBrowser;

  const runtimeFromChrome = (globalThis as { chrome?: { runtime?: RuntimeMessenger } }).chrome?.runtime;
  if (runtimeFromChrome?.sendMessage) return runtimeFromChrome;

  return null;
}

function withDownloadErrorPrefix(message: string): Error {
  if (message.startsWith('下载 PDF 失败:')) {
    return new Error(message);
  }
  return new Error(`下载 PDF 失败: ${message}`);
}

function getErrorMessage(error: unknown, fallback = '未知错误'): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
}

function extractResponseError(payload: unknown): string | null {
  if (!isRecord(payload)) {
    if (typeof payload === 'string' && payload.trim()) {
      return payload;
    }
    return null;
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  if (isRecord(payload.error) && typeof payload.error.message === 'string') {
    return payload.error.message;
  }
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  return null;
}

function normalizeRuntimeResponse(response: unknown): unknown {
  if (!isRecord(response)) {
    return response;
  }

  if (response.success === false || response.ok === false) {
    throw new Error(extractResponseError(response) || 'runtime 响应失败');
  }

  if ('data' in response && response.data !== undefined) {
    return response.data;
  }
  if ('payload' in response && response.payload !== undefined) {
    return response.payload;
  }
  if ('result' in response && response.result !== undefined) {
    return response.result;
  }
  return response;
}

function isUnsupportedRuntimeProtocolMessage(message: string): boolean {
  return /unknown|unsupported|not implemented|receiving end does not exist|no listener|message port closed before a response was received/i.test(message);
}

function isRuntimeRecoverableMessage(message: string): boolean {
  if (isUnsupportedRuntimeProtocolMessage(message)) {
    return true;
  }
  return /缓存空间不足|cache.*(full|limit|space)|quota|下载会话已过期|session expired/i.test(message);
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function normalizeMaxPagesOption(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_PAGES;
  }
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : DEFAULT_MAX_PAGES;
}

function normalizeMaxCharsOption(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function buildExtractionCacheKey(sourceUrl: string, options: PdfExtractOptions): string {
  const maxPages = normalizeMaxPagesOption(options.maxPages);
  const maxChars = normalizeMaxCharsOption(options.maxChars);
  return `${sourceUrl}::pages=${maxPages};chars=${maxChars ?? 'all'}`;
}

async function yieldMainThreadIfNeeded(pageNo: number): Promise<void> {
  if (pageNo % PDF_PARSE_YIELD_EVERY_PAGES !== 0) {
    return;
  }
  await new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}

function decodeBase64(input: string): Uint8Array {
  const source = input.includes(',') ? input.slice(input.lastIndexOf(',') + 1) : input;
  const normalized = source.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  const maybeBuffer = (globalThis as { Buffer?: { from: (value: string, encoding: string) => Uint8Array } }).Buffer;
  if (maybeBuffer?.from) {
    return Uint8Array.from(maybeBuffer.from(padded, 'base64'));
  }

  throw new Error('当前环境不支持 base64 解码');
}

function normalizeChunkBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }

  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }

  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }

  if (Array.isArray(raw)) {
    return Uint8Array.from(raw.map(item => Number(item)));
  }

  if (typeof raw === 'string') {
    return decodeBase64(raw);
  }

  if (isRecord(raw)) {
    if ('data' in raw) {
      return normalizeChunkBytes(raw.data);
    }
    if ('chunk' in raw) {
      return normalizeChunkBytes(raw.chunk);
    }
    if ('bytes' in raw) {
      return normalizeChunkBytes(raw.bytes);
    }
  }

  throw new Error('chunk 数据格式无法识别');
}

function parseRuntimeInitPayload(payload: unknown): RuntimeChunkInitInfo {
  if (!isRecord(payload)) {
    throw new Error('runtime init 响应格式无效');
  }

  const downloadIdRaw = payload.downloadId ?? payload.sessionId ?? payload.requestId ?? payload.id;
  if (typeof downloadIdRaw !== 'string' || !downloadIdRaw.trim()) {
    throw new Error('runtime init 缺少 downloadId/sessionId');
  }

  const totalBytes = parsePositiveInt(
    payload.totalBytes ?? payload.size ?? payload.totalSize ?? payload.contentLength,
  );
  if (!totalBytes) {
    throw new Error('runtime init 缺少 totalBytes');
  }

  const chunkCountFromPayload = parsePositiveInt(payload.chunkCount ?? payload.totalChunks ?? payload.chunks);
  const chunkSize = parsePositiveInt(payload.chunkSize ?? payload.maxChunkSize);
  const chunkCount = chunkCountFromPayload ?? (chunkSize ? Math.ceil(totalBytes / chunkSize) : null);

  if (!chunkCount || chunkCount <= 0) {
    throw new Error('runtime init 缺少 chunkCount');
  }

  return {
    downloadId: downloadIdRaw,
    totalBytes,
    chunkCount,
  };
}

function parseRuntimeChunkPayload(
  payload: unknown,
  expectedIndex: number,
  expectedStart: number,
  totalBytes: number,
): RuntimeChunkData {
  if (!isRecord(payload)) {
    throw new Error('runtime chunk 响应格式无效');
  }

  const rawBytes = payload.chunk ?? payload.bytes ?? payload.data ?? payload.base64 ?? payload.content;
  const bytes = normalizeChunkBytes(rawBytes);
  if (bytes.length === 0) {
    throw new Error(`runtime chunk ${expectedIndex} 返回空数据`);
  }

  const returnedIndexRaw = payload.index ?? payload.chunkIndex;
  if (returnedIndexRaw !== undefined) {
    const returnedIndex = parseNonNegativeInt(returnedIndexRaw);
    if (returnedIndex === null || returnedIndex !== expectedIndex) {
      throw new Error(`runtime chunk 索引不匹配: 期望 ${expectedIndex}，实际 ${String(returnedIndexRaw)}`);
    }
  }

  const start = parseNonNegativeInt(payload.start ?? payload.offset ?? payload.byteStart) ?? expectedStart;
  const endRaw = payload.end ?? payload.byteEnd;
  const end = parseNonNegativeInt(endRaw) ?? (start + bytes.length);

  if (start < 0 || end <= start || end > totalBytes) {
    throw new Error(`chunk越界: index=${expectedIndex}, range=[${start}, ${end}), total=${totalBytes}`);
  }
  if (start !== expectedStart) {
    throw new Error(`chunk越界: index=${expectedIndex}, start=${start}, expectedStart=${expectedStart}`);
  }
  if (end - start !== bytes.length) {
    throw new Error(`chunk长度不一致: index=${expectedIndex}, range=${end - start}, bytes=${bytes.length}`);
  }

  return {
    index: expectedIndex,
    start,
    end,
    bytes,
  };
}

function assertPdfSignature(bytes: Uint8Array): void {
  if (bytes.length < PDF_SIGNATURE_BYTES.length) {
    throw withDownloadErrorPrefix('总字节不足，无法校验 %PDF- 文件头');
  }
  for (let i = 0; i < PDF_SIGNATURE_BYTES.length; i += 1) {
    if (bytes[i] !== PDF_SIGNATURE_BYTES[i]) {
      throw withDownloadErrorPrefix('文件头校验失败，缺少 %PDF- 标识');
    }
  }
}

function createDownloadProgress(loadedBytes: number, totalBytes: number): PdfExtractProgress {
  const safeLoaded = Math.max(0, loadedBytes);
  const safeTotal = Math.max(0, totalBytes);
  const progress: PdfExtractProgress = {
    stage: 'download',
    loadedBytes: safeLoaded,
    totalBytes: safeTotal,
    message: '',
  };
  progress.message = formatPdfExtractionProgressText(progress);
  return progress;
}

function createParseProgress(currentPage: number, totalPages: number): PdfExtractProgress {
  const safeCurrent = Math.max(0, currentPage);
  const safeTotal = Math.max(0, totalPages);
  const progress: PdfExtractProgress = {
    stage: 'parse',
    loadedBytes: safeCurrent,
    totalBytes: safeTotal,
    currentPage: safeCurrent,
    totalPages: safeTotal,
    message: '',
  };
  progress.message = formatPdfExtractionProgressText(progress);
  return progress;
}

function emitProgress(record: InflightPdfRecord, progress: PdfExtractProgress): void {
  record.lastProgress = progress;
  for (const listener of record.listeners) {
    try {
      listener(progress);
    } catch {
      // ignore progress callback failures
    }
  }
}

function addProgressListener(record: InflightPdfRecord, listener?: PdfProgressListener): void {
  if (!listener) return;
  record.listeners.add(listener);
  if (record.lastProgress) {
    try {
      listener(record.lastProgress);
    } catch {
      // ignore progress callback failures
    }
  }
}

function removeProgressListener(record: InflightPdfRecord, listener?: PdfProgressListener): void {
  if (!listener) return;
  record.listeners.delete(listener);
}

async function tryDownloadPdfViaRuntimeChunks(
  sourceUrl: string,
  onProgress: (progress: PdfExtractProgress) => void,
): Promise<PdfDownloadResult | null> {
  const runtime = getRuntimeMessenger();
  if (!runtime) {
    return null;
  }

  for (const protocol of RUNTIME_CHUNK_PROTOCOLS) {
    try {
      const initResponse = await runtime.sendMessage({
        type: protocol.init,
        url: sourceUrl,
      });
      if (initResponse === undefined || initResponse === null) {
        continue;
      }

      const initInfo = parseRuntimeInitPayload(normalizeRuntimeResponse(initResponse));
      const bytes = new Uint8Array(initInfo.totalBytes);
      let loadedBytes = 0;
      const downloadId = initInfo.downloadId;

      const release = async (): Promise<void> => {
        try {
          await runtime.sendMessage({
            type: protocol.release,
            downloadId,
            sessionId: downloadId,
          });
        } catch {
          // ignore release failures
        }
      };

      onProgress(createDownloadProgress(0, initInfo.totalBytes));

      try {
        for (let index = 0; index < initInfo.chunkCount; index += 1) {
          const chunkResponse = await runtime.sendMessage({
            type: protocol.chunk,
            downloadId,
            sessionId: downloadId,
            chunkIndex: index,
            index,
          });
          const chunkInfo = parseRuntimeChunkPayload(
            normalizeRuntimeResponse(chunkResponse),
            index,
            loadedBytes,
            initInfo.totalBytes,
          );
          bytes.set(chunkInfo.bytes, chunkInfo.start);
          loadedBytes = chunkInfo.end;
          onProgress(createDownloadProgress(loadedBytes, initInfo.totalBytes));
        }

        if (loadedBytes !== initInfo.totalBytes) {
          throw new Error(`总字节不一致: 期望 ${initInfo.totalBytes}，实际 ${loadedBytes}`);
        }

        assertPdfSignature(bytes);
        return {
          bytes,
          release,
        };
      } catch (error) {
        await release();
        throw error;
      }
    } catch (error) {
      const message = getErrorMessage(error);
      if (isRuntimeRecoverableMessage(message)) {
        continue;
      }
      throw withDownloadErrorPrefix(message);
    }
  }

  return null;
}

async function downloadPdfViaFetch(
  sourceUrl: string,
  onProgress: (progress: PdfExtractProgress) => void,
): Promise<PdfDownloadResult> {
  let response: Response;
  try {
    response = await fetch(sourceUrl, { credentials: 'include' });
  } catch (error) {
    throw withDownloadErrorPrefix(getErrorMessage(error, '网络异常'));
  }

  if (!response.ok) {
    throw withDownloadErrorPrefix(`HTTP ${response.status}`);
  }

  const totalBytesFromHeader = parsePositiveInt(response.headers?.get?.('content-length'));
  if (totalBytesFromHeader) {
    onProgress(createDownloadProgress(0, totalBytesFromHeader));
  } else {
    onProgress(createDownloadProgress(0, 0));
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (totalBytesFromHeader && bytes.length !== totalBytesFromHeader) {
    throw withDownloadErrorPrefix(`总字节不一致: 期望 ${totalBytesFromHeader}，实际 ${bytes.length}`);
  }

  assertPdfSignature(bytes);
  onProgress(createDownloadProgress(bytes.length, bytes.length));

  return {
    bytes,
    release: null,
  };
}

async function downloadPdfBytes(
  sourceUrl: string,
  onProgress: (progress: PdfExtractProgress) => void,
): Promise<PdfDownloadResult> {
  const runtimeDownloaded = await tryDownloadPdfViaRuntimeChunks(sourceUrl, onProgress);
  if (runtimeDownloaded) {
    return runtimeDownloaded;
  }
  return downloadPdfViaFetch(sourceUrl, onProgress);
}

async function extractPdfContentInternal(
  cacheKey: string,
  sourceUrl: string,
  options: PdfExtractOptions,
  onProgress: (progress: PdfExtractProgress) => void,
): Promise<Omit<PdfExtractResult, 'fromCache'>> {
  const now = options.now ?? Date.now();
  let releaseDownload: (() => Promise<void>) | null = null;
  let loadingTask: PdfLoadingTask | null = null;
  let pdf: PdfDocumentProxy | null = null;

  try {
    const downloaded = await downloadPdfBytes(sourceUrl, onProgress);
    releaseDownload = downloaded.release;

    const { getDocument } = await loadPdfJsApi();
    loadingTask = getDocument({
      data: downloaded.bytes,
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true,
    });
    pdf = await loadingTask.promise;

    const maxPages = normalizeMaxPagesOption(options.maxPages);
    const maxChars = normalizeMaxCharsOption(options.maxChars);
    const pageCount = pdf.numPages;
    const targetPages = maxPages === 0
      ? pageCount
      : Math.min(pageCount, Math.max(1, maxPages));
    const pageTexts: string[] = [];
    let extractedPages = 0;
    let mergedTextLength = 0;
    let reachedMaxChars = false;

    onProgress(createParseProgress(0, targetPages));
    for (let pageNo = 1; pageNo <= targetPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      try {
        const textContent = await page.getTextContent({ disableNormalization: false });
        const lines = textContent.items
          .map(getItemText)
          .map(text => text.trim())
          .filter(Boolean);
        const pageText = lines.join(' ');
        if (pageTexts.length > 0) {
          mergedTextLength += 2;
        }
        mergedTextLength += pageText.length;
        pageTexts.push(pageText);
      } finally {
        page.cleanup();
      }
      extractedPages = pageNo;
      onProgress(createParseProgress(pageNo, targetPages));
      await yieldMainThreadIfNeeded(pageNo);
      if (maxChars !== null && mergedTextLength >= maxChars) {
        reachedMaxChars = true;
        break;
      }
    }

    const noteParts: string[] = [];
    if (pageCount > extractedPages) {
      noteParts.push(`仅提取前 ${extractedPages} 页，共 ${pageCount} 页。`);
    }
    if (reachedMaxChars && maxChars !== null) {
      noteParts.push(`文本达到 ${maxChars} 字符上限，已在第 ${extractedPages} 页提前停止提取。`);
    }
    let note: string | null = noteParts.length > 0 ? noteParts.join(' ') : null;

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

    setCache(cacheKey, result, now);
    return result;
  } finally {
    await invokeCleanupIfPossible(releaseDownload, undefined);
    if (pdf) {
      await invokeCleanupIfPossible((pdf as { destroy?: unknown }).destroy, pdf);
    } else if (loadingTask) {
      await invokeCleanupIfPossible((loadingTask as { destroy?: unknown }).destroy, loadingTask);
    }
  }
}

export async function extractPdfContent(
  pageUrl: string,
  options: PdfExtractOptions = {},
): Promise<PdfExtractResult> {
  const sourceUrl = resolvePdfSourceUrl(pageUrl);
  if (!sourceUrl) {
    throw new Error('当前页面不是可识别的 PDF 地址');
  }
  const cacheKey = buildExtractionCacheKey(sourceUrl, options);

  const now = options.now ?? Date.now();
  const cached = getCache(cacheKey, now);
  if (cached) {
    return {
      ...cached,
      fromCache: true,
    };
  }

  const existingTask = inflightPdfMap.get(cacheKey);
  if (existingTask) {
    addProgressListener(existingTask, options.onProgress);
    try {
      const result = await existingTask.promise;
      return {
        ...result,
        fromCache: false,
      };
    } finally {
      removeProgressListener(existingTask, options.onProgress);
    }
  }

  const record: InflightPdfRecord = {
    promise: Promise.resolve({} as Omit<PdfExtractResult, 'fromCache'>),
    listeners: new Set<PdfProgressListener>(),
    lastProgress: null,
  };

  addProgressListener(record, options.onProgress);

  const extractionPromise = extractPdfContentInternal(cacheKey, sourceUrl, options, progress => {
    emitProgress(record, progress);
  });

  record.promise = extractionPromise.finally(() => {
    inflightPdfMap.delete(cacheKey);
    record.listeners.clear();
    record.lastProgress = null;
  });
  inflightPdfMap.set(cacheKey, record);

  try {
    const result = await record.promise;
    return {
      ...result,
      fromCache: false,
    };
  } finally {
    removeProgressListener(record, options.onProgress);
  }
}

export function clearPdfExtractorRuntimeCache(): void {
  pdfCache.clear();
  inflightPdfMap.clear();
}

export function clearPdfExtractorCacheForTests(): void {
  clearPdfExtractorRuntimeCache();
  pdfJsApiPromise = null;
}
