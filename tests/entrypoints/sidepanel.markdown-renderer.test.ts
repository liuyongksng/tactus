import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('sidepanel markdown renderer', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('应在模块就绪后清空 fallback 缓存并重新渲染同一段内容', async () => {
    const { createMarkdownRenderer } = await import('../../entrypoints/sidepanel/renderers/markdownRenderer');
    const onReady = vi.fn();
    const renderer = createMarkdownRenderer(onReady);

    const firstRender = renderer.render('**Hello**');
    expect(firstRender).toContain('**Hello**');
    expect(firstRender).not.toContain('<strong>');

    await vi.waitFor(() => {
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    const secondRender = renderer.render('**Hello**');
    expect(secondRender).toContain('<strong>Hello</strong>');
  });
});
