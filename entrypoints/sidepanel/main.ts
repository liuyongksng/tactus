import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');

// 建立与 background 的连接，用于跟踪 sidepanel 状态
const port = browser.runtime.connect({ name: 'sidepanel' });

// 监听关闭消息
port.onMessage.addListener((message) => {
  if (message.type === 'CLOSE') {
    window.close();
  }
});
