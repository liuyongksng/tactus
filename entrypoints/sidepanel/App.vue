<script setup lang="ts">
import { ref, onMounted, nextTick, watch, computed } from 'vue';
import { marked } from 'marked';
import {
  providersStorage,
  activeProviderIdStorage,
  sharePageContentStorage,
  currentSessionIdStorage,
  getActiveProvider,
  saveProvider,
  deleteProvider,
  getAllSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  generateSessionTitle,
  type AIProvider,
  type ChatMessage,
  type ChatSession,
} from '../../utils/storage';
import { fetchModels, streamChat } from '../../utils/api';

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
const messages = ref<ChatMessage[]>([]);
const inputText = ref('');
const sharePageContent = ref(false);
const pendingQuote = ref<string | null>(null);
const isLoading = ref(false);
const showSettings = ref(false);
const showHistory = ref(false);
const chatAreaRef = ref<HTMLElement | null>(null);

// Session state
const currentSession = ref<ChatSession | null>(null);
const sessions = ref<ChatSession[]>([]);

// Settings state
const providers = ref<AIProvider[]>([]);
const activeProviderId = ref<string | null>(null);
const editingProvider = ref<AIProvider | null>(null);
const availableModels = ref<string[]>([]);
const isFetchingModels = ref(false);

// Form state
const formName = ref('');
const formBaseUrl = ref('');
const formApiKey = ref('');
const formModel = ref('');
const formCustomModel = ref('');

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
  
  // 每次打开侧边栏都是新对话状态（但不立即创建 session，等发送消息时再创建）
  currentSession.value = null;
  messages.value = [];

  // Check for pending quote from content script
  const result = await browser.storage.local.get('pendingQuote');
  if (result.pendingQuote) {
    pendingQuote.value = result.pendingQuote;
    await browser.storage.local.remove('pendingQuote');
  }

  // Listen for storage changes
  browser.storage.local.onChanged.addListener((changes) => {
    if (changes.pendingQuote?.newValue) {
      pendingQuote.value = changes.pendingQuote.newValue;
      browser.storage.local.remove('pendingQuote');
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
  // 使用 JSON 深拷贝确保 messages 是纯数据
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
    alert('请先配置 AI 服务商');
    showSettings.value = true;
    return;
  }

  // Create session if not exists
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
  inputText.value = '';
  pendingQuote.value = null;
  scrollToBottom();

  // Update session title if first message
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

    for await (const chunk of streamChat(provider, messages.value.slice(0, -1), pageContent)) {
      assistantMessage.content += chunk;
      scrollToBottom();
    }
    
    // Update assistant message timestamp after completion
    assistantMessage.timestamp = Date.now();
  } catch (error: any) {
    messages.value.push({
      role: 'assistant',
      content: `错误: ${error.message}`,
      timestamp: Date.now(),
    });
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

// Auto-resize textarea based on content (max 6 lines)
function autoResizeTextarea() {
  const textarea = textareaRef.value;
  if (!textarea) return;
  
  // Reset height to auto to get the correct scrollHeight
  textarea.style.height = 'auto';
  
  // Calculate line height (approximately 22px with current font settings)
  const lineHeight = 22;
  const maxLines = 6;
  const maxHeight = lineHeight * maxLines;
  const paddingY = 24; // 12px top + 12px bottom padding
  
  // Set height based on content, capped at max height
  const newHeight = Math.min(textarea.scrollHeight, maxHeight + paddingY);
  textarea.style.height = `${newHeight}px`;
}

// Watch input text changes to auto-resize
watch(inputText, () => {
  nextTick(autoResizeTextarea);
});

// New chat
async function newChat() {
  // 只重置状态，不立即创建 session，等发送消息时再创建
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

// Settings functions
function openSettings() {
  showSettings.value = true;
  resetForm();
}

function closeSettings() {
  showSettings.value = false;
  editingProvider.value = null;
  resetForm();
}

function resetForm() {
  formName.value = '';
  formBaseUrl.value = '';
  formApiKey.value = '';
  formModel.value = '';
  formCustomModel.value = '';
  availableModels.value = [];
}

async function fetchAvailableModels() {
  if (!formBaseUrl.value || !formApiKey.value) return;
  
  isFetchingModels.value = true;
  try {
    const models = await fetchModels(formBaseUrl.value, formApiKey.value);
    availableModels.value = models.map(m => m.id);
  } catch (e) {
    console.error('Failed to fetch models:', e);
  } finally {
    isFetchingModels.value = false;
  }
}

function editProvider(provider: AIProvider) {
  editingProvider.value = provider;
  formName.value = provider.name;
  formBaseUrl.value = provider.baseUrl;
  formApiKey.value = provider.apiKey;
  formModel.value = provider.selectedModel;
  availableModels.value = provider.models;
}

async function saveCurrentProvider() {
  const selectedModel = formModel.value || formCustomModel.value;
  if (!formName.value || !formBaseUrl.value || !formApiKey.value || !selectedModel) {
    alert('请填写所有必填字段');
    return;
  }

  const provider: AIProvider = {
    id: editingProvider.value?.id || crypto.randomUUID(),
    name: formName.value,
    baseUrl: formBaseUrl.value,
    apiKey: formApiKey.value,
    models: availableModels.value,
    selectedModel,
  };

  await saveProvider(provider);
  providers.value = await providersStorage.getValue();
  
  if (!activeProviderId.value) {
    activeProviderId.value = provider.id;
    await activeProviderIdStorage.setValue(provider.id);
  }

  editingProvider.value = null;
  resetForm();
}

async function removeProvider(id: string) {
  if (confirm('确定删除这个服务商吗？')) {
    await deleteProvider(id);
    providers.value = await providersStorage.getValue();
    if (activeProviderId.value === id) {
      activeProviderId.value = providers.value[0]?.id || null;
      await activeProviderIdStorage.setValue(activeProviderId.value);
    }
  }
}

async function setActiveProvider(id: string) {
  activeProviderId.value = id;
  await activeProviderIdStorage.setValue(id);
}

function clearChat() {
  messages.value = [];
  if (currentSession.value) {
    currentSession.value.messages = [];
    saveCurrentSession();
  }
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
        <button class="settings-btn" @click="openSettings">设置</button>
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
      <div class="input-wrapper">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          placeholder="输入您的消息..."
          rows="1"
          @keydown="handleKeydown"
        ></textarea>
        <button class="send-btn" @click="sendMessage" :disabled="isLoading || !inputText.trim()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </button>
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

    <!-- Settings Modal -->
    <div v-if="showSettings" class="modal-overlay" @click.self="closeSettings">
      <div class="modal">
        <div class="modal-header">
          <h2>{{ editingProvider ? '编辑服务商' : '设置' }}</h2>
          <button class="close-btn" @click="closeSettings">×</button>
        </div>
        <div class="modal-body">
          <!-- Provider list -->
          <div v-if="!editingProvider" class="provider-list">
            <div
              v-for="p in providers"
              :key="p.id"
              class="provider-item"
              :class="{ active: p.id === activeProviderId }"
            >
              <div class="provider-info" @click="setActiveProvider(p.id)">
                <div class="provider-name">{{ p.name }}</div>
                <div class="provider-model">{{ p.selectedModel }}</div>
              </div>
              <div class="provider-actions">
                <button class="btn btn-sm btn-secondary" @click="editProvider(p)">编辑</button>
                <button class="btn btn-sm btn-danger" @click="removeProvider(p.id)">×</button>
              </div>
            </div>
            <button class="btn btn-primary" style="width: 100%; margin-top: 8px;" @click="editingProvider = {} as any">
              添加服务商
            </button>
          </div>

          <!-- Provider form -->
          <div v-else>
            <div class="form-group">
              <label>服务商名称</label>
              <input v-model="formName" placeholder="例如：OpenAI, Claude, 本地 LLM" />
            </div>
            <div class="form-group">
              <label>Base URL</label>
              <input v-model="formBaseUrl" placeholder="https://api.openai.com" />
            </div>
            <div class="form-group">
              <label>API Key</label>
              <input v-model="formApiKey" type="password" placeholder="sk-..." />
            </div>
            <div class="form-group">
              <button
                class="btn btn-secondary btn-sm"
                @click="fetchAvailableModels"
                :disabled="isFetchingModels"
              >
                {{ isFetchingModels ? '获取中...' : '获取模型列表' }}
              </button>
            </div>
            <div class="form-group">
              <label>模型</label>
              <select v-model="formModel" v-if="availableModels.length">
                <option value="">选择模型</option>
                <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
              </select>
              <input
                v-else
                v-model="formCustomModel"
                placeholder="输入模型名称（例如：gpt-4）"
              />
            </div>
            <div style="display: flex; gap: 12px; margin-top: 24px;">
              <button class="btn btn-secondary" @click="editingProvider = null; resetForm()">
                取消
              </button>
              <button class="btn btn-primary" style="flex: 1" @click="saveCurrentProvider">
                保存
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
