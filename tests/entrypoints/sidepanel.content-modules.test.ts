import { describe, expect, it, vi } from 'vitest';

const extractPageContentMock = vi.fn();
const truncateContentMock = vi.fn();
const isPdfUrlMock = vi.fn();
const extractPdfContentMock = vi.fn();
const clearPdfExtractorRuntimeCacheMock = vi.fn();

vi.mock('../../utils/pageExtractor', () => ({
  extractPageContent: extractPageContentMock,
  truncateContent: truncateContentMock,
}));

vi.mock('../../utils/pdfExtractor', () => ({
  isPdfUrl: isPdfUrlMock,
  extractPdfContent: extractPdfContentMock,
  clearPdfExtractorRuntimeCache: clearPdfExtractorRuntimeCacheMock,
}));

import { loadPageExtractorModule, loadPdfExtractorModule } from '../../entrypoints/sidepanel/extractors/contentModules';

describe('sidepanel content modules', () => {
  it('页面提取器应按需加载并缓存模块实例', async () => {
    const first = await loadPageExtractorModule();
    const second = await loadPageExtractorModule();

    expect(second).toBe(first);
    expect(first.extractPageContent).toBe(extractPageContentMock);
    expect(first.truncateContent).toBe(truncateContentMock);
  });

  it('PDF 提取器应按需加载并缓存模块实例', async () => {
    const first = await loadPdfExtractorModule();
    const second = await loadPdfExtractorModule();

    expect(second).toBe(first);
    expect(first.isPdfUrl).toBe(isPdfUrlMock);
    expect(first.extractPdfContent).toBe(extractPdfContentMock);
    expect(first.clearPdfExtractorRuntimeCache).toBe(clearPdfExtractorRuntimeCacheMock);
  });
});
