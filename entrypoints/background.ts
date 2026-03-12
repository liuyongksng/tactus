async function openSidePanel(tabId?: number): Promise<void> {
  const sidePanelApi = (browser as any).sidePanel;
  if (sidePanelApi?.open && tabId) {
    await sidePanelApi.open({ tabId });
    return;
  }

  const sidebarActionApi = (browser as any).sidebarAction;
  if (sidebarActionApi?.open) {
    await sidebarActionApi.open();
    return;
  }

  throw new Error('当前浏览器不支持侧边栏 API');
}

async function executeMainWorldScript(tabId: number, code: string): Promise<void> {
  const scriptingApi = (browser as any).scripting;
  if (scriptingApi?.executeScript) {
    await scriptingApi.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (injectedCode: string) => {
        const script = document.createElement('script');
        script.textContent = injectedCode;
        document.documentElement.appendChild(script);
        script.remove();
      },
      args: [code],
    });
    return;
  }

  const tabsApi = (browser as any).tabs;
  if (tabsApi?.executeScript) {
    const injectionCode = `
(() => {
  const script = document.createElement('script');
  script.textContent = ${JSON.stringify(code)};
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();
})();`;
    await tabsApi.executeScript(tabId, { code: injectionCode });
    return;
  }

  throw new Error('当前浏览器不支持脚本注入 API');
}

async function readMainWorldResult(tabId: number, key: string): Promise<any> {
  const scriptingApi = (browser as any).scripting;
  if (scriptingApi?.executeScript) {
    const results = await scriptingApi.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (resultKey: string) => {
        const result = (window as any)[resultKey];
        if (result !== undefined && result !== null) {
          delete (window as any)[resultKey];
          return result;
        }
        return undefined;
      },
      args: [key],
    });

    return results?.[0]?.result;
  }

  const tabsApi = (browser as any).tabs;
  if (tabsApi?.executeScript) {
    const readCode = `
(() => {
  const resultKey = ${JSON.stringify(key)};
  const result = window[resultKey];
  if (result !== undefined && result !== null) {
    delete window[resultKey];
    return result;
  }
  return undefined;
})();`;

    const results = await tabsApi.executeScript(tabId, { code: readCode });
    return results?.[0];
  }

  throw new Error('当前浏览器不支持脚本读取 API');
}

// 执行脚本的核心逻辑
async function executeScriptInTab(tabId: number, code: string, args: Record<string, any>, scriptId: string): Promise<any> {
  const resultKey = `__skill_result_${scriptId}_${Date.now()}__`;
  
  const wrappedCode = `
(async () => {
  try {
    const __args__ = ${JSON.stringify(args || {})};
    const __result__ = await (async () => {
      ${code}
    })();
    window['${resultKey}'] = { success: true, data: __result__ };
  } catch (error) {
    window['${resultKey}'] = { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
})();
`;

  // 使用 script 标签注入执行，绕过 CSP
  await executeMainWorldScript(tabId, wrappedCode);

  // 轮询等待结果，最多 60 秒
  const maxWait = 60000;
  const interval = 1000;
  let waited = 0;
  
  while (waited < maxWait) {
    await new Promise(resolve => setTimeout(resolve, interval));
    waited += interval;

    // 检查是否获取到有效结果（必须是包含 success 属性的对象）
    const execResult = await readMainWorldResult(tabId, resultKey);
    if (execResult && typeof execResult === 'object' && 'success' in execResult) {
      if (execResult.success) {
        return execResult.data;
      } else {
        throw new Error(execResult.error);
      }
    }
  }
  
  throw new Error('脚本执行超时');
}

interface PdfDownloadCacheConfig {
  chunkSizeBytes: number;
  maxEntries: number;
  maxTotalBytes: number;
  sessionTtlMs: number;
}

interface PdfDownloadCacheEntry {
  url: string;
  bytes: Uint8Array;
  byteLength: number;
  lastAccessed: number;
  activeDownloadIds: Set<string>;
}

interface PdfDownloadSessionRecord {
  url: string;
  lastAccessed: number;
}

const DEFAULT_PDF_DOWNLOAD_CACHE_CONFIG: Readonly<PdfDownloadCacheConfig> = {
  chunkSizeBytes: 4 * 1024 * 1024,
  maxEntries: 5,
  maxTotalBytes: 256 * 1024 * 1024,
  sessionTtlMs: 5 * 60 * 1000,
};

const pdfDownloadCacheConfig: PdfDownloadCacheConfig = {
  ...DEFAULT_PDF_DOWNLOAD_CACHE_CONFIG,
};

const pdfDownloadCache = new Map<string, PdfDownloadCacheEntry>();
const pdfDownloadSessions = new Map<string, PdfDownloadSessionRecord>();
let pdfDownloadCacheTotalBytes = 0;
let pdfDownloadSessionCounter = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getMessageType(message: unknown): string | null {
  if (!isRecord(message)) return null;
  const { type } = message;
  return typeof type === 'string' ? type : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return '未知错误';
}

function parseNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} 不能为空`);
  }
  return value.trim();
}

function parseNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`${fieldName} 必须是非负整数`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} 必须是非负整数`);
  }
  return parsed;
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  const parsed = parseNonNegativeInteger(value, fieldName);
  if (parsed <= 0) {
    throw new Error(`${fieldName} 必须大于 0`);
  }
  return parsed;
}

function parsePdfUrlFromMessage(message: Record<string, unknown>): string {
  const rawUrl = message.url ?? message.sourceUrl ?? message.pdfUrl;
  return parseNonEmptyString(rawUrl, 'url');
}

function parseDownloadIdFromMessage(message: Record<string, unknown>): string {
  const rawDownloadId = message.downloadId ?? message.sessionId ?? message.id;
  return parseNonEmptyString(rawDownloadId, 'downloadId');
}

function parseChunkIndexFromMessage(message: Record<string, unknown>): number {
  const rawChunkIndex = message.chunkIndex ?? message.index;
  return parseNonNegativeInteger(rawChunkIndex, 'chunkIndex');
}

function isPdfDownloadSessionExpired(session: PdfDownloadSessionRecord, now: number): boolean {
  return now - session.lastAccessed > pdfDownloadCacheConfig.sessionTtlMs;
}

function releasePdfDownloadSession(downloadId: string): string | null {
  const session = pdfDownloadSessions.get(downloadId);
  if (!session) {
    return null;
  }

  pdfDownloadSessions.delete(downloadId);
  const entry = pdfDownloadCache.get(session.url);
  if (entry) {
    entry.activeDownloadIds.delete(downloadId);
  }
  return session.url;
}

function cleanupExpiredPdfDownloadSessions(now: number = Date.now()): void {
  for (const [downloadId, session] of pdfDownloadSessions.entries()) {
    if (isPdfDownloadSessionExpired(session, now)) {
      releasePdfDownloadSession(downloadId);
    }
  }
}

function touchPdfCacheEntry(url: string, entry: PdfDownloadCacheEntry): void {
  entry.lastAccessed = Date.now();
  pdfDownloadCache.delete(url);
  pdfDownloadCache.set(url, entry);
}

function removePdfCacheEntry(url: string): void {
  const entry = pdfDownloadCache.get(url);
  if (!entry || entry.activeDownloadIds.size > 0) {
    return;
  }
  pdfDownloadCache.delete(url);
  pdfDownloadCacheTotalBytes -= entry.byteLength;
  if (pdfDownloadCacheTotalBytes < 0) {
    pdfDownloadCacheTotalBytes = 0;
  }
}

function pickEvictablePdfCacheKey(): string | null {
  for (const [url, entry] of pdfDownloadCache.entries()) {
    if (entry.activeDownloadIds.size === 0) {
      return url;
    }
  }
  return null;
}

function ensurePdfCacheCapacity(requiredBytes: number, incomingEntries: number): boolean {
  cleanupExpiredPdfDownloadSessions();

  if (requiredBytes > pdfDownloadCacheConfig.maxTotalBytes) {
    return false;
  }

  while (
    pdfDownloadCache.size + incomingEntries > pdfDownloadCacheConfig.maxEntries
    || pdfDownloadCacheTotalBytes + requiredBytes > pdfDownloadCacheConfig.maxTotalBytes
  ) {
    const evictableKey = pickEvictablePdfCacheKey();
    if (!evictableKey) {
      return false;
    }
    removePdfCacheEntry(evictableKey);
  }
  return true;
}

function createPdfDownloadId(): string {
  pdfDownloadSessionCounter += 1;
  return `pdf_download_${Date.now()}_${pdfDownloadSessionCounter}`;
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  const maybeBuffer = (
    globalThis as { Buffer?: { from: (value: Uint8Array) => { toString: (encoding: string) => string } } }
  ).Buffer;
  if (maybeBuffer?.from) {
    return maybeBuffer.from(bytes).toString('base64');
  }

  if (typeof btoa !== 'function') {
    throw new Error('当前环境不支持 base64 编码');
  }

  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
    const end = Math.min(index + CHUNK_SIZE, bytes.length);
    binary += String.fromCharCode(...bytes.subarray(index, end));
  }
  return btoa(binary);
}

async function fetchPdfBinary(url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include' });
  } catch (error) {
    throw new Error(`下载 PDF 失败: ${toErrorMessage(error)}`);
  }

  if (!response.ok) {
    throw new Error(`下载 PDF 失败: HTTP ${response.status}`);
  }

  try {
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    throw new Error(`读取 PDF 数据失败: ${toErrorMessage(error)}`);
  }
}

async function handlePdfDownloadInit(message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const now = Date.now();
  cleanupExpiredPdfDownloadSessions(now);

  const url = parsePdfUrlFromMessage(message);
  let entry = pdfDownloadCache.get(url);
  let fromCache = Boolean(entry);

  if (!entry) {
    const bytes = await fetchPdfBinary(url);
    const existingEntry = pdfDownloadCache.get(url);
    if (existingEntry) {
      // 并发 INIT 时，后到请求复用已缓存 entry，避免重复累计 totalBytes。
      entry = existingEntry;
      fromCache = true;
    } else {
      if (!ensurePdfCacheCapacity(bytes.byteLength, 1)) {
        throw new Error('PDF 缓存空间不足，请先释放旧会话后重试');
      }

      entry = {
        url,
        bytes,
        byteLength: bytes.byteLength,
        lastAccessed: now,
        activeDownloadIds: new Set<string>(),
      };
      pdfDownloadCache.set(url, entry);
      pdfDownloadCacheTotalBytes += bytes.byteLength;
      fromCache = false;
    }
  }

  touchPdfCacheEntry(url, entry);
  const downloadId = createPdfDownloadId();
  entry.activeDownloadIds.add(downloadId);
  pdfDownloadSessions.set(downloadId, {
    url,
    lastAccessed: now,
  });

  const chunkCount = entry.byteLength === 0
    ? 0
    : Math.ceil(entry.byteLength / pdfDownloadCacheConfig.chunkSizeBytes);

  return {
    downloadId,
    url,
    chunkSize: pdfDownloadCacheConfig.chunkSizeBytes,
    chunkCount,
    totalBytes: entry.byteLength,
    fromCache,
    lastAccessed: entry.lastAccessed,
    cacheStats: {
      entries: pdfDownloadCache.size,
      totalBytes: pdfDownloadCacheTotalBytes,
    },
  };
}

function handlePdfDownloadChunk(message: Record<string, unknown>): Record<string, unknown> {
  const now = Date.now();
  cleanupExpiredPdfDownloadSessions(now);

  const downloadId = parseDownloadIdFromMessage(message);
  const chunkIndex = parseChunkIndexFromMessage(message);
  const session = pdfDownloadSessions.get(downloadId);

  if (!session) {
    throw new Error('下载会话不存在或已释放');
  }

  if (isPdfDownloadSessionExpired(session, now)) {
    releasePdfDownloadSession(downloadId);
    throw new Error('下载会话已过期，请重新初始化下载');
  }

  session.lastAccessed = now;
  const url = session.url;

  const entry = pdfDownloadCache.get(url);
  if (!entry) {
    releasePdfDownloadSession(downloadId);
    throw new Error('PDF 缓存已失效，请重新初始化下载');
  }

  touchPdfCacheEntry(url, entry);
  const chunkSize = pdfDownloadCacheConfig.chunkSizeBytes;
  const chunkCount = entry.byteLength === 0 ? 0 : Math.ceil(entry.byteLength / chunkSize);

  if (chunkCount === 0) {
    if (chunkIndex !== 0) {
      throw new Error('chunkIndex 超出范围');
    }
    return {
      downloadId,
      chunkIndex,
      chunkSize,
      chunkCount,
      totalBytes: 0,
      chunkByteLength: 0,
      isLastChunk: true,
      lastAccessed: entry.lastAccessed,
      chunk: new ArrayBuffer(0),
    };
  }

  if (chunkIndex >= chunkCount) {
    throw new Error('chunkIndex 超出范围');
  }

  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize, entry.byteLength);
  const chunkBytes = entry.bytes.slice(start, end);
  const chunkBase64 = encodeBytesToBase64(chunkBytes);

  return {
    downloadId,
    chunkIndex,
    chunkSize,
    chunkCount,
    totalBytes: entry.byteLength,
    chunkByteLength: chunkBytes.byteLength,
    isLastChunk: chunkIndex === chunkCount - 1,
    lastAccessed: entry.lastAccessed,
    base64: chunkBase64,
  };
}

function handlePdfDownloadRelease(message: Record<string, unknown>): Record<string, unknown> {
  const now = Date.now();
  cleanupExpiredPdfDownloadSessions(now);

  const downloadId = parseDownloadIdFromMessage(message);
  const url = releasePdfDownloadSession(downloadId);

  if (!url) {
    return {
      downloadId,
      released: false,
      cacheStats: {
        entries: pdfDownloadCache.size,
        totalBytes: pdfDownloadCacheTotalBytes,
      },
    };
  }

  ensurePdfCacheCapacity(0, 0);

  return {
    downloadId,
    released: true,
    cacheStats: {
      entries: pdfDownloadCache.size,
      totalBytes: pdfDownloadCacheTotalBytes,
    },
  };
}

function clearPdfDownloadCacheRuntime(): Record<string, unknown> {
  const before = {
    entries: pdfDownloadCache.size,
    totalBytes: pdfDownloadCacheTotalBytes,
    sessions: pdfDownloadSessions.size,
  };

  pdfDownloadCache.clear();
  pdfDownloadSessions.clear();
  pdfDownloadCacheTotalBytes = 0;
  pdfDownloadSessionCounter = 0;

  return {
    cleared: true,
    before,
    after: {
      entries: 0,
      totalBytes: 0,
      sessions: 0,
    },
  };
}

function runAsyncMessageHandler(
  sendResponse: (response: Record<string, unknown>) => void,
  handler: () => Promise<Record<string, unknown>> | Record<string, unknown>,
): void {
  Promise.resolve()
    .then(handler)
    .then(payload => {
      sendResponse({ success: true, ...payload });
    })
    .catch(error => {
      sendResponse({
        success: false,
        error: toErrorMessage(error),
      });
    });
}

export function resetPdfDownloadCacheForTests(): void {
  pdfDownloadCache.clear();
  pdfDownloadSessions.clear();
  pdfDownloadCacheTotalBytes = 0;
  pdfDownloadSessionCounter = 0;
  Object.assign(pdfDownloadCacheConfig, DEFAULT_PDF_DOWNLOAD_CACHE_CONFIG);
}

export function setPdfDownloadCacheConfigForTests(config: Partial<PdfDownloadCacheConfig>): void {
  if (typeof config.chunkSizeBytes !== 'undefined') {
    pdfDownloadCacheConfig.chunkSizeBytes = parsePositiveInteger(config.chunkSizeBytes, 'chunkSizeBytes');
  }
  if (typeof config.maxEntries !== 'undefined') {
    pdfDownloadCacheConfig.maxEntries = parsePositiveInteger(config.maxEntries, 'maxEntries');
  }
  if (typeof config.maxTotalBytes !== 'undefined') {
    pdfDownloadCacheConfig.maxTotalBytes = parsePositiveInteger(config.maxTotalBytes, 'maxTotalBytes');
  }
  if (typeof config.sessionTtlMs !== 'undefined') {
    pdfDownloadCacheConfig.sessionTtlMs = parsePositiveInteger(config.sessionTtlMs, 'sessionTtlMs');
  }

  ensurePdfCacheCapacity(0, 0);
}

export default defineBackground(() => {
  // 监听扩展安装事件
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install') {
      // 首次安装时，检测并设置语言
      const { initializeLanguage } = await import('../utils/storage');
      await initializeLanguage();
    }
  });

  // 跟踪 sidepanel 连接状态
  let sidePanelPort: any = null;

  // 监听 sidepanel 连接
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel') {
      sidePanelPort = port;
      port.onDisconnect.addListener(() => {
        sidePanelPort = null;
      });
    }
  });

  // Open/toggle side panel when extension icon is clicked
  const actionApi = (browser as any).action ?? (browser as any).browserAction;
  actionApi?.onClicked?.addListener(async (tab: any) => {
    try {
      // Firefox: use sidebarAction.toggle() for open/close behavior
      const sidebarActionApi = (browser as any).sidebarAction;
      if (sidebarActionApi?.toggle) {
        await sidebarActionApi.toggle();
        return;
      }
      // Chrome: fallback to openSidePanel (though setPanelBehavior handles this)
      await openSidePanel(tab?.id);
    } catch (error) {
      console.error('Failed to open side panel:', error);
    }
  });

  // Handle messages from content script
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const normalizedMessage = isRecord(message) ? message : {};
    const messageType = getMessageType(normalizedMessage);

    if (messageType === 'OPEN_SIDEPANEL') {
      openSidePanel(sender.tab?.id).catch((error) => {
        console.error('Failed to open side panel:', error);
      });
    }
    if (messageType === 'TOGGLE_SIDEPANEL') {
      if ((browser as any).sidePanel?.open) {
        if (sidePanelPort) {
          // sidepanel 已打开，发送关闭消息
          sidePanelPort.postMessage({ type: 'CLOSE' });
        } else {
          // sidepanel 未打开，打开它
          openSidePanel(sender.tab?.id).catch((error) => {
            console.error('Failed to open side panel:', error);
          });
        }
      } else {
        const sidebarActionApi = (browser as any).sidebarAction;
        if (sidePanelPort && sidebarActionApi?.close) {
          sidebarActionApi.close().catch((error: unknown) => {
            console.error('Failed to close sidebar:', error);
          });
        } else if (sidePanelPort) {
          sidePanelPort.postMessage({ type: 'CLOSE' });
        } else {
          openSidePanel(sender.tab?.id).catch((error) => {
            console.error('Failed to open side panel:', error);
          });
        }
      }
    }
    if (messageType === 'SET_QUOTE') {
      // Store quote temporarily for sidepanel to pick up
      browser.storage.local.set({ pendingQuote: normalizedMessage.quote });
    }

    if (messageType === 'PDF_DOWNLOAD_INIT') {
      runAsyncMessageHandler(sendResponse, () => handlePdfDownloadInit(normalizedMessage));
      return true;
    }

    if (messageType === 'PDF_DOWNLOAD_CHUNK') {
      runAsyncMessageHandler(sendResponse, () => handlePdfDownloadChunk(normalizedMessage));
      return true;
    }

    if (messageType === 'PDF_DOWNLOAD_RELEASE') {
      runAsyncMessageHandler(sendResponse, () => handlePdfDownloadRelease(normalizedMessage));
      return true;
    }

    if (messageType === 'PDF_CACHE_CLEAR_ALL') {
      runAsyncMessageHandler(sendResponse, () => clearPdfDownloadCacheRuntime());
      return true;
    }
    
    // 处理脚本执行请求
    if (messageType === 'EXECUTE_SKILL_SCRIPT') {
      runAsyncMessageHandler(sendResponse, async () => {
        const tabId = parseNonNegativeInteger(normalizedMessage.tabId, 'tabId');
        const code = parseNonEmptyString(normalizedMessage.code, 'code');
        const scriptId = parseNonEmptyString(normalizedMessage.scriptId, 'scriptId');
        const args = isRecord(normalizedMessage.args) ? normalizedMessage.args : {};
        const result = await executeScriptInTab(tabId, code, args, scriptId);
        return { result };
      });
      return true;
    }
    
    return true;
  });

  // Set side panel behavior
  (browser as any).sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
});
