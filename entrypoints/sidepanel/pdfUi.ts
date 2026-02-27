import {
  formatPdfExtractionProgressText,
  type PdfExtractProgress,
} from '../../utils/pdfExtractor';

export type PdfStatusLanguage = 'zh-CN' | 'en';

export type ExtractPageStatusKey =
  | 'preparing'
  | 'checkingPageType'
  | 'preparingPdf'
  | 'readingHtml'
  | 'nestedPdf'
  | 'parsingHtml';

const EXTRACT_PAGE_STATUS_TEXT: Record<ExtractPageStatusKey, Record<PdfStatusLanguage, string>> = {
  preparing: {
    'zh-CN': '提取页面内容：准备中...',
    en: 'Extracting page content: preparing...',
  },
  checkingPageType: {
    'zh-CN': '提取页面内容：正在检查页面类型...',
    en: 'Extracting page content: checking page type...',
  },
  preparingPdf: {
    'zh-CN': '提取页面内容：正在准备 PDF 提取...',
    en: 'Extracting page content: preparing PDF extraction...',
  },
  readingHtml: {
    'zh-CN': '提取页面内容：正在读取网页源码...',
    en: 'Extracting page content: reading page source...',
  },
  nestedPdf: {
    'zh-CN': '提取页面内容：检测到嵌套 PDF，正在提取...',
    en: 'Extracting page content: nested PDF detected, extracting...',
  },
  parsingHtml: {
    'zh-CN': '提取页面内容：正在解析网页正文...',
    en: 'Extracting page content: parsing page content...',
  },
};

export function getExtractPageStatusText(language: PdfStatusLanguage, key: ExtractPageStatusKey): string {
  return EXTRACT_PAGE_STATUS_TEXT[key][language];
}

export function buildPdfToolStatus(language: PdfStatusLanguage, progress: PdfExtractProgress): string {
  const progressText = formatPdfExtractionProgressText(progress, language);
  return language === 'zh-CN'
    ? `提取页面内容：${progressText}`
    : `Extracting page content: ${progressText}`;
}

export interface PdfCacheClearParseResult {
  success: boolean;
  errorText: string | null;
}

export function parsePdfCacheClearResponse(response: unknown): PdfCacheClearParseResult {
  if (response && typeof response === 'object') {
    const payload = response as { success?: unknown; error?: unknown };
    if (payload.success === true) {
      return { success: true, errorText: null };
    }
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return { success: false, errorText: payload.error };
    }
  }
  return { success: false, errorText: null };
}
