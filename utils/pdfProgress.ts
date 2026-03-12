export type PdfProgressLanguage = 'zh-CN' | 'en';

export interface PdfExtractProgress {
  stage: 'download' | 'parse';
  loadedBytes: number;
  totalBytes: number;
  currentPage?: number;
  totalPages?: number;
  message: string;
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const text = unitIndex === 0 || value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${text} ${units[unitIndex]}`;
}

export function formatPdfExtractionProgressText(
  progress: PdfExtractProgress,
  language: PdfProgressLanguage = 'zh-CN',
): string {
  if (language === 'en') {
    if (progress.stage === 'download') {
      if (progress.totalBytes > 0) {
        const safeLoaded = Math.min(Math.max(progress.loadedBytes, 0), progress.totalBytes);
        const percent = Math.round((safeLoaded / progress.totalBytes) * 100);
        return `PDF download ${percent}% (${formatBytes(safeLoaded)} / ${formatBytes(progress.totalBytes)})`;
      }
      return `PDF downloading (${formatBytes(Math.max(progress.loadedBytes, 0))} received)`;
    }

    const totalPages = Math.max(progress.totalPages ?? progress.totalBytes, 0);
    const currentPage = Math.max(progress.currentPage ?? progress.loadedBytes, 0);
    if (totalPages > 0) {
      return `PDF parsing ${Math.min(currentPage, totalPages)}/${totalPages} pages`;
    }
    return 'PDF parsing';
  }

  if (progress.stage === 'download') {
    if (progress.totalBytes > 0) {
      const safeLoaded = Math.min(Math.max(progress.loadedBytes, 0), progress.totalBytes);
      const percent = Math.round((safeLoaded / progress.totalBytes) * 100);
      return `PDF 下载 ${percent}%（${formatBytes(safeLoaded)} / ${formatBytes(progress.totalBytes)}）`;
    }
    return `PDF 下载中（已接收 ${formatBytes(Math.max(progress.loadedBytes, 0))}）`;
  }

  const totalPages = Math.max(progress.totalPages ?? progress.totalBytes, 0);
  const currentPage = Math.max(progress.currentPage ?? progress.loadedBytes, 0);
  if (totalPages > 0) {
    return `PDF 解析 ${Math.min(currentPage, totalPages)}/${totalPages} 页`;
  }
  return 'PDF 解析中';
}
