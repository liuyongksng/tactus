declare global {
  const browser: typeof import('wxt/browser').browser;
  const defineBackground: typeof import('wxt/utils/define-background').defineBackground;
  const defineContentScript: typeof import('wxt/utils/define-content-script').defineContentScript;
  const createShadowRootUi: typeof import('wxt/utils/content-script-ui/shadow-root').createShadowRootUi;
}

export {};
