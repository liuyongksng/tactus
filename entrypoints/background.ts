// 执行脚本的核心逻辑
async function executeScriptInTab(tabId: number, code: string, args: Record<string, any>, scriptId: string): Promise<any> {
  const resultKey = `__skill_result_${scriptId}_${Date.now()}__`;
  
  const wrappedCode = `
(async () => {
  try {
    const __args__ = ${JSON.stringify(args || {})};
    const __result__ = await (async () => {
      ${code}
    })();
    window['${resultKey}'] = { success: true, data: __result__ };
  } catch (error) {
    window['${resultKey}'] = { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
})();
`;

  // 使用 script 标签注入执行，绕过 CSP
  await browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (code: string) => {
      const script = document.createElement('script');
      script.textContent = code;
      document.documentElement.appendChild(script);
      script.remove();
    },
    args: [wrappedCode],
  });

  // 轮询等待结果，最多 60 秒
  const maxWait = 60000;
  const interval = 1000;
  let waited = 0;
  
  while (waited < maxWait) {
    await new Promise(resolve => setTimeout(resolve, interval));
    waited += interval;
    
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (key: string) => {
        const result = (window as any)[key];
        if (result !== undefined && result !== null) {
          delete (window as any)[key];
          return result;
        }
        return undefined;
      },
      args: [resultKey],
    });

    // 检查是否获取到有效结果（必须是包含 success 属性的对象）
    const execResult = results?.[0]?.result;
    if (execResult && typeof execResult === 'object' && 'success' in execResult) {
      if (execResult.success) {
        return execResult.data;
      } else {
        throw new Error(execResult.error);
      }
    }
  }
  
  throw new Error('脚本执行超时');
}

export default defineBackground(() => {
  // 监听扩展安装事件
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install') {
      // 首次安装时，检测并设置语言
      const { initializeLanguage } = await import('../utils/storage');
      await initializeLanguage();
    }
  });

  // 跟踪 sidepanel 连接状态
  let sidePanelPort: any = null;

  // 监听 sidepanel 连接
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel') {
      sidePanelPort = port;
      port.onDisconnect.addListener(() => {
        sidePanelPort = null;
      });
    }
  });

  // Open side panel when extension icon is clicked
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      await browser.sidePanel.open({ tabId: tab.id });
    }
  });

  // Handle messages from content script
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OPEN_SIDEPANEL') {
      if (sender.tab?.id) {
        browser.sidePanel.open({ tabId: sender.tab.id });
      }
    }
    if (message.type === 'TOGGLE_SIDEPANEL') {
      if (sender.tab?.id) {
        if (sidePanelPort) {
          // sidepanel 已打开，发送关闭消息
          sidePanelPort.postMessage({ type: 'CLOSE' });
        } else {
          // sidepanel 未打开，打开它
          browser.sidePanel.open({ tabId: sender.tab.id });
        }
      }
    }
    if (message.type === 'SET_QUOTE') {
      // Store quote temporarily for sidepanel to pick up
      browser.storage.local.set({ pendingQuote: message.quote });
    }
    
    // 处理脚本执行请求
    if (message.type === 'EXECUTE_SKILL_SCRIPT') {
      const { tabId, code, args, scriptId } = message;
      executeScriptInTab(tabId, code, args, scriptId)
        .then(result => sendResponse({ success: true, result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // 保持消息通道开放
    }
    
    return true;
  });

  // Set side panel behavior
  browser.sidePanel.setPanelBehavior?.({ openPanelOnActionClick: true });
});
