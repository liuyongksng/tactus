import { describe, expect, it } from 'vitest';
import {
  buildPdfToolStatus,
  getExtractPageStatusText,
} from '../../entrypoints/sidepanel/pdfUi';

describe('sidepanel PDF 状态文案构建', () => {
  it('应根据语言返回固定流程状态文案', () => {
    expect(getExtractPageStatusText('zh-CN', 'preparingPdf')).toBe('提取页面内容：正在准备 PDF 提取...');
    expect(getExtractPageStatusText('en', 'preparingPdf')).toBe('Extracting page content: preparing PDF extraction...');
  });

  it('应把 PDF 解析进度格式化到工具状态中', () => {
    const status = buildPdfToolStatus('en', {
      stage: 'parse',
      loadedBytes: 50,
      totalBytes: 100,
      currentPage: 3,
      totalPages: 10,
      message: 'Parsing PDF',
    });
    expect(status).toContain('Extracting page content:');
    expect(status).toContain('3/10');
  });
});
