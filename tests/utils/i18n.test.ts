import { describe, expect, it } from 'vitest';
import { getTranslations, t } from '../../utils/i18n';

describe('i18n 参数替换', () => {
  it('同一个占位符出现多次时应全部替换', () => {
    const zh = getTranslations('zh-CN');
    const original = zh.pageContentLimitHint;

    zh.pageContentLimitHint = '限制 {count}，再次 {count}，最后 {count}';
    try {
      expect(t('zh-CN', 'pageContentLimitHint', { count: 42 })).toBe('限制 42，再次 42，最后 42');
    } finally {
      zh.pageContentLimitHint = original;
    }
  });

  it('缺少参数时应保留原占位符文本', () => {
    const zh = getTranslations('zh-CN');
    const original = zh.toolCallLimitHint;

    zh.toolCallLimitHint = '阈值 {max}，当前 {current}';
    try {
      expect(t('zh-CN', 'toolCallLimitHint', { max: 10 })).toBe('阈值 10，当前 {current}');
    } finally {
      zh.toolCallLimitHint = original;
    }
  });
});
