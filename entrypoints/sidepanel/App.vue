<script setup lang="ts">
import { ref, shallowRef, triggerRef, onMounted, onUnmounted, nextTick, watch, computed } from 'vue';
import { marked } from 'marked';
import {
  getAllProviders,
  saveProvider as saveProviderToDB,
  getActiveProvider,
  setActiveProviderId,
  watchProviders,
  watchActiveProviderId,
  type AIProvider,
} from '../../utils/storage';
import {
  getSharePageContent,
  setSharePageContent,
  setCurrentSessionId,
  getAllSessions,
  getSessionsPaginated,
  createSession,
  updateSession,
  deleteSession,
  generateSessionTitle,
  type ChatMessage,
  type ChatSession,
} from '../../utils/db';
import { streamChat, getLastApiMessages, setLastApiMessages, type ToolExecutor, type ApiMessage } from '../../utils/api';
import { extractPageContent, truncateContent } from '../../utils/pageExtractor';
import { getToolStatusText, type ToolCall, type ToolResult, type SkillInfo } from '../../utils/tools';
import { getAllSkills, getSkillByName, getSkillFileAsText, type Skill } from '../../utils/skills';
import { executeScript, setScriptConfirmCallback, type ScriptConfirmationRequest } from '../../utils/skillsExecutor';

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
const toolStatus = ref<string | null>(null); // 工具执行状态提示

// Session state
const currentSession = ref<ChatSession | null>(null);
const sessions = ref<ChatSession[]>([]);
const sessionsHasMore = ref(true);
const sessionsLoading = ref(false);
const sessionsOffset = ref(0);
const SESSIONS_PAGE_SIZE = 15;

// Provider state
const providers = ref<AIProvider[]>([]);
const activeProviderId = ref<string | null>(null);
const showModelSelector = ref(false);

// Debug state
const showDebugModal = ref(false);
const debugApiMessages = ref<ApiMessage[]>([]);

// 思维链折叠状态（按消息索引存储）
const reasoningExpanded = ref<Record<number, boolean>>({});

// 切换思维链展开/折叠
function toggleReasoning(idx: number) {
  reasoningExpanded.value[idx] = !reasoningExpanded.value[idx];
}// Skills state
const installedSkills = ref<Skill[]>([]);
const showScriptConfirmModal = ref(false);
const pendingScriptConfirm = ref<{
  request: ScriptConfirmationRequest;
  resolve: (result: { confirmed: boolean; trustForever: boolean }) => void;
} | null>(null);

// Computed
const activeProvider = computed(() => {
  return providers.value.find(p => p.id === activeProviderId.value) || null;
});

const activeModelName = computed(() => {
  if (!activeProvider.value) return '未配置';
  const model = activeProvider.value.selectedModel;
  // return model.length > 12 ? model.substring(0, 12) + '...' : model;
  return model;
});

// 构建所有可选的模型列表（供应商+模型组合）
const allModelOptions = computed(() => {
  const options: { providerId: string; providerName: string; model: string }[] = [];
  for (const p of providers.value) {
    const models = Array.isArray(p.models) ? p.models : [];
    for (const m of models) {
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
  return date.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Initialize
const unwatchProviders = ref<(() => void) | null>(null);
const unwatchActiveProviderId = ref<(() => void) | null>(null);

onMounted(async () => {
  providers.value = await getAllProviders();
  const activeProvider = await getActiveProvider();
  activeProviderId.value = activeProvider?.id || null;
  sharePageContent.value = await getSharePageContent();
  
  // 加载已安装的 Skills
  installedSkills.value = await getAllSkills();
  
  // 设置脚本确认回调
  setScriptConfirmCallback(async (request) => {
    return new Promise((resolve) => {
      pendingScriptConfirm.value = { request, resolve };
      showScriptConfirmModal.value = true;
    });
  });
  
  currentSession.value = null;
  messages.value = [];

  // 监听 providers 变化（跨页面同步）
  unwatchProviders.value = watchProviders((newProviders) => {
    providers.value = newProviders;
  });
  
  // 监听 activeProviderId 变化（跨页面同步）
  unwatchActiveProviderId.value = watchActiveProviderId((newId) => {
    activeProviderId.value = newId;
  });

  // 监听 skills 变更消息
  browser.runtime.onMessage.addListener(handleSkillsChanged);

  // Check for pending quote from content script
  const result = await browser.storage.local.get('pendingQuote');
  if (result.pendingQuote) {
    pendingQuote.value = result.pendingQuote as string;
    await browser.storage.local.remove('pendingQuote');
  }

  // Listen for storage changes (for pendingQuote only)
  browser.storage.local.onChanged.addListener(async (changes) => {
    if (changes.pendingQuote?.newValue) {
      pendingQuote.value = changes.pendingQuote.newValue as string;
      browser.storage.local.remove('pendingQuote');
    }
  });
});

// Skills 变更消息处理
function handleSkillsChanged(message: any) {
  if (message?.type === 'SKILLS_CHANGED') {
    getAllSkills().then(skills => {
      installedSkills.value = skills;
    });
  }
}

// 清理 watchers
onUnmounted(() => {
  unwatchProviders.value?.();
  unwatchActiveProviderId.value?.();
  // 移除 skills 变更监听
  browser.runtime.onMessage.removeListener(handleSkillsChanged);
  // 清理调试面板刷新定时器
  if (debugRefreshTimer) {
    clearInterval(debugRefreshTimer);
    debugRefreshTimer = null;
  }
});

// Watch share page content toggle
watch(sharePageContent, async (val) => {
  await setSharePageContent(val);
});

// Scroll to bottom
const scrollToBottom = () => {
  nextTick(() => {
    if (chatAreaRef.value) {
      chatAreaRef.value.scrollTop = chatAreaRef.value.scrollHeight;
    }
  });
};

// 使用 Readability + Turndown 提取清洗后的页面内容
async function extractCleanPageContent(): Promise<string> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url) {
      return '无法获取当前页面信息';
    }

    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 返回完整的 HTML 和 URL
        return {
          html: document.documentElement.outerHTML,
          url: window.location.href,
          title: document.title,
        };
      },
    });

    const pageData = results[0]?.result;
    if (!pageData) {
      return '无法获取页面内容';
    }

    // 在这里解析 HTML（sidepanel 环境中）
    const parser = new DOMParser();
    const doc = parser.parseFromString(pageData.html, 'text/html');
    
    const extracted = extractPageContent(doc, pageData.url);
    const content = truncateContent(extracted.content);
    
    // 始终包含元数据
    const metadata = [
      `# ${extracted.title}`,
      extracted.byline ? `作者: ${extracted.byline}` : '',
      extracted.siteName ? `来源: ${extracted.siteName}` : '',
      `URL: ${extracted.url}`,
      '',
      '---',
      '',
      content,
    ].filter(Boolean).join('\n');
    return metadata;
  } catch (e) {
    console.error('Failed to extract page content:', e);
    return `提取页面内容失败: ${e instanceof Error ? e.message : '未知错误'}`;
  }
}

// 工具执行器
const toolExecutor: ToolExecutor = async (toolCall: ToolCall): Promise<ToolResult> => {
  switch (toolCall.name) {
    case 'extract_page_content': {
      const content = await extractCleanPageContent();
      // 检查是否是错误消息
      const isError = content.startsWith('无法获取') || content.startsWith('提取页面内容失败');
      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        result: content,
        success: !isError,
      };
    }
    case 'activate_skill': {
      const skillName = toolCall.arguments.skill_name;
      const skill = await getSkillByName(skillName);
      if (!skill) {
        return {
          tool_call_id: toolCall.id,
          name: toolCall.name,
          result: `未找到名为 "${skillName}" 的 Skill`,
          success: false,
        };
      }
      // 返回 Skill 的完整指令
      const skillInfo = `# Skill: ${skill.metadata.name}

## 描述
${skill.metadata.description}

## 指令
${skill.instructions}

## 可用脚本
${skill.scripts.length > 0 
  ? skill.scripts.map(s => `- ${s.path}`).join('\n')
  : '无可用脚本'}

## 引用文件
${skill.references.length > 0 
  ? skill.references.map(r => `- ${r.path}`).join('\n')
  : '无引用文件'}`;
      
      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        result: skillInfo,
        success: true,
      };
    }
    case 'execute_skill_script': {
      const skillName = toolCall.arguments.skill_name;
      const scriptPath = toolCall.arguments.script_path;
      const scriptArgs = toolCall.arguments.arguments || {};
      
      const skill = await getSkillByName(skillName);
      if (!skill) {
        return {
          tool_call_id: toolCall.id,
          name: toolCall.name,
          result: `未找到名为 "${skillName}" 的 Skill`,
          success: false,
        };
      }
      
      const script = skill.scripts.find(s => s.path === scriptPath);
      if (!script) {
        return {
          tool_call_id: toolCall.id,
          name: toolCall.name,
          result: `Skill "${skillName}" 中未找到脚本 "${scriptPath}"`,
          success: false,
        };
      }
      
      const execResult = await executeScript({ skill, script, arguments: scriptArgs });
      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        result: execResult.success 
          ? JSON.stringify(execResult.output, null, 2)
          : `脚本执行失败: ${execResult.error}`,
        success: execResult.success,
      };
    }
    case 'read_skill_file': {
      const skillName = toolCall.arguments.skill_name;
      const filePath = toolCall.arguments.file_path;
      
      const skill = await getSkillByName(skillName);
      if (!skill) {
        return {
          tool_call_id: toolCall.id,
          name: toolCall.name,
          result: `未找到名为 "${skillName}" 的 Skill`,
          success: false,
        };
      }
      
      const content = await getSkillFileAsText(skill.id, filePath);
      if (content === null) {
        return {
          tool_call_id: toolCall.id,
          name: toolCall.name,
          result: `文件 "${filePath}" 不存在或不是文本文件`,
          success: false,
        };
      }
      
      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        result: content,
        success: true,
      };
    }
    default:
      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        result: `未知工具: ${toolCall.name}`,
        success: false,
      };
  }
};

// Save current session
async function saveCurrentSession() {
  if (!currentSession.value) return;
  const sessionToSave: ChatSession = {
    ...currentSession.value,
    messages: JSON.parse(JSON.stringify(messages.value)),
    apiMessages: JSON.parse(JSON.stringify(getLastApiMessages())), // 持久化 API 上下文
  };
  await updateSession(sessionToSave);
  // 刷新当前已加载的会话列表
  await loadInitialSessions();
}

// 加载初始会话列表
async function loadInitialSessions() {
  sessionsOffset.value = 0;
  const result = await getSessionsPaginated(SESSIONS_PAGE_SIZE, 0);
  sessions.value = result.sessions;
  sessionsHasMore.value = result.hasMore;
  sessionsOffset.value = result.sessions.length;
}

// 加载更多会话
async function loadMoreSessions() {
  if (sessionsLoading.value || !sessionsHasMore.value) return;
  
  sessionsLoading.value = true;
  try {
    const result = await getSessionsPaginated(SESSIONS_PAGE_SIZE, sessionsOffset.value);
    sessions.value = [...sessions.value, ...result.sessions];
    sessionsHasMore.value = result.hasMore;
    sessionsOffset.value += result.sessions.length;
  } finally {
    sessionsLoading.value = false;
  }
}

// 历史列表滚动处理
const sessionListRef = ref<HTMLElement | null>(null);

function handleSessionListScroll(e: Event) {
  const el = e.target as HTMLElement;
  const threshold = 50;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
    loadMoreSessions();
  }
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
    await loadInitialSessions();
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
  toolStatus.value = null;

  try {
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    messages.value.push(assistantMessage);
    triggerRef(messages);

    // 使用 ReAct 范式的流式聊天
    const reactConfig = {
      enableTools: true, // 默认启用工具
      toolExecutor,
      maxIterations: 10,
    };

    // 构建 Skills 信息
    const skillsInfo: SkillInfo[] = installedSkills.value.map(s => ({
      name: s.metadata.name,
      description: s.metadata.description,
    }));

    // 获取当前页面信息
    let pageInfo: { domain: string; title: string; url: string } | undefined;
    if (sharePageContent.value) {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && tab?.title) {
          const urlObj = new URL(tab.url);
          pageInfo = {
            domain: urlObj.hostname,
            title: tab.title,
            url: tab.url,
          };
        }
      } catch (e) {
        console.error('Failed to get page info:', e);
      }
    }

    for await (const event of streamChat(
      provider, 
      messages.value.slice(0, -1), 
      { sharePageContent: sharePageContent.value, skills: skillsInfo, pageInfo }, 
      reactConfig
    )) {
      switch (event.type) {
        case 'reasoning':
          // 思维链内容（如 DeepSeek reasoning_content）
          if (!assistantMessage.reasoning) {
            assistantMessage.reasoning = '';
          }
          assistantMessage.reasoning += event.content;
          triggerRef(messages);
          break;
        case 'content':
          isLoading.value = false; // 收到内容后关闭 loading 状态
          assistantMessage.content += event.content;
          triggerRef(messages);
          // 不自动滚动，让用户自行控制查看位置
          break;
        case 'tool_call':
          isLoading.value = true; // 工具调用时显示 loading
          toolStatus.value = getToolStatusText(event.toolCall.name, event.toolCall.arguments);
          break;
        case 'thinking':
          toolStatus.value = event.message;
          break;
        case 'tool_result':
          // 工具执行完成，清除状态
          toolStatus.value = null;
          if (assistantMessage.content && !assistantMessage.content.endsWith('\n')) {
            assistantMessage.content += '\n';
          }
          triggerRef(messages);
          break;
        case 'done':
          toolStatus.value = null;
          // 清理末尾空白
          assistantMessage.content = assistantMessage.content.trim();
          if (assistantMessage.reasoning) {
            assistantMessage.reasoning = assistantMessage.reasoning.trim();
          }
          break;
      }
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
    toolStatus.value = null;
    // 不自动滚动，让用户自行控制查看位置
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
  setLastApiMessages([]); // 清空 API 上下文
  showHistory.value = false;
}

// Open history modal
async function openHistory() {
  await loadInitialSessions();
  showHistory.value = true;
}

// Load session
async function loadSession(session: ChatSession) {
  currentSession.value = session;
  messages.value = session.messages;
  // 恢复 API 上下文
  if (session.apiMessages) {
    setLastApiMessages(session.apiMessages);
  } else {
    setLastApiMessages([]);
  }
  await setCurrentSessionId(session.id);
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
  // 从 storage 重新获取最新的 provider 数据，避免使用可能不完整的内存数据
  const { getProvider } = await import('../../utils/storage');
  const freshProvider = await getProvider(providerId);
  
  if (!freshProvider) {
    console.error('Provider not found in storage:', providerId);
    return;
  }
  
  // 验证 provider 数据完整性
  if (!Array.isArray(freshProvider.models) || freshProvider.models.length === 0) {
    console.error('Provider data corrupted, skipping save:', freshProvider);
    return;
  }
  
  // 验证要选择的模型确实存在于 provider 的模型列表中
  if (!freshProvider.models.includes(model)) {
    console.error('Model not found in provider:', model, freshProvider.models);
    return;
  }
  
  // 只有当模型确实改变时才保存
  if (freshProvider.selectedModel !== model) {
    freshProvider.selectedModel = model;
    await saveProviderToDB(freshProvider);
    // 更新本地状态
    const localProvider = providers.value.find((p: AIProvider) => p.id === providerId);
    if (localProvider) {
      localProvider.selectedModel = model;
    }
  }
  
  // 设置为当前活跃的 provider
  activeProviderId.value = providerId;
  await setActiveProviderId(providerId);
  showModelSelector.value = false;
}

// 调试面板实时刷新定时器
let debugRefreshTimer: ReturnType<typeof setInterval> | null = null;

// 查看调试信息
function viewDebugMessages() {
  // 优先从当前会话获取持久化的 API 上下文，否则从内存获取
  if (currentSession.value?.apiMessages?.length) {
    debugApiMessages.value = currentSession.value.apiMessages;
  } else {
    debugApiMessages.value = getLastApiMessages();
  }
  showDebugModal.value = true;
  
  // 启动实时刷新（每 500ms 更新一次）
  if (debugRefreshTimer) {
    clearInterval(debugRefreshTimer);
  }
  debugRefreshTimer = setInterval(() => {
    // 只在加载中时实时刷新，避免不必要的更新
    if (isLoading.value) {
      debugApiMessages.value = getLastApiMessages();
    }
  }, 500);
}

// 关闭调试面板时停止刷新
function closeDebugModal() {
  showDebugModal.value = false;
  if (debugRefreshTimer) {
    clearInterval(debugRefreshTimer);
    debugRefreshTimer = null;
  }
}

// 复制调试信息到剪贴板
function copyDebugMessages() {
  const text = JSON.stringify(debugApiMessages.value, null, 2);
  navigator.clipboard.writeText(text);
}

// 格式化 tool_calls 显示
function formatToolCalls(toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }>): string {
  return toolCalls.map(tc => {
    let args = tc.function.arguments;
    try {
      args = JSON.stringify(JSON.parse(args), null, 2);
    } catch {}
    return `${tc.function.name}(${args})`;
  }).join('\n');
}

// 脚本确认处理
function confirmScript(trustForever: boolean) {
  if (pendingScriptConfirm.value) {
    pendingScriptConfirm.value.resolve({ confirmed: true, trustForever });
    pendingScriptConfirm.value = null;
    showScriptConfirmModal.value = false;
  }
}

function rejectScript() {
  if (pendingScriptConfirm.value) {
    pendingScriptConfirm.value.resolve({ confirmed: false, trustForever: false });
    pendingScriptConfirm.value = null;
    showScriptConfirmModal.value = false;
  }
}
</script>

<template>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>TC Chrome Agent</h1>
      <div class="header-actions">
        <button class="icon-btn" @click="viewDebugMessages" title="查看 API 上下文">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
          </svg>
        </button>
        <button class="icon-btn" @click="newChat" title="新建对话">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
        <button class="icon-btn" @click="openHistory" title="历史对话">
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

      <template v-for="(msg, idx) in messages" :key="idx">
        <!-- 在最后一条 assistant 消息上方显示 loading 状态 -->
        <div 
          v-if="isLoading && msg.role === 'assistant' && idx === messages.length - 1" 
          class="loading"
        >
          <div class="loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span v-if="toolStatus">{{ toolStatus }}</span>
          <span v-else>思考中...</span>
        </div>

        <div class="message" :class="msg.role">
          <div v-if="msg.content || msg.reasoning" class="message-time">{{ formatTime(msg.timestamp) }}</div>
          <div v-if="msg.quote" class="quote">"{{ msg.quote }}"</div>
          
          <!-- 思维链折叠区域 -->
          <div v-if="msg.reasoning" class="reasoning-section">
            <button 
              class="reasoning-toggle"
              @click="toggleReasoning(idx)"
              :class="{ expanded: reasoningExpanded[idx] }"
            >
              <svg class="reasoning-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
              </svg>
              <span class="reasoning-label">思维链</span>
              <svg class="reasoning-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
            <div v-if="reasoningExpanded[idx]" class="reasoning-content">
              <div class="reasoning-text" v-html="renderMarkdown(msg.reasoning)"></div>
            </div>
          </div>
          
          <div v-if="msg.role === 'assistant'" class="markdown-content" v-html="renderMarkdown(msg.content)"></div>
          <div v-else v-html="msg.content.replace(/\n/g, '<br>')"></div>
        </div>
      </template>

      <!-- 当没有 assistant 消息时（刚发送用户消息），显示 loading -->
      <div 
        v-if="isLoading && (messages.length === 0 || messages[messages.length - 1].role !== 'assistant')" 
        class="loading"
      >
        <div class="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span v-if="toolStatus">{{ toolStatus }}</span>
        <span v-else>思考中...</span>
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
          <div v-else class="session-list" ref="sessionListRef" @scroll="handleSessionListScroll">
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
            <!-- 加载更多提示 -->
            <div v-if="sessionsLoading" class="session-loading">
              <span>加载中...</span>
            </div>
            <div v-else-if="!sessionsHasMore && sessions.length > 0" class="session-end">
              <span>没有更多了</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Debug Modal -->
    <div v-if="showDebugModal" class="modal-overlay" @click.self="closeDebugModal">
      <div class="modal debug-modal">
        <div class="modal-header">
          <h2>API 上下文调试</h2>
          <div class="debug-header-actions">
            <button class="copy-btn" @click="copyDebugMessages" title="复制 JSON">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
              复制
            </button>
            <button class="close-btn" @click="closeDebugModal">×</button>
          </div>
        </div>
        <div class="modal-body debug-body">
          <div v-if="debugApiMessages.length === 0" class="empty-history">
            暂无 API 消息记录，请先发送一条消息
          </div>
          <div v-else class="debug-messages">
            <div 
              v-for="(msg, idx) in debugApiMessages" 
              :key="idx" 
              class="debug-message"
              :class="msg.role"
            >
              <div class="debug-role">
                <template v-if="msg.role === 'tool'">
                  🔧 tool{{ msg.name ? ` (${msg.name})` : '' }}
                </template>
                <template v-else-if="msg.role === 'assistant' && msg.tool_calls?.length">
                  assistant → 调用工具
                </template>
                <template v-else>{{ msg.role }}</template>
              </div>
              <!-- 思维链内容 -->
              <div v-if="msg.reasoning" class="debug-reasoning">
                <div class="debug-reasoning-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                  </svg>
                  思维链
                </div>
                <pre class="debug-content debug-reasoning-content">{{ msg.reasoning }}</pre>
              </div>
              <pre v-if="msg.content" class="debug-content">{{ msg.content }}</pre>
              <pre v-if="msg.tool_calls?.length" class="debug-content debug-tool-calls">{{ formatToolCalls(msg.tool_calls) }}</pre>
              <div v-if="!msg.content && !msg.tool_calls?.length && !msg.reasoning" class="debug-empty">(空)</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Script Confirm Modal -->
    <div v-if="showScriptConfirmModal && pendingScriptConfirm" class="modal-overlay">
      <div class="modal script-confirm-modal">
        <div class="modal-header">
          <h2>脚本执行确认</h2>
        </div>
        <div class="modal-body">
          <div class="script-confirm-info">
            <p>Skill <strong>{{ pendingScriptConfirm.request.skillName }}</strong> 请求执行以下脚本：</p>
            <div class="script-name-display">{{ pendingScriptConfirm.request.scriptName }}</div>
          </div>
          <div class="script-preview">
            <div class="script-preview-label">脚本内容预览</div>
            <pre>{{ pendingScriptConfirm.request.scriptContent.slice(0, 500) }}{{ pendingScriptConfirm.request.scriptContent.length > 500 ? '...' : '' }}</pre>
          </div>
          <div class="script-confirm-warning">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>请确认脚本内容安全后再执行</span>
          </div>
          <div class="script-confirm-actions">
            <button class="btn btn-outline" @click="rejectScript">取消</button>
            <button class="btn btn-secondary" @click="confirmScript(false)">执行一次</button>
            <button class="btn btn-primary" @click="confirmScript(true)">信任并执行</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
