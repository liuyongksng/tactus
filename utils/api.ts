import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ChatMessage } from './db';
import { isVisionSupportedForModel, type AIProvider } from './storage';
import { 
  getFilteredTools, 
  generateContextPrompt, 
  getToolStatusText, 
  isMcpTool,
  parseMcpToolName,
  type FunctionTool,
  type ToolCall, 
  type ToolResult, 
  type SkillInfo,
  type Language,
} from './tools';
import type { McpTool } from './mcp';

export interface ModelInfo {
  id: string;
  name?: string;
}

// ============ 容错机制配置 ============

export interface RetryConfig {
  maxRetries: number;      // 最大重试次数
  baseDelay: number;       // 基础延迟（毫秒）
  maxDelay: number;        // 最大延迟（毫秒）
  timeout: number;         // 请求超时（毫秒）
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  timeout: 60000,  // 60秒超时
};

// 错误类型分类
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// 友好的错误消息映射
const ERROR_MESSAGES: Record<string, string> = {
  'TIMEOUT': '请求超时，服务器响应太慢，请稍后重试',
  'NETWORK_ERROR': '网络连接失败，请检查网络后重试',
  'AUTH_ERROR': 'API 密钥无效或已过期，请检查配置',
  'RATE_LIMIT': '请求太频繁，已被限流，请稍后重试',
  'QUOTA_EXCEEDED': 'API 配额已用完，请检查账户余额',
  'MODEL_NOT_FOUND': '模型不存在或无权访问，请检查模型配置',
  'INVALID_REQUEST': '请求参数错误，请检查输入内容',
  'SERVER_ERROR': '服务器内部错误，请稍后重试',
  'TOOL_PARSE_ERROR': '工具调用参数解析失败，已达最大重试次数',
  'TOOL_EXECUTION_ERROR': '工具执行失败，已达最大重试次数',
  'TOOL_CALL_LIMIT_EXCEEDED': '工具调用次数已达上限，请调整设置后重试',
  'USER_ABORTED': '已终止本次生成',
  'UNKNOWN': '发生未知错误，请稍后重试',
};

// 解析错误并分类
function parseError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  // 超时错误
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ApiError(ERROR_MESSAGES['TIMEOUT'], 'TIMEOUT', true, error);
  }

  // OpenAI SDK 错误
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    
    if (status === 401 || status === 403) {
      return new ApiError(ERROR_MESSAGES['AUTH_ERROR'], 'AUTH_ERROR', false, error);
    }
    if (status === 429) {
      // 检查是否是配额问题
      const message = error.message?.toLowerCase() || '';
      if (message.includes('quota') || message.includes('billing') || message.includes('insufficient')) {
        return new ApiError(ERROR_MESSAGES['QUOTA_EXCEEDED'], 'QUOTA_EXCEEDED', false, error);
      }
      return new ApiError(ERROR_MESSAGES['RATE_LIMIT'], 'RATE_LIMIT', true, error);
    }
    if (status === 404) {
      return new ApiError(ERROR_MESSAGES['MODEL_NOT_FOUND'], 'MODEL_NOT_FOUND', false, error);
    }
    if (status === 400) {
      return new ApiError(ERROR_MESSAGES['INVALID_REQUEST'], 'INVALID_REQUEST', false, error);
    }
    if (status && status >= 500) {
      return new ApiError(ERROR_MESSAGES['SERVER_ERROR'], 'SERVER_ERROR', true, error);
    }
  }

  // 网络错误
  if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
    return new ApiError(ERROR_MESSAGES['NETWORK_ERROR'], 'NETWORK_ERROR', true, error);
  }

  // 通用错误处理
  const message = error instanceof Error ? error.message : String(error);
  
  // 尝试从错误消息中识别类型
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('timeout')) {
    return new ApiError(ERROR_MESSAGES['TIMEOUT'], 'TIMEOUT', true, error);
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('econnrefused') || lowerMessage.includes('enotfound')) {
    return new ApiError(ERROR_MESSAGES['NETWORK_ERROR'], 'NETWORK_ERROR', true, error);
  }

  return new ApiError(ERROR_MESSAGES['UNKNOWN'], 'UNKNOWN', false, error);
}

// 延迟函数
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 计算指数退避延迟
function getRetryDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 1000; // 添加随机抖动
  return Math.min(exponentialDelay + jitter, config.maxDelay);
}

function createUserAbortError(originalError?: unknown): ApiError {
  return new ApiError(ERROR_MESSAGES['USER_ABORTED'], 'USER_ABORTED', false, originalError);
}

// 创建带超时的 AbortController
function createTimeoutController(timeout: number, externalSignal?: AbortSignal): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const handleExternalAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', handleExternalAbort, { once: true });
    }
  }

  return {
    controller,
    clear: () => {
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', handleExternalAbort);
      }
    },
  };
}

// API 消息类型
export interface ApiMessageTextPart {
  type: 'text';
  text: string;
}

export interface ApiMessageImagePart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type ApiMessageContent =
  | string
  | Array<ApiMessageTextPart | ApiMessageImagePart>
  | null;

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ApiMessageContent;
  reasoning?: string | null;  // 思维链内容（如 DeepSeek reasoning_content）
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

// 存储最后一次发送给模型的完整上下文，用于调试
let lastApiMessages: ApiMessage[] = [];

export function getLastApiMessages(): ApiMessage[] {
  return lastApiMessages;
}

export function setLastApiMessages(messages: ApiMessage[]) {
  lastApiMessages = messages;
}

// 解析 Base URL：
// - 以 "/" 结尾：按原样使用（不自动拼接 /v1）
// - 不以 "/" 结尾：自动补充 /v1（若已是 /v1 则保持不变）
function resolveBaseUrl(baseUrl: string): string {
  const url = baseUrl.trim();
  if (!url) return url;
  if (url.endsWith('/')) return url;
  if (/\/v1$/i.test(url)) return url;
  return `${url}/v1`;
}

// 创建 OpenAI 客户端
function createClient(provider: AIProvider): OpenAI {
  return new OpenAI({
    apiKey: provider.apiKey,
    baseURL: resolveBaseUrl(provider.baseUrl),
    dangerouslyAllowBrowser: true, // 浏览器扩展环境需要
    maxRetries: 0, // 禁用 SDK 内置重试，由代码层统一控制
  });
}

export async function fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: resolveBaseUrl(baseUrl),
      dangerouslyAllowBrowser: true,
    });
    
    const response = await client.models.list();
    return response.data.map(m => ({
      id: m.id,
      name: m.id,
    }));
  } catch (error) {
    console.error('Error fetching models:', error);
    return [];
  }
}

// 工具执行器类型
export type ToolExecutor = (toolCall: ToolCall) => Promise<ToolResult>;

// Function Calling 配置
export interface FunctionCallingConfig {
  enableTools: boolean;
  toolExecutor?: ToolExecutor;
  maxIterations?: number;
  maxToolCalls?: number;
  abortSignal?: AbortSignal;
}

export interface StreamChatContext {
  sharePageContent?: boolean;
  skills?: SkillInfo[];
  mcpTools?: McpTool[];
  pageInfo?: { domain: string; title: string; url?: string };
  language?: Language;
  sessionKey?: string;
}

// 流式聊天事件类型
export type StreamEvent = 
  | { type: 'content'; content: string }
  | { type: 'reasoning'; content: string }  // 思维链内容（如 DeepSeek reasoning_content）
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'thinking'; message: string }
  | { type: 'error'; error: ApiError; retrying: boolean; attempt: number }
  | { type: 'done' };

// 检查 JSON 对象字符串是否已经闭合（大括号匹配）
// 用于处理某些模型（如 GLM-4.7）对无参数工具重复返回 "{}" 的情况
function isJsonClosed(str: string): boolean {
  if (!str) return false;
  
  let braceCount = 0;
  let inString = false;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    
    if (char === '"' && str[i - 1] !== '\\') {
      inString = !inString;
    } else if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
    }
  }
  
  return braceCount === 0 && str.includes('{');
}

// 尝试修复不完整的 JSON（补全缺失的括号）
// 用于处理某些模型（如 GLM-4.7）在生成嵌套 JSON 时提前结束输出的情况
function tryFixIncompleteJson(str: string): string {
  if (!str) return str;
  
  // 先尝试直接解析，如果成功就不需要修复
  try {
    JSON.parse(str);
    return str;
  } catch {}
  
  // 计算缺失的括号
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' && str[i - 1] !== '\\') {
      inString = !inString;
    } else if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
    }
  }
  
  // 补全缺失的括号
  let fixed = str;
  while (bracketCount > 0) { fixed += ']'; bracketCount--; }
  while (braceCount > 0) { fixed += '}'; braceCount--; }
  
  // 验证补全后是否有效
  try {
    JSON.parse(fixed);
    console.log('[tryFixIncompleteJson] 成功修复不完整的 JSON:', str, '->', fixed);
    return fixed;
  } catch {
    // 补全后仍然无效，返回原字符串（让后续逻辑处理错误）
    return str;
  }
}

// 转换工具格式
function convertTools(tools: FunctionTool[]): ChatCompletionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}

function convertToolsToResponses(tools: FunctionTool[]): Array<Record<string, unknown>> {
  return tools.map(t => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

function convertMessageContentToResponsesInput(content: ApiMessageContent): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({
        type: 'input_text',
        text: part.text,
      });
      continue;
    }
    if (part.type === 'image_url') {
      parts.push({
        type: 'input_image',
        image_url: part.image_url.url,
      });
    }
  }
  return parts;
}

export function buildResponsesInput(messages: ApiMessage[]): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  const seenToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const content = convertMessageContentToResponsesInput(message.content);
      const hasContent =
        (typeof content === 'string' && content.trim().length > 0) ||
        (Array.isArray(content) && content.length > 0);

      if (hasContent) {
        items.push({
          type: 'message',
          role: 'assistant',
          content,
        });
      }

      for (const toolCall of message.tool_calls) {
        const callId = typeof toolCall?.id === 'string' ? toolCall.id.trim() : '';
        const toolName = typeof toolCall?.function?.name === 'string' ? toolCall.function.name.trim() : '';
        const rawArguments = toolCall?.function?.arguments;
        if (!callId || !toolName) continue;

        seenToolCallIds.add(callId);
        items.push({
          type: 'function_call',
          call_id: callId,
          name: toolName,
          arguments:
            typeof rawArguments === 'string'
              ? rawArguments
              : JSON.stringify(rawArguments ?? {}),
        });
      }
      continue;
    }

    if (message.role === 'tool' && message.tool_call_id) {
      if (!seenToolCallIds.has(message.tool_call_id)) {
        console.warn(
          `[buildResponsesInput] 跳过未匹配的 function_call_output: ${message.tool_call_id}`,
        );
        continue;
      }
      items.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
      });
      continue;
    }

    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }

    items.push({
      type: 'message',
      role: message.role === 'system' ? 'developer' : message.role,
      content: convertMessageContentToResponsesInput(message.content),
    });
  }

  return items;
}

export function buildSessionHeaders(sessionKey?: string): Record<string, string> | undefined {
  const normalized = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  if (!normalized) return undefined;
  return {
    session_id: normalized,
    'x-session-id': normalized,
  };
}

export interface ParsedResponsesStreamEvent {
  type: string;
  responseId?: string;
  contentDelta?: string;
  reasoningDelta?: string;
  toolCallArgumentDelta?: { callId: string; name?: string; delta?: string };
  toolCallDone?: { callId: string; name?: string; arguments?: string };
  toolCallItemDone?: { callId: string; name?: string; arguments?: string };
}

export function parseResponsesStreamEvent(event: unknown): ParsedResponsesStreamEvent {
  const evt = event as any;
  const type = typeof evt?.type === 'string' ? evt.type : '';
  const responseId =
    (typeof evt?.response?.id === 'string' ? evt.response.id : undefined) ||
    (typeof evt?.response_id === 'string' ? evt.response_id : undefined);

  const parsed: ParsedResponsesStreamEvent = {
    type,
    responseId,
  };

  if (type === 'response.output_text.delta' && typeof evt?.delta === 'string' && evt.delta.length > 0) {
    parsed.contentDelta = evt.delta;
    return parsed;
  }

  if ((type.includes('reasoning') || type.includes('summary')) && typeof evt?.delta === 'string' && evt.delta.length > 0) {
    parsed.reasoningDelta = evt.delta;
    return parsed;
  }

  if (type === 'response.function_call_arguments.delta') {
    const callId = typeof evt?.call_id === 'string' ? evt.call_id : '';
    if (callId) {
      parsed.toolCallArgumentDelta = {
        callId,
        name: typeof evt?.name === 'string' ? evt.name : undefined,
        delta: typeof evt?.delta === 'string' ? evt.delta : undefined,
      };
    }
    return parsed;
  }

  if (type === 'response.function_call_arguments.done') {
    const callId = typeof evt?.call_id === 'string' ? evt.call_id : '';
    if (callId) {
      parsed.toolCallDone = {
        callId,
        name: typeof evt?.name === 'string' ? evt.name : undefined,
        arguments: typeof evt?.arguments === 'string' ? evt.arguments : undefined,
      };
    }
    return parsed;
  }

  if (type === 'response.output_item.done' && evt?.item?.type === 'function_call') {
    const callId = typeof evt.item.call_id === 'string' ? evt.item.call_id : '';
    if (callId) {
      parsed.toolCallItemDone = {
        callId,
        name: typeof evt.item.name === 'string' ? evt.item.name : undefined,
        arguments: typeof evt.item.arguments === 'string' ? evt.item.arguments : undefined,
      };
    }
  }

  return parsed;
}

function shouldUseResponsesMode(provider: AIProvider): boolean {
  return provider.apiMode !== 'chat_completions';
}

function shouldFallbackToChatCompletions(error: ApiError): boolean {
  return (
    error.code === 'INVALID_REQUEST' ||
    error.code === 'MODEL_NOT_FOUND' ||
    error.code === 'UNKNOWN' ||
    error.code === 'SERVER_ERROR'
  );
}

// 转换消息格式为 OpenAI SDK 格式
function convertToOpenAIMessages(messages: ApiMessage[]): ChatCompletionMessageParam[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        content: typeof m.content === 'string' ? m.content : '',
        tool_call_id: m.tool_call_id!,
      };
    }
    if (m.role === 'assistant' && m.tool_calls) {
      return {
        role: 'assistant' as const,
        content: typeof m.content === 'string' ? m.content : '',
        tool_calls: m.tool_calls,
      };
    }
    if (m.role === 'user') {
      return {
        role: 'user' as const,
        content: Array.isArray(m.content) ? m.content : (m.content || ''),
      };
    }
    if (m.role === 'system') {
      return {
        role: 'system' as const,
        content: typeof m.content === 'string' ? m.content : '',
      };
    }
    if (m.role === 'assistant') {
      return {
        role: 'assistant' as const,
        content: typeof m.content === 'string' ? m.content : '',
      };
    }
    return {
      role: 'user' as const,
      content: '',
    };
  });
}

function getQuotedText(message: Pick<ChatMessage, 'content' | 'quote'>): string {
  return message.quote ? `[Quote: "${message.quote}"]\n\n${message.content}` : message.content;
}

function buildUserMessageContent(
  message: Pick<ChatMessage, 'content' | 'quote' | 'images'>,
  allowImages: boolean,
): ApiMessageContent {
  const text = getQuotedText(message);
  if (!allowImages || !message.images?.length) {
    return text;
  }

  const parts: Array<ApiMessageTextPart | ApiMessageImagePart> = [];
  if (text.trim().length > 0) {
    parts.push({ type: 'text', text });
  }
  for (const image of message.images) {
    if (image.dataUrl) {
      parts.push({
        type: 'image_url',
        image_url: { url: image.dataUrl },
      });
    }
  }
  return parts;
}

function stripImageParts(content: ApiMessageContent): ApiMessageContent {
  if (!Array.isArray(content)) return content;
  const text = content
    .filter((part): part is ApiMessageTextPart => part.type === 'text')
    .map(part => part.text)
    .join('\n\n')
    .trim();
  return text;
}

function sanitizeMessagesForVision(messages: ApiMessage[], allowImages: boolean): ApiMessage[] {
  if (allowImages) return messages.map(message => ({ ...message }));
  return messages.map(message => {
    if (message.role !== 'user') return { ...message };
    return {
      ...message,
      content: stripImageParts(message.content),
    };
  });
}


async function* streamChatWithChatCompletions(
  provider: AIProvider,
  messages: ChatMessage[],
  context?: StreamChatContext,
  config?: FunctionCallingConfig,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  previousApiMessages?: ApiMessage[]  // 新增：传入之前保存的完整 API 上下文
): AsyncGenerator<StreamEvent, void, unknown> {
  const enableTools = config?.enableTools ?? true;
  const toolExecutor = config?.toolExecutor;
  const maxIterations = config?.maxIterations || 5;
  const maxToolCalls = Math.max(1, config?.maxToolCalls || 100);
  const allowImages = isVisionSupportedForModel(provider, provider.selectedModel);
  const sessionHeaders = buildSessionHeaders(context?.sessionKey);
  const abortSignal = config?.abortSignal;
  const ensureNotAborted = () => {
    if (abortSignal?.aborted) {
      throw createUserAbortError();
    }
  };
  
  const client = createClient(provider);
  
  const basePrompt = `You are a helpful AI assistant. Always respond using Markdown format for better readability. Use:
- Headers (##, ###) for sections
- **bold** and *italic* for emphasis
- \`code\` for inline code and \`\`\` for code blocks with language specification
- Lists (- or 1.) for enumerations
- > for quotes
- Tables when presenting structured data`;

  const contextPrompt = generateContextPrompt(context);
  const systemMessage = `${basePrompt}\n\n${contextPrompt}`;

  // 构建初始消息
  let apiMessages: ApiMessage[];
  
  if (previousApiMessages && previousApiMessages.length > 0) {
    // 如果有之前保存的 API 上下文，使用它并更新 system 消息
    apiMessages = sanitizeMessagesForVision(previousApiMessages, allowImages);
    // 更新 system 消息（可能上下文有变化）
    if (apiMessages[0]?.role === 'system') {
      apiMessages[0].content = systemMessage;
    }
    // 添加新的用户消息（最后一条）
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      apiMessages.push({
        role: 'user',
        content: buildUserMessageContent(lastMessage, allowImages),
      });
    }
  } else {
    // 没有之前的上下文，从 ChatMessage 构建
    apiMessages = [
      { role: 'system', content: systemMessage },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.role === 'user' ? buildUserMessageContent(m, allowImages) : m.content,
      })),
    ];
  }

  lastApiMessages = [...apiMessages];

  // 获取过滤后的工具列表
  const tools = enableTools ? getFilteredTools(context) : [];
  const openaiTools = tools.length > 0 ? convertTools(tools) : undefined;
  
  let iteration = 0;
  let currentMessages = [...apiMessages];
  let toolCallRetryCount = 0; // 工具调用重试计数（包括参数解析错误）
  const maxToolCallRetries = 3; // 工具调用最大重试次数
  let executedToolCallCount = 0;
  
  while (iteration < maxIterations) {
    ensureNotAborted();
    iteration++;
    
    // 带重试的 API 调用
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    let lastError: ApiError | null = null;
    
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      ensureNotAborted();
      const { controller, clear } = createTimeoutController(retryConfig.timeout, abortSignal);
      
      try {
        const requestOptions: Record<string, unknown> = {
          signal: controller.signal,
        };
        if (sessionHeaders) {
          requestOptions.headers = sessionHeaders;
        }
        stream = await client.chat.completions.create({
          model: provider.selectedModel,
          messages: convertToOpenAIMessages(currentMessages),
          tools: openaiTools,
          tool_choice: openaiTools ? 'auto' : undefined,
          stream: true,
        }, requestOptions as any);
        
        clear();
        lastError = null;
        break; // 成功，跳出重试循环
        
      } catch (error) {
        clear();
        if (abortSignal?.aborted) {
          throw createUserAbortError(error);
        }
        lastError = parseError(error);
        
        // 不可重试的错误，直接抛出
        if (!lastError.retryable) {
          yield { type: 'error', error: lastError, retrying: false, attempt };
          throw lastError;
        }
        
        // 已达最大重试次数
        if (attempt >= retryConfig.maxRetries) {
          yield { type: 'error', error: lastError, retrying: false, attempt };
          throw lastError;
        }
        
        // 通知正在重试
        const retryDelay = getRetryDelay(attempt, retryConfig);
        yield { 
          type: 'error', 
          error: lastError, 
          retrying: true, 
          attempt 
        };
        yield { 
          type: 'thinking', 
          message: `请求失败，${Math.round(retryDelay / 1000)} 秒后重试 (${attempt + 1}/${retryConfig.maxRetries})...` 
        };
        
        await delay(retryDelay);
        ensureNotAborted();
      }
    }
    
    // 如果没有成功获取 stream，抛出最后的错误
    if (!stream!) {
      throw lastError || new ApiError('未知错误', 'UNKNOWN', false);
    }
    
    let fullContent = '';
    let fullReasoning = '';  // 思维链内容（如 DeepSeek reasoning_content）
    
    // 工具调用收集器
    // 使用 id 作为主键来存储工具调用，这样更健壮
    // 
    // 背景说明：
    // OpenAI 流式响应中，tool_calls 有两个标识字段：
    // - index: 流式传输时的"槽位编号"，用于拼接同一个工具调用的多个 chunks
    // - id: 工具调用的唯一标识符，用于后续提交工具执行结果时匹配
    // 
    // 正常情况下，一个 index 只对应一个 id。但某些兼容层（如 newapi）
    // 可能在同一个 index 下返回多个不同 id 的工具调用，导致 arguments 被错误拼接。
    // 
    // 解决方案：
    // 使用 Map<index, Map<id, toolCall>> 的双层结构，
    // 当同一个 index 出现新的 id 时，创建新的工具调用条目而不是累加 arguments。
    const toolCallsByIndex: Map<number, Map<string, { id: string; name: string; arguments: string }>> = new Map();
    
    // 流式读取响应（带错误处理）
    try {
      for await (const chunk of stream) {
        ensureNotAborted();
        const delta = chunk.choices[0]?.delta;
        
        // 处理思维链内容（DeepSeek reasoning_content）
        // 某些模型（如 DeepSeek-R1）会在 delta 中返回 reasoning_content 字段
        const reasoningContent = (delta as any)?.reasoning_content;
        if (reasoningContent) {
          fullReasoning += reasoningContent;
          yield { type: 'reasoning', content: reasoningContent };
        }
        
        // 处理文本内容
        if (delta?.content) {
          fullContent += delta.content;
          yield { type: 'content', content: delta.content };
        }
        
        // 处理工具调用增量
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            
            // 确保该 index 的 Map 存在
            if (!toolCallsByIndex.has(index)) {
              toolCallsByIndex.set(index, new Map());
            }
            const indexMap = toolCallsByIndex.get(index)!;
            
            // 如果有新的 id，说明是新的工具调用（即使 index 相同）
            // 这处理了某些 API 兼容层在同一 index 下返回多个工具调用的情况
            if (tc.id) {
              if (!indexMap.has(tc.id)) {
                // 新的工具调用
                indexMap.set(tc.id, {
                  id: tc.id,
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || '',
                });
              } else {
                // 已存在的工具调用，更新信息
                const existing = indexMap.get(tc.id)!;
                if (tc.function?.name) {
                  existing.name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  // 检查现有 arguments 是否已经是闭合的 JSON
                  // 这处理了 GLM-4.7 等模型对无参数工具返回多次 "{}" 的情况
                  if (!isJsonClosed(existing.arguments)) {
                    existing.arguments += tc.function.arguments;
                  }
                }
              }
            } else {
              // 没有 id 的 chunk，找到该 index 下最后一个工具调用并累加
              // （正常流式传输时，后续 chunks 不会重复发送 id）
              const entries = Array.from(indexMap.values());
              if (entries.length > 0) {
                const lastEntry = entries[entries.length - 1];
                if (tc.function?.name) {
                  lastEntry.name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  // 同样检查是否已闭合
                  if (!isJsonClosed(lastEntry.arguments)) {
                    lastEntry.arguments += tc.function.arguments;
                  }
                }
              }
            }
          }
        }
      }
    } catch (streamError) {
      if (abortSignal?.aborted) {
        throw createUserAbortError(streamError);
      }
      const apiError = parseError(streamError);
      yield { type: 'error', error: apiError, retrying: false, attempt: retryConfig.maxRetries };
      throw apiError;
    }
    
    // 将双层 Map 扁平化为工具调用数组
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    for (const indexMap of toolCallsByIndex.values()) {
      for (const tc of indexMap.values()) {
        if (tc.id && tc.name) {
          toolCalls.push(tc);
        }
      }
    }
    
    // 检查是否有工具调用
    if (toolCalls.length > 0 && toolExecutor) {
      ensureNotAborted();
      // 尝试修复不完整的 JSON 参数（处理某些模型截断输出的情况）
      for (const tc of toolCalls) {
        if (tc.arguments) {
          tc.arguments = tryFixIncompleteJson(tc.arguments);
        }
      }
      
      // 检查是否有参数解析错误
      // 如果有解析错误，剔除本次模型回复，直接重试
      let hasParseError = false;
      for (const tc of toolCalls) {
        try {
          if (tc.arguments) JSON.parse(tc.arguments);
        } catch (e) {
          hasParseError = true;
          console.error('[Tool Args Parse Error] 工具参数解析失败，将剔除本次模型回复并重试');
          console.error('  工具名:', tc.name);
          console.error('  原始参数:', tc.arguments);
          console.error('  错误:', e);
          break;
        }
      }
      
      // 如果有解析错误，剔除本次模型回复，直接重试
      if (hasParseError) {
        toolCallRetryCount++;
        console.warn(`[Retry] 检测到工具参数解析错误，剔除模型回复后重试 (${toolCallRetryCount}/${maxToolCallRetries})`);
        
        // 检查是否超过最大重试次数
        if (toolCallRetryCount >= maxToolCallRetries) {
          const error = new ApiError(
            `工具调用失败：参数解析错误，已重试 ${maxToolCallRetries} 次`,
            'TOOL_PARSE_ERROR',
            false
          );
          yield { type: 'error', error, retrying: false, attempt: toolCallRetryCount };
          throw error;
        }
        
        yield { 
          type: 'thinking', 
          message: `工具参数解析错误，正在重试 (${toolCallRetryCount}/${maxToolCallRetries})...` 
        };
        
        // 不添加本次 assistant 消息到 currentMessages，直接重试
        continue;
      }
      
      // 构建 assistant 消息（包含 tool_calls 和 reasoning）
      const assistantToolCalls = toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      }));
      
      currentMessages.push({
        role: 'assistant',
        content: fullContent || null,
        reasoning: fullReasoning || null,
        tool_calls: assistantToolCalls,
      });
      
      // 实时更新 API 上下文（记录 assistant 的 tool_calls）
      lastApiMessages = [...currentMessages];
      
      // 执行每个工具调用
      let hasExecutionError = false;
      for (const tc of toolCalls) {
        ensureNotAborted();
        if (executedToolCallCount >= maxToolCalls) {
          const error = new ApiError(
            `工具调用次数已达上限（${maxToolCalls}）`,
            'TOOL_CALL_LIMIT_EXCEEDED',
            false
          );
          yield { type: 'error', error, retrying: false, attempt: executedToolCallCount };
          throw error;
        }

        const parsedArgs = JSON.parse(tc.arguments || '{}');
        
        const toolCall: ToolCall = {
          id: tc.id,
          name: tc.name,
          arguments: parsedArgs,
        };
        
        yield { type: 'tool_call', toolCall };
        yield { type: 'thinking', message: getToolStatusText(tc.name, parsedArgs) };
        
        // 执行工具
        executedToolCallCount++;
        const result = await toolExecutor(toolCall);
        yield { type: 'tool_result', result };
        
        // 检查工具执行是否失败
        if (!result.success) {
          hasExecutionError = true;
          toolCallRetryCount++;
          console.warn(`[Tool Execution Error] 工具执行失败 (${toolCallRetryCount}/${maxToolCallRetries})`);
          console.error('  工具名:', tc.name);
          console.error('  错误:', result.result);
          
          // 检查是否超过最大重试次数
          if (toolCallRetryCount >= maxToolCallRetries) {
            const error = new ApiError(
              `工具执行失败：${result.result}，已重试 ${maxToolCallRetries} 次`,
              'TOOL_EXECUTION_ERROR',
              false
            );
            yield { type: 'error', error, retrying: false, attempt: toolCallRetryCount };
            throw error;
          }
          
          yield { 
            type: 'thinking', 
            message: `工具执行失败，正在重试 (${toolCallRetryCount}/${maxToolCallRetries})...` 
          };
          
          // 跳出工具执行循环，准备重试
          break;
        }
        
        // 添加工具结果消息
        currentMessages.push({
          role: 'tool',
          content: result.result,
          tool_call_id: tc.id,
          name: tc.name,
        });
        
        // 实时更新 API 上下文（记录 tool result）
        lastApiMessages = [...currentMessages];
      }
      
      // 如果有执行错误，剔除本次 assistant 消息，重试
      if (hasExecutionError) {
        // 移除刚才添加的 assistant 消息
        currentMessages.pop();
        continue;
      }
      
      // 继续下一轮迭代
      continue;
    }
    
    // 没有工具调用，结束循环
    lastApiMessages = [...currentMessages];
    if (fullContent || fullReasoning) {
      lastApiMessages.push({ 
        role: 'assistant', 
        content: fullContent || null,
        reasoning: fullReasoning || null,
      });
    }
    break;
  }
  
  yield { type: 'done' };
}

async function* streamChatWithResponses(
  provider: AIProvider,
  messages: ChatMessage[],
  context?: StreamChatContext,
  config?: FunctionCallingConfig,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  previousApiMessages?: ApiMessage[],
): AsyncGenerator<StreamEvent, void, unknown> {
  const enableTools = config?.enableTools ?? true;
  const toolExecutor = config?.toolExecutor;
  const maxIterations = config?.maxIterations || 5;
  const maxToolCalls = Math.max(1, config?.maxToolCalls || 100);
  const allowImages = isVisionSupportedForModel(provider, provider.selectedModel);
  const abortSignal = config?.abortSignal;
  const sessionHeaders = buildSessionHeaders(context?.sessionKey);
  const promptCacheKey = typeof context?.sessionKey === 'string' ? context.sessionKey.trim() : '';
  const ensureNotAborted = () => {
    if (abortSignal?.aborted) {
      throw createUserAbortError();
    }
  };

  const client = createClient(provider);

  const basePrompt = `You are a helpful AI assistant. Always respond using Markdown format for better readability. Use:
- Headers (##, ###) for sections
- **bold** and *italic* for emphasis
- \`code\` for inline code and \`\`\` for code blocks with language specification
- Lists (- or 1.) for enumerations
- > for quotes
- Tables when presenting structured data`;

  const contextPrompt = generateContextPrompt(context);
  const systemMessage = `${basePrompt}\n\n${contextPrompt}`;

  let apiMessages: ApiMessage[];
  if (previousApiMessages && previousApiMessages.length > 0) {
    apiMessages = sanitizeMessagesForVision(previousApiMessages, allowImages);
    if (apiMessages[0]?.role === 'system') {
      apiMessages[0].content = systemMessage;
    }
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      apiMessages.push({
        role: 'user',
        content: buildUserMessageContent(lastMessage, allowImages),
      });
    }
  } else {
    apiMessages = [
      { role: 'system', content: systemMessage },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.role === 'user' ? buildUserMessageContent(m, allowImages) : m.content,
      })),
    ];
  }

  lastApiMessages = [...apiMessages];

  const tools = enableTools ? getFilteredTools(context) : [];
  const responseTools = tools.length > 0 ? convertToolsToResponses(tools) : undefined;

  let iteration = 0;
  let currentMessages = [...apiMessages];
  let toolCallRetryCount = 0;
  const maxToolCallRetries = 3;
  let executedToolCallCount = 0;

  while (iteration < maxIterations) {
    ensureNotAborted();
    iteration++;

    const responseInput = buildResponsesInput(currentMessages);

    let stream: AsyncIterable<any> | undefined;
    let lastError: ApiError | null = null;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      ensureNotAborted();
      const { controller, clear } = createTimeoutController(retryConfig.timeout, abortSignal);

      try {
        const requestBody: Record<string, unknown> = {
          model: provider.selectedModel,
          input: responseInput,
          stream: true,
        };
        if (responseTools) {
          requestBody.tools = responseTools;
        }
        if (promptCacheKey) {
          requestBody.prompt_cache_key = promptCacheKey;
        }

        const requestOptions: Record<string, unknown> = {
          signal: controller.signal,
        };
        if (sessionHeaders) {
          requestOptions.headers = sessionHeaders;
        }

        stream = await (client.responses.create as any)(requestBody, requestOptions);

        clear();
        lastError = null;
        break;
      } catch (error) {
        clear();
        if (abortSignal?.aborted) {
          throw createUserAbortError(error);
        }

        lastError = parseError(error);
        if (!lastError.retryable) {
          yield { type: 'error', error: lastError, retrying: false, attempt };
          throw lastError;
        }
        if (attempt >= retryConfig.maxRetries) {
          yield { type: 'error', error: lastError, retrying: false, attempt };
          throw lastError;
        }

        const retryDelay = getRetryDelay(attempt, retryConfig);
        yield {
          type: 'error',
          error: lastError,
          retrying: true,
          attempt,
        };
        yield {
          type: 'thinking',
          message: `请求失败，${Math.round(retryDelay / 1000)} 秒后重试 (${attempt + 1}/${retryConfig.maxRetries})...`,
        };
        await delay(retryDelay);
        ensureNotAborted();
      }
    }

    if (!stream) {
      throw lastError || new ApiError('未知错误', 'UNKNOWN', false);
    }

    let fullContent = '';
    let fullReasoning = '';
    const toolCallsById: Map<string, { id: string; name: string; arguments: string }> = new Map();

    try {
      for await (const event of stream) {
        ensureNotAborted();
        const parsedEvent = parseResponsesStreamEvent(event);
        if (parsedEvent.contentDelta) {
          fullContent += parsedEvent.contentDelta;
          yield { type: 'content', content: parsedEvent.contentDelta };
          continue;
        }
        if (parsedEvent.reasoningDelta) {
          fullReasoning += parsedEvent.reasoningDelta;
          yield { type: 'reasoning', content: parsedEvent.reasoningDelta };
          continue;
        }
        if (parsedEvent.toolCallArgumentDelta) {
          const deltaEvent = parsedEvent.toolCallArgumentDelta;
          const existing = toolCallsById.get(deltaEvent.callId) || {
            id: deltaEvent.callId,
            name: '',
            arguments: '',
          };
          if (deltaEvent.name) {
            existing.name = deltaEvent.name;
          }
          if (deltaEvent.delta && !isJsonClosed(existing.arguments)) {
            existing.arguments += deltaEvent.delta;
          }
          toolCallsById.set(deltaEvent.callId, existing);
          continue;
        }
        if (parsedEvent.toolCallDone) {
          const doneEvent = parsedEvent.toolCallDone;
          const existing = toolCallsById.get(doneEvent.callId) || {
            id: doneEvent.callId,
            name: '',
            arguments: '',
          };
          if (doneEvent.name) {
            existing.name = doneEvent.name;
          }
          if (doneEvent.arguments) {
            existing.arguments = doneEvent.arguments;
          }
          toolCallsById.set(doneEvent.callId, existing);
          continue;
        }
        if (parsedEvent.toolCallItemDone) {
          const itemEvent = parsedEvent.toolCallItemDone;
          const existing = toolCallsById.get(itemEvent.callId) || {
            id: itemEvent.callId,
            name: '',
            arguments: '',
          };
          if (itemEvent.name) {
            existing.name = itemEvent.name;
          }
          if (itemEvent.arguments) {
            existing.arguments = itemEvent.arguments;
          }
          toolCallsById.set(itemEvent.callId, existing);
        }
      }
    } catch (streamError) {
      if (abortSignal?.aborted) {
        throw createUserAbortError(streamError);
      }
      const apiError = parseError(streamError);
      yield { type: 'error', error: apiError, retrying: false, attempt: retryConfig.maxRetries };
      throw apiError;
    }

    const toolCalls = Array.from(toolCallsById.values()).filter(tc => tc.id && tc.name);

    if (toolCalls.length > 0 && toolExecutor) {
      ensureNotAborted();

      for (const tc of toolCalls) {
        if (tc.arguments) {
          tc.arguments = tryFixIncompleteJson(tc.arguments);
        }
      }

      let hasParseError = false;
      for (const tc of toolCalls) {
        try {
          if (tc.arguments) JSON.parse(tc.arguments);
        } catch (e) {
          hasParseError = true;
          console.error('[Tool Args Parse Error] 工具参数解析失败，将剔除本次模型回复并重试');
          console.error('  工具名:', tc.name);
          console.error('  原始参数:', tc.arguments);
          console.error('  错误:', e);
          break;
        }
      }

      if (hasParseError) {
        toolCallRetryCount++;
        if (toolCallRetryCount >= maxToolCallRetries) {
          const error = new ApiError(
            `工具调用失败：参数解析错误，已重试 ${maxToolCallRetries} 次`,
            'TOOL_PARSE_ERROR',
            false,
          );
          yield { type: 'error', error, retrying: false, attempt: toolCallRetryCount };
          throw error;
        }
        yield {
          type: 'thinking',
          message: `工具参数解析错误，正在重试 (${toolCallRetryCount}/${maxToolCallRetries})...`,
        };
        continue;
      }

      const assistantToolCalls = toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      }));

      currentMessages.push({
        role: 'assistant',
        content: fullContent || null,
        reasoning: fullReasoning || null,
        tool_calls: assistantToolCalls,
      });
      lastApiMessages = [...currentMessages];

      let hasExecutionError = false;
      for (const tc of toolCalls) {
        ensureNotAborted();
        if (executedToolCallCount >= maxToolCalls) {
          const error = new ApiError(
            `工具调用次数已达上限（${maxToolCalls}）`,
            'TOOL_CALL_LIMIT_EXCEEDED',
            false,
          );
          yield { type: 'error', error, retrying: false, attempt: executedToolCallCount };
          throw error;
        }

        const parsedArgs = JSON.parse(tc.arguments || '{}');
        const toolCall: ToolCall = {
          id: tc.id,
          name: tc.name,
          arguments: parsedArgs,
        };

        yield { type: 'tool_call', toolCall };
        yield { type: 'thinking', message: getToolStatusText(tc.name, parsedArgs) };

        executedToolCallCount++;
        const result = await toolExecutor(toolCall);
        yield { type: 'tool_result', result };

        if (!result.success) {
          hasExecutionError = true;
          toolCallRetryCount++;
          if (toolCallRetryCount >= maxToolCallRetries) {
            const error = new ApiError(
              `工具执行失败：${result.result}，已重试 ${maxToolCallRetries} 次`,
              'TOOL_EXECUTION_ERROR',
              false,
            );
            yield { type: 'error', error, retrying: false, attempt: toolCallRetryCount };
            throw error;
          }
          yield {
            type: 'thinking',
            message: `工具执行失败，正在重试 (${toolCallRetryCount}/${maxToolCallRetries})...`,
          };
          break;
        }

        currentMessages.push({
          role: 'tool',
          content: result.result,
          tool_call_id: tc.id,
          name: tc.name,
        });
        lastApiMessages = [...currentMessages];
      }

      if (hasExecutionError) {
        currentMessages.pop();
        continue;
      }
      continue;
    }

    lastApiMessages = [...currentMessages];
    if (fullContent || fullReasoning) {
      lastApiMessages.push({
        role: 'assistant',
        content: fullContent || null,
        reasoning: fullReasoning || null,
      });
    }
    break;
  }

  yield { type: 'done' };
}

export async function* streamChat(
  provider: AIProvider,
  messages: ChatMessage[],
  context?: StreamChatContext,
  config?: FunctionCallingConfig,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  previousApiMessages?: ApiMessage[],
): AsyncGenerator<StreamEvent, void, unknown> {
  if (shouldUseResponsesMode(provider)) {
    try {
      yield* streamChatWithResponses(provider, messages, context, config, retryConfig, previousApiMessages);
      return;
    } catch (error) {
      const parsedError = parseError(error);
      if (provider.apiMode !== 'auto' || !shouldFallbackToChatCompletions(parsedError)) {
        throw parsedError;
      }
      console.warn('[streamChat] Responses 模式失败，已自动回退到 chat.completions:', parsedError.message);
    }
  }

  yield* streamChatWithChatCompletions(provider, messages, context, config, retryConfig, previousApiMessages);
}

// 简化版本的流式聊天（向后兼容，不使用工具）
export async function* streamChatSimple(
  provider: AIProvider,
  messages: ChatMessage[],
  pageContent?: string,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): AsyncGenerator<string, void, unknown> {
  const client = createClient(provider);
  const allowImages = isVisionSupportedForModel(provider, provider.selectedModel);
  
  const basePrompt = `You are a helpful AI assistant. Always respond using Markdown format for better readability. Use:
- Headers (##, ###) for sections
- **bold** and *italic* for emphasis
- \`code\` for inline code and \`\`\` for code blocks with language specification
- Lists (- or 1.) for enumerations
- > for quotes
- Tables when presenting structured data`;

  const systemMessage = pageContent
    ? `${basePrompt}\n\nThe user is viewing a webpage with the following content:\n\n${pageContent}\n\nAnswer questions based on this context when relevant.`
    : basePrompt;

  const apiMessages: ApiMessage[] = [
    { role: 'system', content: systemMessage },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.role === 'user' ? buildUserMessageContent(m, allowImages) : m.content,
    })),
  ];

  lastApiMessages = apiMessages;

  // 带重试的 API 调用
  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  
  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    const { controller, clear } = createTimeoutController(retryConfig.timeout);
    
    try {
      stream = await client.chat.completions.create({
        model: provider.selectedModel,
        messages: convertToOpenAIMessages(apiMessages),
        stream: true,
      }, {
        signal: controller.signal,
      });
      
      clear();
      break;
      
    } catch (error) {
      clear();
      const apiError = parseError(error);
      
      if (!apiError.retryable || attempt >= retryConfig.maxRetries) {
        throw apiError;
      }
      
      const retryDelay = getRetryDelay(attempt, retryConfig);
      await delay(retryDelay);
    }
  }

  if (!stream!) {
    throw new ApiError('未知错误', 'UNKNOWN', false);
  }

  try {
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  } catch (streamError) {
    throw parseError(streamError);
  }
}
