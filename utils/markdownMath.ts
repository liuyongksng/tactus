import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';

// 匹配常见金额写法：$5 / $10.5 / $1,000 / $5-$10
const LIKELY_CURRENCY_PATTERN = /\$(\d[\d,]*(?:\.\d+)?)(?=(?:\s|$|[，。,.!?;:：）)\]】」』、]|-\$))/g;
const DISPLAY_BRACKET_MATH_PATTERN = /(?<!\\)\\\[\s*([\s\S]*?)\s*(?<!\\)\\\]/g;
const INLINE_PAREN_MATH_PATTERN = /(?<!\\)\\\((.+?)(?<!\\)\\\)/g;

const markdownParser = new Marked({
  breaks: true,
  gfm: true,
});

markdownParser.use(
  markedKatex({
    throwOnError: false,
    nonStandard: true,
  }),
);

/**
 * 转义更像“金额”的美元符号，避免被 KaTeX 当成公式起止符。
 *
 * Args:
 *   input: 原始 markdown 文本
 *
 * Returns:
 *   处理后的文本（仅金额场景会把 `$` 变成 `\$`）
 */
export function escapeLikelyCurrencyDollars(input: string): string {
  if (!input || !input.includes('$')) {
    return input;
  }
  return input.replace(LIKELY_CURRENCY_PATTERN, (_match, amount: string) => `\\$${amount}`);
}

/**
 * 统一规范数学分隔符，兼容 `\\[...\\]` 与 `\\(...\\)` 写法。
 *
 * Args:
 *   input: 原始 markdown 文本
 *
 * Returns:
 *   转成 `$...$`/`$$...$$` 后的文本
 */
export function normalizeMathDelimiters(input: string): string {
  if (!input || !input.includes('\\')) {
    return input;
  }

  const normalizedDisplay = input.replace(
    DISPLAY_BRACKET_MATH_PATTERN,
    (_match, expression: string) => `$$\n${expression.trim()}\n$$`,
  );
  return normalizedDisplay.replace(
    INLINE_PAREN_MATH_PATTERN,
    (_match, expression: string) => `$${expression.trim()}$`,
  );
}

/**
 * 统一的 markdown + LaTeX 渲染入口。
 *
 * Args:
 *   content: 消息原文
 *
 * Returns:
 *   渲染后的 HTML
 */
export function renderMarkdownWithMath(content: string): string {
  if (!content) {
    return '';
  }
  const normalizedContent = escapeLikelyCurrencyDollars(normalizeMathDelimiters(content));
  return markdownParser.parse(normalizedContent) as string;
}
