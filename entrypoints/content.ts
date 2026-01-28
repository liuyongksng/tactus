import { createApp } from 'vue';
import FloatingButton from '../components/FloatingButton.vue';
import SideFloatingBall from '../components/SideFloatingBall.vue';
import { getFloatingBallEnabled, watchFloatingBallEnabled, getSelectionQuoteEnabled, watchSelectionQuoteEnabled } from '../utils/storage';

// 获取选区末尾的精确位置（视口坐标，用于 fixed 定位）
function getSelectionEndPosition(): { x: number; y: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  
  // 创建一个折叠到末尾的 range 来获取光标位置
  const endRange = range.cloneRange();
  endRange.collapse(false); // false = 折叠到末尾
  
  const rects = endRange.getClientRects();
  if (rects.length > 0) {
    const lastRect = rects[rects.length - 1];
    return {
      x: lastRect.right,  // 视口坐标，不加 scrollX
      y: lastRect.bottom, // 视口坐标，不加 scrollY
    };
  }
  
  // 备用方案：使用整个选区的边界
  const boundingRect = range.getBoundingClientRect();
  if (boundingRect.width > 0 || boundingRect.height > 0) {
    return {
      x: boundingRect.right,
      y: boundingRect.bottom,
    };
  }
  
  return null;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    let floatingUI: any = null;
    let sideFloatingBallUI: any = null;
    let selectedText = '';
    let floatingBallEnabled = true;
    let selectionQuoteEnabled = true;
    
    // 预先获取图标 URL
    const iconUrl = browser.runtime.getURL('/icon/32.png');

    // 获取设置
    floatingBallEnabled = await getFloatingBallEnabled();
    selectionQuoteEnabled = await getSelectionQuoteEnabled();

    // 创建右侧悬浮球
    const createSideFloatingBall = async () => {
      if (sideFloatingBallUI) return;
      
      sideFloatingBallUI = await createShadowRootUi(ctx, {
        name: 'side-floating-ball',
        position: 'overlay',
        anchor: 'body',
        onMount: (container) => {
          const app = createApp(SideFloatingBall, {
            iconUrl: iconUrl,
            onClick: () => {
              browser.runtime.sendMessage({ type: 'TOGGLE_SIDEPANEL' });
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
    };

    // 移除悬浮球
    const removeSideFloatingBall = () => {
      if (sideFloatingBallUI) {
        sideFloatingBallUI.remove();
        sideFloatingBallUI = null;
      }
    };

    // 根据设置显示/隐藏悬浮球
    if (floatingBallEnabled) {
      await createSideFloatingBall();
    }

    // 监听设置变化
    watchFloatingBallEnabled(async (enabled) => {
      floatingBallEnabled = enabled;
      if (enabled) {
        await createSideFloatingBall();
      } else {
        removeSideFloatingBall();
      }
    });

    // 监听划词引用设置变化
    watchSelectionQuoteEnabled((enabled) => {
      selectionQuoteEnabled = enabled;
      // 如果禁用，移除当前显示的浮动按钮
      if (!enabled && floatingUI) {
        floatingUI.remove();
        floatingUI = null;
      }
    });

    // Listen for text selection
    document.addEventListener('mouseup', async (e) => {
      // 延迟一点确保选区已经完成
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      // Remove existing floating button
      if (floatingUI) {
        floatingUI.remove();
        floatingUI = null;
      }

      // 如果划词引用功能被禁用，直接返回
      if (!selectionQuoteEnabled) return;

      if (text && text.length > 0) {
        selectedText = text;
        
        // 获取选区末尾位置
        const position = getSelectionEndPosition();
        if (!position) return;
        
        // 使用 overlay 定位创建浮动按钮，更可靠
        floatingUI = await createShadowRootUi(ctx, {
          name: 'tc-floating-button',
          position: 'overlay',
          anchor: 'body',
          onMount: (container) => {
            const removeFloating = () => {
              if (floatingUI) {
                floatingUI.remove();
                floatingUI = null;
              }
            };
            
            const app = createApp(FloatingButton, {
              x: position.x,
              y: position.y,
              iconUrl: iconUrl,
              onAsk: () => {
                // 先移除悬浮按钮
                removeFloating();
                // 再发送消息
                browser.runtime.sendMessage({ type: 'SET_QUOTE', quote: selectedText });
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

        floatingUI.mount();
      }
    });

    // Hide floating button when clicking elsewhere
    document.addEventListener('mousedown', (e) => {
      // 检查点击是否在 shadow root 内的按钮上
      const target = e.target as Element;
      const isFloatingButton = target.closest('tc-floating-button') || 
                               target.shadowRoot?.querySelector('.tc-floating-btn');
      
      if (floatingUI && !isFloatingButton) {
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
