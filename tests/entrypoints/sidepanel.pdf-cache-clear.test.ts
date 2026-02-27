import { describe, expect, it } from 'vitest';
import { parsePdfCacheClearResponse } from '../../entrypoints/sidepanel/pdfUi';

describe('sidepanel PDF 缓存清理响应解析', () => {
  it('应在 success=true 时识别为成功', () => {
    const parsed = parsePdfCacheClearResponse({ success: true });
    expect(parsed).toEqual({ success: true, errorText: null });
  });

  it('应在失败响应中提取错误文案', () => {
    const parsed = parsePdfCacheClearResponse({ success: false, error: 'mock clear failed' });
    expect(parsed).toEqual({ success: false, errorText: 'mock clear failed' });
  });

  it('应在非预期响应中回退为失败且无错误文本', () => {
    const parsed = parsePdfCacheClearResponse('unexpected');
    expect(parsed).toEqual({ success: false, errorText: null });
  });
});
