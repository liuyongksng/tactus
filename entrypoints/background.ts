export default defineBackground(() => {
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
    return true;
  });

  // Set side panel behavior
  browser.sidePanel.setPanelBehavior?.({ openPanelOnActionClick: true });
});
