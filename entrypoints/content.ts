import { getFloatingBallEnabled, watchFloatingBallEnabled, getSelectionQuoteEnabled, watchSelectionQuoteEnabled } from '../utils/storage';

const CONTENT_SCRIPT_PERF_MARKS = {
  bootstrapStart: 'content-script-bootstrap-start',
  listenersReady: 'content-script-listeners-ready',
  floatingBallMounted: 'content-script-floating-ball-mounted',
  selectionButtonMounted: 'content-script-selection-button-mounted',
} as const;

function canUsePerformance(): boolean {
  return typeof performance !== 'undefined'
    && typeof performance.mark === 'function'
    && typeof performance.measure === 'function';
}

function markContentPerformance(markName: string): void {
  if (!canUsePerformance()) {
    return;
  }
  performance.mark(markName);
}

function measureContentPerformance(measureName: string, startMark: string, endMark: string): void {
  if (!canUsePerformance()) {
    return;
  }
  try {
    performance.measure(measureName, startMark, endMark);
  } catch {
    // 重复测量或缺少 mark 时不影响主流程，方便在真实页面里直接观察。
  }
}

type VueModule = typeof import('vue');
let cachedVueModule: VueModule | null = null;
async function loadVueModule(): Promise<VueModule> {
  if (!cachedVueModule) {
    cachedVueModule = await import('vue');
  }
  return cachedVueModule;
}

interface FloatingButtonModule {
  createApp: VueModule['createApp'];
  FloatingButton: typeof import('../components/FloatingButton.vue')['default'];
}

interface SideFloatingBallModule {
  createApp: VueModule['createApp'];
  SideFloatingBall: typeof import('../components/SideFloatingBall.vue')['default'];
}

let cachedFloatingButtonModule: FloatingButtonModule | null = null;
let cachedSideFloatingBallModule: SideFloatingBallModule | null = null;

export async function loadFloatingButtonModule(): Promise<FloatingButtonModule> {
  if (cachedFloatingButtonModule) return cachedFloatingButtonModule;
  const [vue, module] = await Promise.all([
    loadVueModule(),
    import('../components/FloatingButton.vue'),
  ]);
  cachedFloatingButtonModule = {
    createApp: vue.createApp,
    FloatingButton: module.default,
  };
  return cachedFloatingButtonModule;
}

export async function loadSideFloatingBallModule(): Promise<SideFloatingBallModule> {
  if (cachedSideFloatingBallModule) return cachedSideFloatingBallModule;
  const [vue, module] = await Promise.all([
    loadVueModule(),
    import('../components/SideFloatingBall.vue'),
  ]);
  cachedSideFloatingBallModule = {
    createApp: vue.createApp,
    SideFloatingBall: module.default,
  };
  return cachedSideFloatingBallModule;
}

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
    markContentPerformance(CONTENT_SCRIPT_PERF_MARKS.bootstrapStart);
    let floatingUI: any = null;
    let sideFloatingBallUI: any = null;
    let selectedText = '';
    let floatingBallEnabled = true;
    let selectionQuoteEnabled = true;
    const canOpenSidebarFromContent = !import.meta.env.FIREFOX;
    
    // 预先获取图标 URL
    const iconUrl = browser.runtime.getURL('/icon/32.png');

    // 获取设置
    floatingBallEnabled = await getFloatingBallEnabled();
    selectionQuoteEnabled = await getSelectionQuoteEnabled();

    // 创建右侧悬浮球
    const createSideFloatingBall = async () => {
      if (sideFloatingBallUI) return;
      const { createApp, SideFloatingBall } = await loadSideFloatingBallModule();
      
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
      markContentPerformance(CONTENT_SCRIPT_PERF_MARKS.floatingBallMounted);
      measureContentPerformance(
        'content-script-bootstrap-to-floating-ball',
        CONTENT_SCRIPT_PERF_MARKS.bootstrapStart,
        CONTENT_SCRIPT_PERF_MARKS.floatingBallMounted,
      );
    };

    // 移除悬浮球
    const removeSideFloatingBall = () => {
      if (sideFloatingBallUI) {
        sideFloatingBallUI.remove();
        sideFloatingBallUI = null;
      }
    };

    // 根据设置显示/隐藏悬浮球（Firefox 不支持从内容脚本触发侧边栏，禁用悬浮球）
    if (floatingBallEnabled && canOpenSidebarFromContent) {
      await createSideFloatingBall();
    }

    // 监听设置变化
    if (canOpenSidebarFromContent) {
      watchFloatingBallEnabled(async (enabled) => {
        floatingBallEnabled = enabled;
        if (enabled) {
          await createSideFloatingBall();
        } else {
          removeSideFloatingBall();
        }
      });
    }

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
      if (!selectionQuoteEnabled || !canOpenSidebarFromContent) return;

      if (text && text.length > 0) {
        selectedText = text;
        
        // 获取选区末尾位置
        const position = getSelectionEndPosition();
        if (!position) return;
        
        // 使用 overlay 定位创建浮动按钮，更可靠
        const { createApp, FloatingButton } = await loadFloatingButtonModule();
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
        markContentPerformance(CONTENT_SCRIPT_PERF_MARKS.selectionButtonMounted);
        measureContentPerformance(
          'content-script-bootstrap-to-selection-button',
          CONTENT_SCRIPT_PERF_MARKS.bootstrapStart,
          CONTENT_SCRIPT_PERF_MARKS.selectionButtonMounted,
        );
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

    markContentPerformance(CONTENT_SCRIPT_PERF_MARKS.listenersReady);
    measureContentPerformance(
      'content-script-bootstrap-to-listeners',
      CONTENT_SCRIPT_PERF_MARKS.bootstrapStart,
      CONTENT_SCRIPT_PERF_MARKS.listenersReady,
    );
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
