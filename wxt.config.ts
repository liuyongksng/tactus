import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'TC Chrome Agent',
    description: 'AI Assistant with OpenAI-compatible API support',
    version: '1.0.0',
    minimum_chrome_version: '120',
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'sidePanel', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'TC Chrome Agent',
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
