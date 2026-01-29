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
  getLanguage,
  watchLanguage,
  getThemeMode,
  setThemeMode,
  watchThemeMode,
  applyTheme,
  getResolvedTheme,
  type AIProvider,
  type Language,
  type ThemeMode,
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
import { t, type Translations } from '../../utils/i18n';

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

// Language state
const currentLanguage = ref<Language>('en');

// Theme state
const currentThemeMode = ref<ThemeMode>('system');
const showThemeSelector = ref(false);

// 国际化辅助函数
const i18n = (key: keyof Translations, params?: Record<string, string | number>) => {
  return t(currentLanguage.value, key, params);
};

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
}

// 编辑和复制状态
const editingMessageIndex = ref<number | null>(null);
const editingContent = ref<string>('');
const editingQuote = ref<string | null>(null);
const copiedMessageIndex = ref<number | null>(null);

// 复制按钮位置状态（按消息索引存储：'top' | 'bottom'）
const copyButtonPosition = ref<Record<number, 'top' | 'bottom'>>({});

// 计算属性
const isEditing = computed(() => editingMessageIndex.value !== null);
const canSendMessage = computed(() => !isEditing.value && !isLoading.value);

// 复制消息（仅 AI 回复）
async function copyMessage(index: number): Promise<void> {
  const message = messages.value[index];
  if (!message.content || message.role !== 'assistant') return;
  
  try {
    await navigator.clipboard.writeText(message.content);
    
    // 显示已复制状态
    copiedMessageIndex.value = index;
    
    // 2 秒后恢复
    setTimeout(() => {
      if (copiedMessageIndex.value === index) {
        copiedMessageIndex.value = null;
      }
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
    // 降级方案
    copyMessageFallback(message.content);
  }
}

// 处理消息鼠标移动，检测复制按钮应该显示在顶部还是底部
function handleMessageMouseMove(event: MouseEvent, index: number): void {
  const target = event.currentTarget as HTMLElement;
  if (!target) return;
  
  const rect = target.getBoundingClientRect();
  const mouseY = event.clientY;
  const middleY = rect.top + rect.height / 2;
  
  // 鼠标在消息上半部分显示顶部按钮，下半部分显示底部按钮
  copyButtonPosition.value[index] = mouseY < middleY ? 'top' : 'bottom';
}

// 复制降级方案
function copyMessageFallback(content: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = content;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  
  textarea.select();
  try {
    document.execCommand('copy');
    copiedMessageIndex.value = -1; // 使用 -1 表示降级方案成功
    setTimeout(() => {
      copiedMessageIndex.value = null;
    }, 2000);
  } catch (error) {
    alert('复制失败');
  }
  
  document.body.removeChild(textarea);
}

// 编辑消息
function startEditMessage(index: number): void {
  const message = messages.value[index];
  
  // 只允许编辑用户消息
  if (message.role !== 'user') return;
  
  // 保存编辑状态
  editingMessageIndex.value = index;
  editingContent.value = message.content;
  editingQuote.value = message.quote || null;
  
  // 不自动滚动，保持当前位置
}

// 取消编辑
function cancelEditMessage(): void {
  editingMessageIndex.value = null;
  editingContent.value = '';
  editingQuote.value = null;
}

// 移除编辑中的引用
function removeEditingQuote(): void {
  editingQuote.value = null;
}

// 保存编辑并重新生成
async function saveEditMessage(): Promise<void> {
  if (editingMessageIndex.value === null) return;
  
  const newContent = editingContent.value.trim();
  if (!newContent) {
    alert('消息不能为空');
    return;
  }
  
  if (!currentSession.value) {
    alert('会话不存在');
    cancelEditMessage();
    return;
  }
  
  const index = editingMessageIndex.value;
  
  // 获取当前的 API 上下文
  const currentApiMessages = currentSession.value.apiMessages || getLastApiMessages();
  
  // 计算被编辑的是第几条 user 消息（从 0 开始计数）
  // messages 数组中包含 user 和 assistant，需要计算 index 位置是第几个 user
  let userIndexInMessages = 0;
  for (let i = 0; i < index; i++) {
    if (messages.value[i]?.role === 'user') {
      userIndexInMessages++;
    }
  }
  // 此时 userIndexInMessages 表示被编辑的 user 消息是第几个（从 0 开始）
  
  // 在 apiMessages 中找到对应的 user 消息位置
  // apiMessages 结构: [system, user1, assistant1?, tool?, ..., user2, assistant2?, ...]
  let userCount = 0;
  let apiCutIndex = 0;
  for (let i = 0; i < currentApiMessages.length; i++) {
    if (currentApiMessages[i].role === 'user') {
      if (userCount === userIndexInMessages) {
        // 找到了要编辑的用户消息在 apiMessages 中的位置
        apiCutIndex = i;
        break;
      }
      userCount++;
    }
  }
  
  // 截取 apiMessages：保留到被编辑消息之前的所有内容（不包括被编辑的消息本身）
  const truncatedApiMessages = currentApiMessages.slice(0, apiCutIndex);
  
  // 更新消息内容
  messages.value[index].content = newContent;
  messages.value[index].quote = editingQuote.value || undefined;
  messages.value[index].timestamp = Date.now();
  
  // 删除该消息之后的所有消息
  messages.value = messages.value.slice(0, index + 1);
  
  // 更新 API 上下文为截取后的版本
  setLastApiMessages(truncatedApiMessages);
  
  // 同时更新会话中保存的 apiMessages
  if (currentSession.value) {
    currentSession.value.apiMessages = truncatedApiMessages;
  }
  
  // 清空编辑状态
  cancelEditMessage();
  
  // 触发重新生成
  await regenerateResponse();
}

// 重新生成 AI 回复
async function regenerateResponse(): Promise<void> {
  if (!currentSession.value) return;
  
  const provider = await getActiveProvider();
  if (!provider) {
    alert('未配置模型');
    return;
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
    scrollToBottom();
    
    // 使用 ReAct 范式的流式聊天
    const reactConfig = {
      enableTools: true,
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
    
    // 获取当前语言设置
    const currentLanguage = await getLanguage();
    
    // 获取之前保存的 API 上下文（已在 saveEditMessage 中正确截取）
    const previousApiMessages = currentSession.value?.apiMessages || getLastApiMessages();
    // 只有当之前有消息时才传入（排除只有 system 消息的情况）
    const hasValidPreviousContext = previousApiMessages.length > 1;
    
    for await (const event of streamChat(
      provider,
      messages.value.slice(0, -1),
      { sharePageContent: sharePageContent.value, skills: skillsInfo, pageInfo, language: currentLanguage },
      reactConfig,
      undefined, // retryConfig 使用默认值
      hasValidPreviousContext ? previousApiMessages : undefined
    )) {
      switch (event.type) {
        case 'reasoning':
          if (!assistantMessage.reasoning) {
            assistantMessage.reasoning = '';
          }
          assistantMessage.reasoning += event.content;
          triggerRef(messages);
          break;
        case 'content':
          isLoading.value = false;
          assistantMessage.content += event.content;
          triggerRef(messages);
          break;
        case 'tool_call':
          isLoading.value = true;
          toolStatus.value = getToolStatusText(event.toolCall.name, event.toolCall.arguments);
          break;
        case 'thinking':
          toolStatus.value = event.message;
          break;
        case 'tool_result':
          toolStatus.value = null;
          if (assistantMessage.content && !assistantMessage.content.endsWith('\n')) {
            assistantMessage.content += '\n';
          }
          triggerRef(messages);
          break;
        case 'done':
          toolStatus.value = null;
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
      content: `重新生成失败: ${error.message}`,
      timestamp: Date.now(),
    });
    triggerRef(messages);
  } finally {
    isLoading.value = false;
    toolStatus.value = null;
    await saveCurrentSession();
  }
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
  if (!activeProvider.value) return i18n('notConfigured');
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
  const locale = currentLanguage.value === 'zh-CN' ? 'zh-CN' : 'en-US';
  
  if (isToday) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const locale = currentLanguage.value === 'zh-CN' ? 'zh-CN' : 'en-US';
  return date.toLocaleDateString(locale, { 
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
const unwatchLanguage = ref<(() => void) | null>(null);
const unwatchThemeMode = ref<(() => void) | null>(null);
const systemThemeMediaQuery = ref<MediaQueryList | null>(null);

onMounted(async () => {
  providers.value = await getAllProviders();
  const activeProvider = await getActiveProvider();
  activeProviderId.value = activeProvider?.id || null;
  sharePageContent.value = await getSharePageContent();
  
  // 加载语言设置
  currentLanguage.value = await getLanguage();
  
  // 加载主题设置
  currentThemeMode.value = await getThemeMode();
  applyTheme(currentThemeMode.value);
  
  // 监听系统主题变化
  systemThemeMediaQuery.value = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeMediaQuery.value.addEventListener('change', handleSystemThemeChange);
  
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
  
  // 监听语言变化（跨页面同步）
  unwatchLanguage.value = watchLanguage((newLang) => {
    currentLanguage.value = newLang;
  });
  
  // 监听主题变化（跨页面同步）
  unwatchThemeMode.value = watchThemeMode((newMode) => {
    currentThemeMode.value = newMode;
    applyTheme(newMode);
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

// 系统主题变化处理
function handleSystemThemeChange() {
  if (currentThemeMode.value === 'system') {
    applyTheme('system');
  }
}

// 切换主题
async function changeThemeMode(mode: ThemeMode) {
  currentThemeMode.value = mode;
  await setThemeMode(mode);
  applyTheme(mode);
  showThemeSelector.value = false;
}

// 获取当前主题图标类型
const currentThemeIcon = computed(() => {
  if (currentThemeMode.value === 'system') {
    return getResolvedTheme('system');
  }
  return currentThemeMode.value;
});

// 清理 watchers
onUnmounted(() => {
  unwatchProviders.value?.();
  unwatchActiveProviderId.value?.();
  unwatchLanguage.value?.();
  unwatchThemeMode.value?.();
  // 移除系统主题监听
  systemThemeMediaQuery.value?.removeEventListener('change', handleSystemThemeChange);
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
  if (!text || isLoading.value || isEditing.value) return;

  const provider = await getActiveProvider();
  if (!provider) {
    alert(i18n('noModelConfig'));
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

    // 获取当前语言设置
    const currentLanguage = await getLanguage();

    // 获取之前保存的 API 上下文（包含完整的工具调用历史）
    const previousApiMessages = currentSession.value?.apiMessages || getLastApiMessages();
    // 只有当之前有消息时才传入（排除只有 system 消息的情况）
    const hasValidPreviousContext = previousApiMessages.length > 1;

    for await (const event of streamChat(
      provider, 
      messages.value.slice(0, -1), 
      { sharePageContent: sharePageContent.value, skills: skillsInfo, pageInfo, language: currentLanguage }, 
      reactConfig,
      undefined, // retryConfig 使用默认值
      hasValidPreviousContext ? previousApiMessages : undefined
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
  if (confirm(i18n('confirmDeleteChat'))) {
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
  // 始终从内存获取最新的 API 上下文（lastApiMessages 是实时更新的）
  // 只有当内存中没有数据时，才从会话中获取持久化的数据
  const memoryApiMessages = getLastApiMessages();
  if (memoryApiMessages.length > 0) {
    debugApiMessages.value = memoryApiMessages;
  } else if (currentSession.value?.apiMessages?.length) {
    debugApiMessages.value = currentSession.value.apiMessages;
  } else {
    debugApiMessages.value = [];
  }
  showDebugModal.value = true;
  
  // 启动实时刷新（每 500ms 更新一次）
  if (debugRefreshTimer) {
    clearInterval(debugRefreshTimer);
  }
  debugRefreshTimer = setInterval(() => {
    // 始终从内存获取最新数据
    const latestApiMessages = getLastApiMessages();
    if (latestApiMessages.length > 0) {
      debugApiMessages.value = latestApiMessages;
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
      <h1>Tactus</h1>
      <div class="header-actions">
        <!-- Theme Selector -->
        <div class="theme-selector-wrapper">
          <button class="icon-btn" @click="showThemeSelector = !showThemeSelector" :title="currentLanguage === 'zh-CN' ? '主题' : 'Theme'">
            <!-- Sun icon for light -->
            <svg v-if="currentThemeIcon === 'light'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="5"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
            <!-- Moon icon for dark -->
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
            </svg>
          </button>
          <!-- Theme dropdown -->
          <div v-if="showThemeSelector" class="theme-dropdown">
            <div class="theme-option" :class="{ active: currentThemeMode === 'light' }" @click="changeThemeMode('light')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
              <span>{{ currentLanguage === 'zh-CN' ? '浅色' : 'Light' }}</span>
            </div>
            <div class="theme-option" :class="{ active: currentThemeMode === 'dark' }" @click="changeThemeMode('dark')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
              </svg>
              <span>{{ currentLanguage === 'zh-CN' ? '深色' : 'Dark' }}</span>
            </div>
            <div class="theme-option" :class="{ active: currentThemeMode === 'system' }" @click="changeThemeMode('system')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
              <span>{{ currentLanguage === 'zh-CN' ? '跟随系统' : 'System' }}</span>
            </div>
          </div>
          <div v-if="showThemeSelector" class="theme-backdrop" @click="showThemeSelector = false"></div>
        </div>
        <button class="icon-btn" @click="viewDebugMessages" title="API Context">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
          </svg>
        </button>
        <button class="icon-btn" @click="newChat" :title="i18n('newChat')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
        <button class="icon-btn" @click="openHistory" :title="i18n('history')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        </button>
        <button class="icon-btn" @click="openSettings" :title="i18n('settings')">
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
        {{ i18n('sharePageContent') }}
      </label>
    </div>

    <!-- Chat area -->
    <div class="chat-area" ref="chatAreaRef">
      <div v-if="!messages.length" class="empty-state">
        <p>{{ i18n('welcomeMessage') }}</p>
        <p v-if="sharePageContent" class="empty-hint">
          {{ i18n('pageContentShared') }}
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
          <span v-else>{{ i18n('thinking') }}</span>
        </div>

        <div 
          class="message" 
          :class="msg.role"
          @mousemove="msg.role === 'assistant' ? handleMessageMouseMove($event, idx) : undefined"
        >
          <div v-if="msg.content || msg.reasoning" class="message-time">{{ formatTime(msg.timestamp) }}</div>
          
          <!-- 编辑模式 -->
          <div v-if="editingMessageIndex === idx" class="message-edit-mode">
            <!-- 引用内容（如果有） -->
            <div v-if="editingQuote" class="edit-quote">
              <div class="quote-content">"{{ editingQuote }}"</div>
              <button class="remove-quote-btn" @click="removeEditingQuote" title="移除引用">×</button>
            </div>
            
            <!-- 编辑文本框 -->
            <textarea
              v-model="editingContent"
              class="edit-textarea"
              rows="3"
              placeholder="编辑您的消息..."
              @keydown.ctrl.enter="saveEditMessage"
              @keydown.meta.enter="saveEditMessage"
              @keydown.esc="cancelEditMessage"
            ></textarea>
            
            <!-- 操作按钮 -->
            <div class="edit-actions">
              <button class="btn btn-outline btn-sm" @click="cancelEditMessage">
                {{ i18n('cancel') }}
              </button>
              <button class="btn btn-primary btn-sm" @click="saveEditMessage" :disabled="!editingContent.trim()">
                {{ i18n('send') }}
              </button>
            </div>
          </div>
          
          <!-- 正常显示模式 -->
          <template v-else>
            <div v-if="msg.quote" class="quote">"{{ msg.quote }}"</div>
            
            <!-- 消息操作按钮（顶部悬浮） -->
            <div class="message-actions" :class="{ 'force-hide': msg.role === 'assistant' && copyButtonPosition[idx] === 'bottom' }">
              <!-- 编辑按钮（仅用户消息） -->
              <button 
                v-if="msg.role === 'user' && !isEditing"
                class="message-action-btn edit-btn"
                @click="startEditMessage(idx)"
                :title="i18n('editMessage')"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              
              <!-- AI 消息顶部复制按钮 -->
              <button 
                v-if="msg.role === 'assistant' && msg.content && copyButtonPosition[idx] !== 'bottom'"
                class="message-action-btn copy-btn"
                @click="copyMessage(idx)"
                :title="copiedMessageIndex === idx ? i18n('copied') : i18n('copyMessage')"
                :class="{ copied: copiedMessageIndex === idx }"
              >
                <svg v-if="copiedMessageIndex !== idx" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </div>
          
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
                <span class="reasoning-label">{{ currentLanguage === 'zh-CN' ? '思维链' : 'Reasoning' }}</span>
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
            
            <!-- AI 消息底部复制按钮（悬浮显示，仅当鼠标在下半部分时） -->
            <div v-if="msg.role === 'assistant' && msg.content && copyButtonPosition[idx] === 'bottom'" class="message-actions-bottom">
              <button 
                class="message-action-btn copy-btn"
                @click="copyMessage(idx)"
                :title="copiedMessageIndex === idx ? i18n('copied') : i18n('copyMessage')"
                :class="{ copied: copiedMessageIndex === idx }"
              >
                <svg v-if="copiedMessageIndex !== idx" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </div>
          </template>
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
        <span v-else>{{ i18n('thinking') }}</span>
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
          :placeholder="i18n('inputPlaceholder')"
          rows="1"
          @keydown="handleKeydown"
        ></textarea>
        <div class="input-actions">
          <!-- Model selector -->
          <div class="model-selector-wrapper">
            <button 
              class="model-selector-btn" 
              @click="showModelSelector = !showModelSelector"
              :title="activeProvider?.selectedModel || ''"
            >
              <span class="model-name">{{ activeModelName }}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
            <!-- Model dropdown -->
            <div v-if="showModelSelector" class="model-dropdown">
              <div v-if="allModelOptions.length === 0" class="dropdown-empty">
                <span>{{ i18n('noProviders') }}</span>
                <button class="dropdown-settings-btn" @click="openSettings">{{ i18n('settings') }}</button>
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
          <button class="send-btn" @click="sendMessage" :disabled="isLoading || !inputText.trim() || isEditing">
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
          <h2>{{ i18n('history') }}</h2>
          <button class="close-btn" @click="showHistory = false">×</button>
        </div>
        <div class="modal-body">
          <div v-if="sessions.length === 0" class="empty-history">
            {{ currentLanguage === 'zh-CN' ? '暂无历史对话' : 'No chat history' }}
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
                  <span>{{ session.messages?.length || 0 }} {{ currentLanguage === 'zh-CN' ? '条消息' : 'messages' }}</span>
                  <span>{{ formatSessionDate(session.updatedAt) }}</span>
                </div>
              </div>
              <button class="delete-session-btn" @click="removeSession(session.id, $event)" :title="i18n('delete')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            </div>
            <!-- 加载更多提示 -->
            <div v-if="sessionsLoading" class="session-loading">
              <span>{{ i18n('loading') }}</span>
            </div>
            <div v-else-if="!sessionsHasMore && sessions.length > 0" class="session-end">
              <span>{{ currentLanguage === 'zh-CN' ? '没有更多了' : 'No more' }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Debug Modal -->
    <div v-if="showDebugModal" class="modal-overlay" @click.self="closeDebugModal">
      <div class="modal debug-modal">
        <div class="modal-header">
          <h2>{{ currentLanguage === 'zh-CN' ? 'API 上下文调试' : 'API Context Debug' }}</h2>
          <div class="debug-header-actions">
            <button class="copy-btn" @click="copyDebugMessages" title="Copy JSON">
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
                  {{ currentLanguage === 'zh-CN' ? '思维链' : 'Reasoning' }}
                </div>
                <pre class="debug-content debug-reasoning-content">{{ msg.reasoning }}</pre>
              </div>
              <pre v-if="msg.content" class="debug-content">{{ msg.content }}</pre>
              <pre v-if="msg.tool_calls?.length" class="debug-content debug-tool-calls">{{ formatToolCalls(msg.tool_calls) }}</pre>
              <div v-if="!msg.content && !msg.tool_calls?.length && !msg.reasoning" class="debug-empty">{{ currentLanguage === 'zh-CN' ? '(空)' : '(empty)' }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Script Confirm Modal -->
    <div v-if="showScriptConfirmModal && pendingScriptConfirm" class="modal-overlay">
      <div class="modal script-confirm-modal">
        <div class="modal-header">
          <h2>{{ currentLanguage === 'zh-CN' ? '脚本执行确认' : 'Script Execution Confirm' }}</h2>
        </div>
        <div class="modal-body">
          <div class="script-confirm-info">
            <p>{{ currentLanguage === 'zh-CN' ? 'Skill' : 'Skill' }} <strong>{{ pendingScriptConfirm.request.skillName }}</strong> {{ currentLanguage === 'zh-CN' ? '请求执行以下脚本：' : 'requests to execute:' }}</p>
            <div class="script-name-display">{{ pendingScriptConfirm.request.scriptName }}</div>
          </div>
          <div class="script-preview">
            <div class="script-preview-label">{{ currentLanguage === 'zh-CN' ? '脚本内容预览' : 'Script Preview' }}</div>
            <pre>{{ pendingScriptConfirm.request.scriptContent.slice(0, 500) }}{{ pendingScriptConfirm.request.scriptContent.length > 500 ? '...' : '' }}</pre>
          </div>
          <div class="script-confirm-warning">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>{{ currentLanguage === 'zh-CN' ? '请确认脚本内容安全后再执行' : 'Please verify the script is safe before executing' }}</span>
          </div>
          <div class="script-confirm-actions">
            <button class="btn btn-outline" @click="rejectScript">{{ i18n('cancel') }}</button>
            <button class="btn btn-secondary" @click="confirmScript(false)">{{ currentLanguage === 'zh-CN' ? '执行一次' : 'Run Once' }}</button>
            <button class="btn btn-primary" @click="confirmScript(true)">{{ currentLanguage === 'zh-CN' ? '信任并执行' : 'Trust & Run' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
