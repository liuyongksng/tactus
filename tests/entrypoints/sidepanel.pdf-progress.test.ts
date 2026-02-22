import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const appVuePath = resolve(currentDir, '../../entrypoints/sidepanel/App.vue');

describe('sidepanel extract_page_content PDF progress 接入', () => {
  it('应把 extractPdfContent 的 onProgress 映射到 toolStatus', () => {
    const source = readFileSync(appVuePath, 'utf8');

    expect(source).toContain('formatPdfExtractionProgressText');
    expect(source).toContain('function getExtractPageStatusText');
    expect(source).toContain('function buildPdfToolStatus');
    expect(source).toContain('onProgress: progress =>');
    expect(source).toContain('toolStatus.value = statusText');
    expect(source).toContain("toolStatus.value = getExtractPageStatusText('preparing')");
    expect(source).toContain('Extracting page content: preparing...');
  });
});
