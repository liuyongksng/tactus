import { describe, expect, it } from 'vitest';
import type { ApiMessage } from '../../utils/api';
import {
  SUMMARY_PREFIX,
  compactHistoryLocally,
  fallbackTrimHistory,
  removeOrphanToolMessages,
  resolveAutoCompactLimit,
  shouldCompactMidTurn,
  shouldCompactPreTurn,
} from '../../utils/localCompression';

function estimateTokens(messages: ApiMessage[]): number {
  return messages.reduce((total, message) => total + JSON.stringify(message).length, 0);
}

describe('localCompression', () => {
  it('resolveAutoCompactLimit 应使用 effective window 的 90% 并 clamp 用户阈值', () => {
    const auto = resolveAutoCompactLimit({
      contextWindowTokens: 100000,
      effectiveContextWindowTokens: 80000,
      userConfiguredLimit: null,
    });
    expect(auto.computedLimit).toBe(72000);

    const clamped = resolveAutoCompactLimit({
      contextWindowTokens: 100000,
      effectiveContextWindowTokens: 80000,
      userConfiguredLimit: 90000,
    });
    expect(clamped.computedLimit).toBe(72000);
  });

  it('compactHistoryLocally 应保留 system 与摘要前缀', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '第一段上下文内容很长很长很长。' },
      { role: 'assistant', content: '助手回复第一轮。' },
      { role: 'user', content: `${SUMMARY_PREFIX}\n旧摘要` },
      { role: 'user', content: '第二段上下文内容也很长很长。' },
      { role: 'assistant', content: '助手回复第二轮。' },
    ];

    const result = compactHistoryLocally({
      messages,
      trigger: 'pre-turn',
      keepRecentUserTokens: 120,
      summaryMaxTokens: 64,
      compactPrompt: '保留关键事实',
      estimateTokens,
      compactionCountInTurn: 1,
    });

    expect(result.nextMessages[0]?.role).toBe('system');
    const summaryMessage = result.nextMessages.find(
      message => message.role === 'user' && typeof message.content === 'string' && message.content.startsWith(SUMMARY_PREFIX),
    );
    expect(summaryMessage).toBeDefined();
    expect(result.meta.usedFallback).toBe(false);
    expect(result.meta.trigger).toBe('pre-turn');
  });

  it('pre-turn 压缩后应保证最后一条仍是最新用户消息（避免被摘要顶掉）', () => {
    const latestUser = '这才是本轮真正的问题';
    const messages: ApiMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '旧历史'.repeat(30) },
      { role: 'assistant', content: '旧回复'.repeat(20) },
      { role: 'user', content: latestUser },
    ];

    const result = compactHistoryLocally({
      messages,
      trigger: 'pre-turn',
      keepRecentUserTokens: 0,
      summaryMaxTokens: 64,
      compactPrompt: null,
      estimateTokens,
      compactionCountInTurn: 1,
    });

    const lastMessage = result.nextMessages[result.nextMessages.length - 1];
    expect(lastMessage?.role).toBe('user');
    expect(lastMessage?.content).toBe(latestUser);
  });

  it('mid-turn 压缩后应保留最近工具调用块（assistant tool_calls + tool 结果）', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '先做步骤一' },
      {
        role: 'assistant',
        content: '正在调用工具',
        tool_calls: [
          {
            id: 'call-latest',
            type: 'function',
            function: { name: 'extract_page_content', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', content: '{"result":"ok"}', tool_call_id: 'call-latest', name: 'extract_page_content' },
    ];

    const result = compactHistoryLocally({
      messages,
      trigger: 'mid-turn',
      keepRecentUserTokens: 0,
      summaryMaxTokens: 64,
      compactPrompt: null,
      estimateTokens,
      compactionCountInTurn: 1,
    });

    const lastMessage = result.nextMessages[result.nextMessages.length - 1];
    expect(lastMessage?.role).toBe('tool');
    expect(lastMessage?.tool_call_id).toBe('call-latest');
    expect(
      result.nextMessages.some(
        message =>
          message.role === 'assistant'
          && message.tool_calls?.some(call => call.id === 'call-latest'),
      ),
    ).toBe(true);
  });

  it('removeOrphanToolMessages 应清理孤儿 tool 消息', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'system prompt' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'extract_page_content', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', content: '{"ok":true}', tool_call_id: 'call-1', name: 'extract_page_content' },
      { role: 'tool', content: '{"orphan":true}', tool_call_id: 'call-missing', name: 'extract_page_content' },
    ];

    const normalized = removeOrphanToolMessages(messages);
    expect(normalized.some(message => message.role === 'tool' && message.tool_call_id === 'call-missing')).toBe(false);
  });

  it('fallbackTrimHistory 应按工具块裁剪并保持工具配对', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'system prompt' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-old',
            type: 'function',
            function: { name: 'extract_page_content', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', content: '{"old":true}', tool_call_id: 'call-old', name: 'extract_page_content' },
      { role: 'user', content: '最近用户消息' },
      { role: 'assistant', content: '最近助手消息' },
    ];

    const result = fallbackTrimHistory({
      messages,
      tokenLimit: 120,
      trigger: 'mid-turn',
      estimateTokens,
      compactionCountInTurn: 1,
    });

    const hasOrphanTool = result.nextMessages.some((message) => {
      if (message.role !== 'tool') return false;
      return !result.nextMessages.some(
        candidate =>
          candidate.role === 'assistant'
          && candidate.tool_calls?.some(call => call.id === message.tool_call_id),
      );
    });
    expect(hasOrphanTool).toBe(false);
    expect(result.meta.usedFallback).toBe(true);
  });

  it('shouldCompactPreTurn / shouldCompactMidTurn 应正确判定阈值', () => {
    expect(shouldCompactPreTurn(100, 100)).toBe(true);
    expect(shouldCompactPreTurn(99, 100)).toBe(false);
    expect(shouldCompactMidTurn(100, 100)).toBe(true);
    expect(shouldCompactMidTurn(80, null)).toBe(false);
  });
});
