<script setup lang="ts">
import { ref, shallowRef, triggerRef, onMounted, nextTick, watch, computed } from 'vue';
import { marked } from 'marked';
import {
  providersStorage,
  activeProviderIdStorage,
  sharePageContentStorage,
  currentSessionIdStorage,
  getActiveProvider,
  getAllSessions,
  createSession,
  updateSession,
  deleteSession,
  generateSessionTitle,
  type AIProvider,
  type ChatMessage,
  type ChatSession,
} from '../../utils/storage';
import { streamChat } from '../../utils/api';

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

// Render markdown to HTML
function renderMarkdown(content: string): string {
  if (!content) return '';
  return marked.parse(content) as string;
}

// State
const messages = shallowRef<ChatMessage[]>([]);
const inputText = ref('');
const sharePageContent = ref(false);
const pendingQuote = ref<string | null>(null);
const isLoading = ref(false);
const showHistory = ref(false);
const chatAreaRef = ref<HTMLElement | null>(null);

// Session state
const currentSession = ref<ChatSession | null>(null);
const sessions = ref<ChatSession[]>([]);

// Provider state
const providers = ref<AIProvider[]>([]);
const activeProviderId = ref<string | null>(null);
const showModelSelector = ref(false);

// Computed
const activeProvider = computed(() => {
  return providers.value.find(p => p.id === activeProviderId.value) || null;
});

const activeModelName = computed(() => {
  if (!activeProvider.value) return '未配置';
  const model = activeProvider.value.selectedModel;
  return model.length > 12 ? model.substring(0, 12) + '...' : model;
});

// 构建所有可选的模型列表（供应商+模型组合）
const allModelOptions = computed(() => {
  const options: { providerId: string; providerName: string; model: string }[] = [];
  for (const p of providers.value) {
    for (const m of p.models) {
      options.push({
        providerId: p.id,
        providerName: p.name,
        model: m,
      });
    }
  }
  return options;
});

// Format timestamp
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  if (isToday) return '今天';
  if (isYesterday) return '昨天';
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// Initialize
onMounted(async () => {
  providers.value = await providersStorage.getValue();
  activeProviderId.value = await activeProviderIdStorage.getValue();
  sharePageContent.value = await sharePageContentStorage.getValue();
  sessions.value = await getAllSessions();
  
  currentSession.value = null;
  messages.value = [];

  // Check for pending quote from content script
  const result = await browser.storage.local.get('pendingQuote');
  if (result.pendingQuote) {
    pendingQuote.value = result.pendingQuote as string;
    await browser.storage.local.remove('pendingQuote');
  }

  // Listen for storage changes
  browser.storage.local.onChanged.addListener(async (changes) => {
    if (changes.pendingQuote?.newValue) {
      pendingQuote.value = changes.pendingQuote.newValue as string;
      browser.storage.local.remove('pendingQuote');
    }
    // 监听 providers 变化，同步更新
    if (changes['local:providers']) {
      providers.value = await providersStorage.getValue();
    }
    if (changes['local:activeProviderId']) {
      activeProviderId.value = await activeProviderIdStorage.getValue();
    }
  });
});

// Watch share page content toggle
watch(sharePageContent, async (val) => {
  await sharePageContentStorage.setValue(val);
});

// Scroll to bottom
const scrollToBottom = () => {
  nextTick(() => {
    if (chatAreaRef.value) {
      chatAreaRef.value.scrollTop = chatAreaRef.value.scrollHeight;
    }
  });
};

// Get page content from active tab
async function getPageContent(): Promise<string | undefined> {
  if (!sharePageContent.value) return undefined;
  
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return undefined;

    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const article = document.querySelector('article');
        const main = document.querySelector('main');
        const body = document.body;
        const target = article || main || body;
        let text = target.innerText || target.textContent || '';
        text = text.replace(/\s+/g, ' ').trim();
        return text.length > 15000 ? text.substring(0, 15000) + '...' : text;
      },
    });

    return results[0]?.result;
  } catch (e) {
    console.error('Failed to get page content:', e);
    return undefined;
  }
}

// Save current session
async function saveCurrentSession() {
  if (!currentSession.value) return;
  const sessionToSave: ChatSession = {
    ...currentSession.value,
    messages: JSON.parse(JSON.stringify(messages.value)),
  };
  await updateSession(sessionToSave);
  sessions.value = await getAllSessions();
}

// Send message
async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isLoading.value) return;

  const provider = await getActiveProvider();
  if (!provider) {
    alert('请先在设置中配置 AI 服务商');
    openSettings();
    return;
  }

  if (!currentSession.value) {
    currentSession.value = await createSession(activeProviderId.value || undefined);
    sessions.value = await getAllSessions();
  }

  const userMessage: ChatMessage = {
    role: 'user',
    content: text,
    timestamp: Date.now(),
    quote: pendingQuote.value || undefined,
  };

  messages.value.push(userMessage);
  triggerRef(messages);
  inputText.value = '';
  pendingQuote.value = null;
  scrollToBottom();

  if (messages.value.length === 1) {
    currentSession.value.title = await generateSessionTitle(text);
  }

  isLoading.value = true;

  try {
    const pageContent = await getPageContent();
    
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    messages.value.push(assistantMessage);
    triggerRef(messages);

    for await (const chunk of streamChat(provider, messages.value.slice(0, -1), pageContent)) {
      assistantMessage.content += chunk;
      triggerRef(messages);
      scrollToBottom();
    }
    
    assistantMessage.timestamp = Date.now();
  } catch (error: any) {
    messages.value.push({
      role: 'assistant',
      content: `错误: ${error.message}`,
      timestamp: Date.now(),
    });
    triggerRef(messages);
  } finally {
    isLoading.value = false;
    scrollToBottom();
    await saveCurrentSession();
  }
}

// Handle Enter key
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// Textarea ref for auto-resize
const textareaRef = ref<HTMLTextAreaElement | null>(null);

function autoResizeTextarea() {
  const textarea = textareaRef.value;
  if (!textarea) return;
  
  textarea.style.height = 'auto';
  const lineHeight = 22;
  const maxLines = 6;
  const maxHeight = lineHeight * maxLines;
  const paddingY = 24;
  
  const newHeight = Math.min(textarea.scrollHeight, maxHeight + paddingY);
  textarea.style.height = `${newHeight}px`;
}

watch(inputText, () => {
  nextTick(autoResizeTextarea);
});

// New chat
async function newChat() {
  currentSession.value = null;
  messages.value = [];
  showHistory.value = false;
}

// Load session
async function loadSession(session: ChatSession) {
  currentSession.value = session;
  messages.value = session.messages;
  await currentSessionIdStorage.setValue(session.id);
  showHistory.value = false;
  scrollToBottom();
}

// Delete session
async function removeSession(id: string, e: Event) {
  e.stopPropagation();
  if (confirm('确定删除这个对话吗？')) {
    await deleteSession(id);
    sessions.value = await getAllSessions();
    if (currentSession.value?.id === id) {
      if (sessions.value.length > 0) {
        await loadSession(sessions.value[0]);
      } else {
        currentSession.value = null;
        messages.value = [];
      }
    }
  }
}

// Open settings page
function openSettings() {
  browser.runtime.openOptionsPage();
}

// Select provider and model
async function selectProviderModel(providerId: string, model: string) {
  // 更新 provider 的 selectedModel
  const provider = providers.value.find(p => p.id === providerId);
  if (provider && provider.selectedModel !== model) {
    provider.selectedModel = model;
    // 保存到 storage
    const allProviders = await providersStorage.getValue();
    const idx = allProviders.findIndex(p => p.id === providerId);
    if (idx >= 0) {
      allProviders[idx].selectedModel = model;
      await providersStorage.setValue(allProviders);
    }
  }
  
  // 设置为当前活跃的 provider
  activeProviderId.value = providerId;
  await activeProviderIdStorage.setValue(providerId);
  showModelSelector.value = false;
}
</script>

<template>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>TC Chrome Agent</h1>
      <div class="header-actions">
        <button class="icon-btn" @click="newChat" title="新建对话">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
        <button class="icon-btn" @click="showHistory = true" title="历史对话">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        </button>
        <button class="icon-btn" @click="openSettings" title="设置">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Options bar -->
    <div class="options-bar">
      <label class="checkbox-label">
        <input type="checkbox" v-model="sharePageContent" />
        分享当前页面内容
      </label>
    </div>

    <!-- Chat area -->
    <div class="chat-area" ref="chatAreaRef">
      <div v-if="!messages.length" class="empty-state">
        <p>欢迎使用，有什么可以帮您？</p>
        <p v-if="sharePageContent" class="empty-hint">
          页面内容将与 AI 共享
        </p>
      </div>

      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        class="message"
        :class="msg.role"
      >
        <div v-if="msg.content" class="message-time">{{ formatTime(msg.timestamp) }}</div>
        <div v-if="msg.quote" class="quote">"{{ msg.quote }}"</div>
        <div v-if="msg.role === 'assistant'" class="markdown-content" v-html="renderMarkdown(msg.content)"></div>
        <div v-else v-html="msg.content.replace(/\n/g, '<br>')"></div>
      </div>

      <div v-if="isLoading" class="loading">
        <div class="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        思考中...
      </div>
    </div>

    <!-- Input area -->
    <div class="input-area">
      <div v-if="pendingQuote" class="pending-quote">
        <div class="quote-text">"{{ pendingQuote }}"</div>
        <button class="remove-quote" @click="pendingQuote = null">×</button>
      </div>
      <div class="input-box">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          placeholder="输入您的消息..."
          rows="1"
          @keydown="handleKeydown"
        ></textarea>
        <div class="input-actions">
          <!-- Model selector -->
          <div class="model-selector-wrapper">
            <button 
              class="model-selector-btn" 
              @click="showModelSelector = !showModelSelector"
              :title="activeProvider?.selectedModel || '选择模型'"
            >
              <span class="model-name">{{ activeModelName }}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
            <!-- Model dropdown -->
            <div v-if="showModelSelector" class="model-dropdown">
              <div v-if="allModelOptions.length === 0" class="dropdown-empty">
                <span>暂无模型配置</span>
                <button class="dropdown-settings-btn" @click="openSettings">去设置</button>
              </div>
              <div v-else class="model-options-list">
                <div
                  v-for="(opt, idx) in allModelOptions"
                  :key="`${opt.providerId}-${opt.model}-${idx}`"
                  class="model-option"
                  :class="{ active: opt.providerId === activeProviderId && opt.model === activeProvider?.selectedModel }"
                  @click="selectProviderModel(opt.providerId, opt.model)"
                >
                  <span class="option-provider">{{ opt.providerName }}</span>
                  <span class="option-model">{{ opt.model }}</span>
                </div>
              </div>
            </div>
            <!-- Backdrop -->
            <div v-if="showModelSelector" class="model-backdrop" @click="showModelSelector = false"></div>
          </div>
          <!-- Send button -->
          <button class="send-btn" @click="sendMessage" :disabled="isLoading || !inputText.trim()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- History Modal -->
    <div v-if="showHistory" class="modal-overlay" @click.self="showHistory = false">
      <div class="modal">
        <div class="modal-header">
          <h2>历史对话</h2>
          <button class="close-btn" @click="showHistory = false">×</button>
        </div>
        <div class="modal-body">
          <div v-if="sessions.length === 0" class="empty-history">
            暂无历史对话
          </div>
          <div v-else class="session-list">
            <div
              v-for="session in sessions"
              :key="session.id"
              class="session-item"
              :class="{ active: session.id === currentSession?.id }"
              @click="loadSession(session)"
            >
              <div class="session-info">
                <div class="session-title">{{ session.title }}</div>
                <div class="session-meta">
                  <span>{{ session.messages?.length || 0 }} 条消息</span>
                  <span>{{ formatSessionDate(session.updatedAt) }}</span>
                </div>
              </div>
              <button class="delete-session-btn" @click="removeSession(session.id, $event)" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
