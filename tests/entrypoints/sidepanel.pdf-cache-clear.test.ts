import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const appVuePath = resolve(currentDir, '../../entrypoints/sidepanel/App.vue');

describe('sidepanel PDF 缓存清理入口', () => {
  it('应在右上操作区提供清理按钮并触发双层缓存清理', () => {
    const source = readFileSync(appVuePath, 'utf8');

    expect(source).toContain('clearPdfExtractorRuntimeCache');
    expect(source).toContain("browser.runtime.sendMessage({ type: 'PDF_CACHE_CLEAR_ALL' })");
    expect(source).toContain('@click="clearPdfCaches"');
    expect(source).toContain(":title=\"i18n('clearPdfCaches')\"");
    expect(source).toContain("confirm(i18n('confirmClearPdfCaches'))");
  });
});
