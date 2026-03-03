import { defineConfig } from 'wxt';

const PAGE_ENTRYPOINT_TYPES = new Set([
  'popup',
  'options',
  'sidepanel',
  'sandbox',
  'bookmarks',
  'history',
  'newtab',
  'devtools',
  'unlisted-page',
]);

const vendorManualChunks = (id: string): string | undefined => {
  const normalizedId = id.replace(/\\/g, '/');
  if (!normalizedId.includes('/node_modules/')) {
    return undefined;
  }

  if (normalizedId.includes('/@wxt-dev/storage/')
    || normalizedId.includes('/@wxt-dev/browser/')
    || normalizedId.includes('/async-mutex/')
    || normalizedId.includes('/dequal/')) {
    return 'vendor-wxt-storage';
  }
  if (normalizedId.includes('/@modelcontextprotocol/sdk/')) {
    return 'vendor-mcp-sdk';
  }
  if (normalizedId.includes('/openai/')) {
    return 'vendor-openai';
  }
  if (normalizedId.includes('/pdfjs-dist/')) {
    return 'vendor-pdfjs';
  }
  if (normalizedId.includes('/marked/')
    || normalizedId.includes('/marked-katex-extension/')
    || normalizedId.includes('/katex/')) {
    return 'vendor-markdown';
  }
  if (normalizedId.includes('/@mozilla/readability/')
    || normalizedId.includes('/turndown/')) {
    return 'vendor-extractor';
  }
  return undefined;
};

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  imports: false,
  vite: () => ({
    build: {
      // Manifest 已约束最低 Chrome 版本，避免为旧环境注入额外兼容代码。
      target: 'chrome120',
    },
  }),
  hooks: {
    'vite:build:extendConfig'(entrypoints, viteConfig) {
      const hasLibBuild = Boolean(viteConfig.build && 'lib' in viteConfig.build && viteConfig.build.lib);
      if (hasLibBuild) {
        return;
      }

      const isPageGroup = entrypoints.length > 0
        && entrypoints.every((entrypoint) => PAGE_ENTRYPOINT_TYPES.has(entrypoint.type));
      if (!isPageGroup) {
        return;
      }

      viteConfig.build ??= {};
      viteConfig.build.rollupOptions ??= {};
      const { output } = viteConfig.build.rollupOptions;

      if (Array.isArray(output)) {
        output.forEach((config) => {
          if (!config.manualChunks) {
            config.manualChunks = vendorManualChunks;
          }
        });
        return;
      }

      viteConfig.build.rollupOptions.output = {
        ...(output ?? {}),
        manualChunks: output?.manualChunks ?? vendorManualChunks,
      };
    },
  },
  manifest: {
    name: 'Tactus',
    description: 'AI Assistant with OpenAI-compatible API support',
    version: '1.2.0',
    minimum_chrome_version: '120',
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'sidePanel', 'scripting', 'identity'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Tactus',
      default_icon: {
        16: '/icon/16.png',
        32: '/icon/32.png',
        48: '/icon/48.png',
        128: '/icon/128.png',
      },
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    web_accessible_resources: [
      {
        resources: ['/icon/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
