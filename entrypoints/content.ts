import { createApp } from 'vue';
import FloatingButton from '../components/FloatingButton.vue';
import SideFloatingBall from '../components/SideFloatingBall.vue';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    let floatingUI: any = null;
    let sideFloatingBallUI: any = null;
    let selectedText = '';

    // 创建右侧悬浮球 - 使用 overlay 定位
    sideFloatingBallUI = await createShadowRootUi(ctx, {
      name: 'side-floating-ball',
      position: 'overlay',
      anchor: 'body',
      onMount: (container) => {
        const app = createApp(SideFloatingBall, {
          onClick: () => {
            browser.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
          },
        });
        app.mount(container);
        return app;
      },
      onRemove: (app) => {
        app?.unmount();
      },
    });
    sideFloatingBallUI.mount();

    // Listen for text selection
    document.addEventListener('mouseup', async (e) => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      // Remove existing floating button
      if (floatingUI) {
        floatingUI.remove();
        floatingUI = null;
      }

      if (text && text.length > 0) {
        selectedText = text;
        
        // Create floating button near selection
        floatingUI = await createIntegratedUi(ctx, {
          position: 'inline',
          anchor: 'body',
          onMount: (container) => {
            const app = createApp(FloatingButton, {
              x: e.pageX,
              y: e.pageY,
              onAsk: () => {
                browser.runtime.sendMessage({ type: 'SET_QUOTE', quote: selectedText });
                browser.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
                if (floatingUI) {
                  floatingUI.remove();
                  floatingUI = null;
                }
              },
            });
            app.mount(container);
            return app;
          },
          onRemove: (app) => {
            app?.unmount();
          },
        });

        floatingUI.mount();
      }
    });

    // Hide floating button when clicking elsewhere
    document.addEventListener('mousedown', (e) => {
      if (floatingUI && !(e.target as Element).closest('.tc-floating-btn')) {
        floatingUI.remove();
        floatingUI = null;
      }
    });
  },
});

// Function to get page content
export function getPageContent(): string {
  const article = document.querySelector('article');
  const main = document.querySelector('main');
  const body = document.body;
  
  const target = article || main || body;
  
  // Get text content, clean up whitespace
  let text = target.innerText || target.textContent || '';
  text = text.replace(/\s+/g, ' ').trim();
  
  // Limit content length
  if (text.length > 15000) {
    text = text.substring(0, 15000) + '...';
  }
  
  return text;
}
