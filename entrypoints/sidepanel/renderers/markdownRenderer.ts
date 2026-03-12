let rendererPromise: Promise<typeof import('../../../utils/markdownMath')> | null = null;
let rendererModule: typeof import('../../../utils/markdownMath') | null = null;

function escapeHtml(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fallbackRender(content: string): string {
  if (!content) {
    return '';
  }
  return escapeHtml(content).replace(/\n/g, '<br>');
}

async function loadRendererModule(): Promise<typeof import('../../../utils/markdownMath')> {
  if (!rendererPromise) {
    rendererPromise = import('../../../utils/markdownMath')
      .then((module) => {
        rendererModule = module;
        return module;
      })
      .catch((error) => {
        rendererPromise = null;
        throw error;
      });
  }

  return rendererPromise;
}

export function createMarkdownRenderer(onReady?: () => void) {
  const htmlCache = new Map<string, string>();

  const startLoading = () => {
    void loadRendererModule()
      .then(() => {
        htmlCache.clear();
        onReady?.();
      })
      .catch((error) => {
        console.error('[markdownRenderer] 延迟加载失败:', error);
      });
  };

  return {
    render(content: string): string {
      if (!content) {
        return '';
      }

      const cached = htmlCache.get(content);
      if (cached) {
        return cached;
      }

      if (rendererModule) {
        const rendered = rendererModule.renderMarkdownWithMath(content);
        htmlCache.set(content, rendered);
        return rendered;
      }

      startLoading();
      return fallbackRender(content);
    },
    preload(): void {
      startLoading();
    },
    resetCache(): void {
      htmlCache.clear();
    },
  };
}
