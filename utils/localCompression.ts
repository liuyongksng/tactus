import type { ApiMessage } from './api';

export const SUMMARY_PREFIX = '[LOCAL_CONTEXT_SUMMARY]';

export type ContextCompactionTrigger = 'pre-turn' | 'mid-turn' | 'model-switch';

export interface LocalCompressionSettings {
  enabled: boolean;
  autoCompactTokenLimit: number | null;
  keepRecentUserTokens: number;
  summaryMaxTokens: number;
  compactPrompt: string | null;
  maxCompactionsPerTurn: number;
}

export interface ResolveAutoCompactLimitInput {
  contextWindowTokens: number | null;
  effectiveContextWindowTokens: number | null;
  userConfiguredLimit: number | null;
}

export interface ResolveAutoCompactLimitResult {
  effectiveContextWindowTokens: number | null;
  computedLimit: number | null;
}

export interface ContextCompactionMeta {
  trigger: ContextCompactionTrigger;
  beforeTokens: number;
  afterTokens: number;
  trimmedCount: number;
  usedFallback: boolean;
  summaryPreview: string;
  compactionCountInTurn: number;
  updatedAt: number;
}

export interface CompactHistoryLocallyInput {
  messages: ApiMessage[];
  trigger: ContextCompactionTrigger;
  keepRecentUserTokens: number;
  summaryMaxTokens: number;
  compactPrompt: string | null;
  estimateTokens: (messages: ApiMessage[]) => number;
  compactionCountInTurn: number;
  now?: number;
}

export interface CompactHistoryLocallyResult {
  nextMessages: ApiMessage[];
  meta: ContextCompactionMeta;
}

export interface FallbackTrimHistoryInput {
  messages: ApiMessage[];
  tokenLimit: number;
  trigger: ContextCompactionTrigger;
  estimateTokens: (messages: ApiMessage[]) => number;
  compactionCountInTurn: number;
  now?: number;
}

function normalizePositiveInt(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function normalizeNonNegativeInt(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : fallback;
}

function normalizeLimit(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function extractMessageText(message: ApiMessage): string {
  const { content } = message;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(part => part.type === 'text')
    .map(part => part.text.trim())
    .filter(Boolean)
    .join('\n');
}

function isSummaryMessage(message: ApiMessage): boolean {
  if (message.role !== 'user') return false;
  return extractMessageText(message).startsWith(`${SUMMARY_PREFIX}\n`);
}

function removeDuplicateSummaryMessages(messages: ApiMessage[]): ApiMessage[] {
  const summaryIndexes: number[] = [];
  messages.forEach((message, index) => {
    if (isSummaryMessage(message)) {
      summaryIndexes.push(index);
    }
  });
  if (summaryIndexes.length <= 1) {
    return [...messages];
  }
  const newestSummaryIndex = summaryIndexes[summaryIndexes.length - 1];
  return messages.filter((message, index) => !isSummaryMessage(message) || index === newestSummaryIndex);
}

function cloneMessage(message: ApiMessage): ApiMessage {
  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map(part =>
          part.type === 'text'
            ? { type: 'text', text: part.text }
            : { type: 'image_url', image_url: { url: part.image_url.url } },
        )
      : message.content,
    tool_calls: message.tool_calls?.map(toolCall => ({
      ...toolCall,
      function: {
        ...toolCall.function,
      },
    })),
  };
}

function collectRecentUserMessages(
  messages: ApiMessage[],
  keepRecentUserTokens: number,
  estimateTokens: (messages: ApiMessage[]) => number,
): ApiMessage[] {
  if (keepRecentUserTokens <= 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === 'user' && !isSummaryMessage(message)) {
        return [cloneMessage(message)];
      }
    }
    return [];
  }

  const selected: ApiMessage[] = [];
  let remaining = keepRecentUserTokens;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    if (isSummaryMessage(message)) continue;

    const candidate = cloneMessage(message);
    const tokenCost = estimateTokens([candidate]);
    if (tokenCost <= remaining || selected.length === 0) {
      selected.push(candidate);
      remaining = Math.max(0, remaining - tokenCost);
      if (remaining === 0) break;
    }
  }
  selected.reverse();
  return selected;
}

function collectTrailingToolExchange(messages: ApiMessage[]): ApiMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  let cursor = messages.length - 1;
  const trailingTools: ApiMessage[] = [];
  const trailingToolCallIds = new Set<string>();

  while (cursor >= 0) {
    const message = messages[cursor];
    if (message.role !== 'tool') break;
    trailingTools.unshift(cloneMessage(message));
    if (message.tool_call_id) {
      trailingToolCallIds.add(message.tool_call_id);
    }
    cursor--;
  }

  if (trailingTools.length === 0) return [];
  if (cursor < 0) return trailingTools;

  const assistantCandidate = messages[cursor];
  if (assistantCandidate.role !== 'assistant' || !assistantCandidate.tool_calls?.length) {
    return trailingTools;
  }

  const assistantToolCallIds = new Set(assistantCandidate.tool_calls.map(call => call.id));
  let hasMatchingToolCall = false;
  for (const toolCallId of trailingToolCallIds) {
    if (assistantToolCallIds.has(toolCallId)) {
      hasMatchingToolCall = true;
      break;
    }
  }

  if (!hasMatchingToolCall) {
    return trailingTools;
  }

  return [cloneMessage(assistantCandidate), ...trailingTools];
}

function normalizeSummaryText(summary: string, summaryMaxTokens: number): string {
  const maxChars = normalizePositiveInt(summaryMaxTokens, 256) * 4;
  const normalized = summary.trim().replace(/\n{3,}/g, '\n\n');
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trim()}...`;
}

function buildHeuristicSummary(messages: ApiMessage[], compactPrompt: string | null): string {
  const parts: string[] = [];
  const promptPrefix = typeof compactPrompt === 'string' ? compactPrompt.trim() : '';
  if (promptPrefix) {
    parts.push(`摘要策略: ${promptPrefix}`);
  }

  const samples: string[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = extractMessageText(message);
    if (!text) continue;
    const roleName = message.role === 'user' ? '用户' : '助手';
    samples.push(`${roleName}: ${text}`);
  }

  if (samples.length === 0) {
    return '历史消息较短，未提取到可摘要文本。';
  }

  const first = samples.slice(0, 2);
  const last = samples.slice(-4);
  parts.push('历史关键信息（节选）:');
  parts.push(...first);
  if (samples.length > first.length + last.length) {
    parts.push('...（中间内容已压缩）...');
  }
  for (const line of last) {
    if (!first.includes(line)) {
      parts.push(line);
    }
  }
  return parts.join('\n');
}

function findOldestRemovableBlock(messages: ApiMessage[]): { start: number; endExclusive: number } | null {
  // Keep the first system message.
  if (messages.length <= 2) return null;

  for (let start = 1; start < messages.length; start++) {
    const item = messages[start];
    if (item.role === 'system') continue;

    if (item.role === 'assistant' && item.tool_calls?.length) {
      const toolCallIds = new Set(item.tool_calls.map(call => call.id));
      let endExclusive = start + 1;
      while (endExclusive < messages.length) {
        const next = messages[endExclusive];
        if (next.role === 'tool' && next.tool_call_id && toolCallIds.has(next.tool_call_id)) {
          endExclusive++;
          continue;
        }
        break;
      }
      return { start, endExclusive };
    }

    return { start, endExclusive: start + 1 };
  }

  return null;
}

export function removeOrphanToolMessages(messages: ApiMessage[]): ApiMessage[] {
  const validToolCallIds = new Set<string>();
  const nextMessages: ApiMessage[] = [];

  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.id) validToolCallIds.add(toolCall.id);
      }
      nextMessages.push(cloneMessage(message));
      continue;
    }
    if (message.role === 'tool') {
      if (!message.tool_call_id || !validToolCallIds.has(message.tool_call_id)) {
        continue;
      }
      nextMessages.push(cloneMessage(message));
      continue;
    }
    nextMessages.push(cloneMessage(message));
  }

  return nextMessages;
}

export function resolveAutoCompactLimit(input: ResolveAutoCompactLimitInput): ResolveAutoCompactLimitResult {
  const contextWindowTokens = normalizeLimit(input.contextWindowTokens);
  const effectiveWindow = normalizeLimit(input.effectiveContextWindowTokens ?? contextWindowTokens);
  const userLimit = normalizeLimit(input.userConfiguredLimit);

  if (effectiveWindow === null && userLimit === null) {
    return {
      effectiveContextWindowTokens: null,
      computedLimit: null,
    };
  }

  if (effectiveWindow === null) {
    return {
      effectiveContextWindowTokens: null,
      computedLimit: userLimit,
    };
  }

  const defaultLimit = Math.max(1, Math.floor(effectiveWindow * 0.9));
  if (userLimit === null) {
    return {
      effectiveContextWindowTokens: effectiveWindow,
      computedLimit: defaultLimit,
    };
  }
  return {
    effectiveContextWindowTokens: effectiveWindow,
    computedLimit: Math.min(userLimit, defaultLimit),
  };
}

export function shouldCompactPreTurn(currentTokens: number, tokenLimit: number | null): boolean {
  if (tokenLimit === null) return false;
  return currentTokens >= tokenLimit;
}

export function shouldCompactMidTurn(currentTokens: number, tokenLimit: number | null): boolean {
  if (tokenLimit === null) return false;
  return currentTokens >= tokenLimit;
}

export function compactHistoryLocally(input: CompactHistoryLocallyInput): CompactHistoryLocallyResult {
  const safeMessages = removeDuplicateSummaryMessages(input.messages);
  const beforeTokens = input.estimateTokens(safeMessages);
  const keepRecentUserTokens = normalizeNonNegativeInt(input.keepRecentUserTokens, 4096);
  const summaryMaxTokens = normalizePositiveInt(input.summaryMaxTokens, 256);
  const summaryText = normalizeSummaryText(
    buildHeuristicSummary(safeMessages, input.compactPrompt),
    summaryMaxTokens,
  );

  const firstMessage = safeMessages[0];
  const systemMessages: ApiMessage[] = firstMessage?.role === 'system' ? [cloneMessage(firstMessage)] : [];
  const remainingMessages = firstMessage?.role === 'system' ? safeMessages.slice(1) : safeMessages.slice(0);
  const recentUsers = collectRecentUserMessages(remainingMessages, keepRecentUserTokens, input.estimateTokens);
  const trailingToolExchange = input.trigger === 'mid-turn'
    ? collectTrailingToolExchange(remainingMessages)
    : [];
  const summaryMessage: ApiMessage = {
    role: 'user',
    content: `${SUMMARY_PREFIX}\n${summaryText}`,
  };
  const nextMessages = removeOrphanToolMessages([
    ...systemMessages,
    summaryMessage,
    ...recentUsers,
    ...trailingToolExchange,
  ]);
  const afterTokens = input.estimateTokens(nextMessages);

  return {
    nextMessages,
    meta: {
      trigger: input.trigger,
      beforeTokens,
      afterTokens,
      trimmedCount: Math.max(0, safeMessages.length - nextMessages.length),
      usedFallback: false,
      summaryPreview: summaryText.slice(0, 200),
      compactionCountInTurn: normalizePositiveInt(input.compactionCountInTurn, 1),
      updatedAt: input.now ?? Date.now(),
    },
  };
}

export function fallbackTrimHistory(input: FallbackTrimHistoryInput): CompactHistoryLocallyResult {
  const tokenLimit = normalizePositiveInt(input.tokenLimit, 1);
  const working = input.messages.map(cloneMessage);
  let trimmedCount = 0;
  while (input.estimateTokens(working) > tokenLimit) {
    const block = findOldestRemovableBlock(working);
    if (!block) break;
    working.splice(block.start, block.endExclusive - block.start);
    trimmedCount += block.endExclusive - block.start;
    if (working.length <= 2) break;
  }
  const normalized = removeOrphanToolMessages(working);
  const beforeTokens = input.estimateTokens(input.messages);
  const afterTokens = input.estimateTokens(normalized);
  return {
    nextMessages: normalized,
    meta: {
      trigger: input.trigger,
      beforeTokens,
      afterTokens,
      trimmedCount,
      usedFallback: true,
      summaryPreview: '',
      compactionCountInTurn: normalizePositiveInt(input.compactionCountInTurn, 1),
      updatedAt: input.now ?? Date.now(),
    },
  };
}
