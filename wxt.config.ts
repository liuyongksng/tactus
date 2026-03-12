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
  vite: ({ browser }) => ({
    build: {
      // 这两个目标版本都已满足项目当前能力，避免为过旧环境注入额外兼容代码。
      target: browser === 'firefox' ? 'firefox120' : 'chrome120',
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
    'build:manifestGenerated'(_wxt, manifest) {
      if (manifest.sidebar_action) {
        manifest.sidebar_action.default_icon = {
          16: 'icon/16.png',
          32: 'icon/32.png',
          48: 'icon/48.png',
          128: 'icon/128.png',
        };
      }
    },
  },
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';
    const firefoxExtensionId = process.env.FIREFOX_EXTENSION_ID || 'tactus@local.dev';

    return {
      name: 'Tactus',
      description: 'The first browser AI Agent extension with Agent Skills, multi-provider AI, and MCP support',
      version: '1.3.0',
      ...(isFirefox ? {} : { minimum_chrome_version: '120' }),
      permissions: [
        'storage',
        'unlimitedStorage',
        'activeTab',
        'scripting',
        'identity',
        ...(isFirefox ? [] : ['sidePanel']),
      ],
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
      ...(isFirefox
        ? {}
        : {
            side_panel: {
              default_path: 'sidepanel.html',
            },
          }),
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
      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: firefoxExtensionId,
              },
            },
          }
        : {}),
    };
  },
});
