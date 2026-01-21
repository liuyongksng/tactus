import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { AIProvider, ChatMessage } from './db';
import { 
  getFilteredTools, 
  generateContextPrompt, 
  getToolStatusText, 
  type FunctionTool,
  type ToolCall, 
  type ToolResult, 
  type SkillInfo 
} from './tools';

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

// 创建带超时的 AbortController
function createTimeoutController(timeout: number): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  return {
    controller,
    clear: () => clearTimeout(timeoutId),
  };
}

// API 消息类型
export interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
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

// 创建 OpenAI 客户端
function createClient(provider: AIProvider): OpenAI {
  return new OpenAI({
    apiKey: provider.apiKey,
    baseURL: `${provider.baseUrl.replace(/\/$/, '')}/v1`,
    dangerouslyAllowBrowser: true, // 浏览器扩展环境需要
    maxRetries: 0, // 禁用 SDK 内置重试，由代码层统一控制
  });
}

export async function fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: `${baseUrl.replace(/\/$/, '')}/v1`,
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
}

// 流式聊天事件类型
export type StreamEvent = 
  | { type: 'content'; content: string }
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

// 转换消息格式为 OpenAI SDK 格式
function convertToOpenAIMessages(messages: ApiMessage[]): ChatCompletionMessageParam[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        content: m.content || '',
        tool_call_id: m.tool_call_id!,
      };
    }
    if (m.role === 'assistant' && m.tool_calls) {
      return {
        role: 'assistant' as const,
        content: m.content,
        tool_calls: m.tool_calls,
      };
    }
    return {
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content || '',
    };
  });
}


export async function* streamChat(
  provider: AIProvider,
  messages: ChatMessage[],
  context?: { sharePageContent?: boolean; skills?: SkillInfo[]; pageInfo?: { domain: string; title: string; url?: string } },
  config?: FunctionCallingConfig,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): AsyncGenerator<StreamEvent, void, unknown> {
  const enableTools = config?.enableTools ?? true;
  const toolExecutor = config?.toolExecutor;
  const maxIterations = config?.maxIterations || 5;
  
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
  const apiMessages: ApiMessage[] = [
    { role: 'system', content: systemMessage },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.quote ? `[Quote: "${m.quote}"]\n\n${m.content}` : m.content,
    })),
  ];

  lastApiMessages = [...apiMessages];

  // 获取过滤后的工具列表
  const tools = enableTools ? getFilteredTools(context) : [];
  const openaiTools = tools.length > 0 ? convertTools(tools) : undefined;
  
  let iteration = 0;
  let currentMessages = [...apiMessages];
  let toolCallRetryCount = 0; // 工具调用重试计数（包括参数解析错误）
  const maxToolCallRetries = 3; // 工具调用最大重试次数
  
  while (iteration < maxIterations) {
    iteration++;
    
    // 带重试的 API 调用
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    let lastError: ApiError | null = null;
    
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      const { controller, clear } = createTimeoutController(retryConfig.timeout);
      
      try {
        stream = await client.chat.completions.create({
          model: provider.selectedModel,
          messages: convertToOpenAIMessages(currentMessages),
          tools: openaiTools,
          tool_choice: openaiTools ? 'auto' : undefined,
          stream: true,
        }, {
          signal: controller.signal,
        });
        
        clear();
        lastError = null;
        break; // 成功，跳出重试循环
        
      } catch (error) {
        clear();
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
      }
    }
    
    // 如果没有成功获取 stream，抛出最后的错误
    if (!stream!) {
      throw lastError || new ApiError('未知错误', 'UNKNOWN', false);
    }
    
    let fullContent = '';
    
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
        const delta = chunk.choices[0]?.delta;
        
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
      
      // 构建 assistant 消息（包含 tool_calls）
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
        tool_calls: assistantToolCalls,
      });
      
      // 实时更新 API 上下文（记录 assistant 的 tool_calls）
      lastApiMessages = [...currentMessages];
      
      // 执行每个工具调用
      let hasExecutionError = false;
      for (const tc of toolCalls) {
        const parsedArgs = JSON.parse(tc.arguments || '{}');
        
        const toolCall: ToolCall = {
          id: tc.id,
          name: tc.name,
          arguments: parsedArgs,
        };
        
        yield { type: 'tool_call', toolCall };
        yield { type: 'thinking', message: getToolStatusText(tc.name, parsedArgs) };
        
        // 执行工具
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
    if (fullContent) {
      lastApiMessages.push({ role: 'assistant', content: fullContent });
    }
    break;
  }
  
  yield { type: 'done' };
}

// 简化版本的流式聊天（向后兼容，不使用工具）
export async function* streamChatSimple(
  provider: AIProvider,
  messages: ChatMessage[],
  pageContent?: string,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): AsyncGenerator<string, void, unknown> {
  const client = createClient(provider);
  
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
      content: m.quote ? `[Quote: "${m.quote}"]\n\n${m.content}` : m.content,
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
