type PageExtractorModule = typeof import('../../../utils/pageExtractor');
type PdfExtractorModule = typeof import('../../../utils/pdfExtractor');

let pageExtractorPromise: Promise<PageExtractorModule> | null = null;
let pdfExtractorPromise: Promise<PdfExtractorModule> | null = null;

export async function loadPageExtractorModule(): Promise<PageExtractorModule> {
  if (!pageExtractorPromise) {
    pageExtractorPromise = import('../../../utils/pageExtractor').catch((error) => {
      pageExtractorPromise = null;
      throw error;
    });
  }
  return pageExtractorPromise;
}

export async function loadPdfExtractorModule(): Promise<PdfExtractorModule> {
  if (!pdfExtractorPromise) {
    pdfExtractorPromise = import('../../../utils/pdfExtractor').catch((error) => {
      pdfExtractorPromise = null;
      throw error;
    });
  }
  return pdfExtractorPromise;
}
