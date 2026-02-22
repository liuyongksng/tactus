import { describe, expect, it } from 'vitest';
import {
  escapeLikelyCurrencyDollars,
  normalizeMathDelimiters,
  renderMarkdownWithMath,
} from '../../utils/markdownMath';

describe('escapeLikelyCurrencyDollars', () => {
  it('应转义常见金额写法中的美元符号', () => {
    expect(escapeLikelyCurrencyDollars('预算是 $5 到 $10。')).toBe('预算是 \\$5 到 \\$10。');
    expect(escapeLikelyCurrencyDollars('价格区间是 $5-$10')).toBe('价格区间是 \\$5-\\$10');
  });

  it('不应转义合法公式中的美元分隔符', () => {
    expect(escapeLikelyCurrencyDollars('公式 $x+y$ 和 $5+3$')).toBe('公式 $x+y$ 和 $5+3$');
  });
});

describe('renderMarkdownWithMath', () => {
  it('应把 \\[...\\] 和 \\(...\\) 规范为 KaTeX 可渲染分隔符', () => {
    const normalized = normalizeMathDelimiters('\\[ x^2 + y^2 = z^2 \\] 与 \\(a+b\\)');
    expect(normalized).toBe('$$\nx^2 + y^2 = z^2\n$$ 与 $a+b$');
  });

  it('金额文本不应触发 KaTeX 渲染', () => {
    const html = renderMarkdownWithMath('预算是 $5 到 $10。');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5');
    expect(html).toContain('$10');
  });

  it('应支持 \\[...\\] 块级公式渲染', () => {
    const html = renderMarkdownWithMath('\\[\n\\int_a^b f(x)\\,dx = F(b)-F(a)\n\\]');
    expect(html).toContain('katex-display');
    expect(html).toContain('application/x-tex');
    expect(html).toContain('\\int_a^b f(x)\\,dx = F(b)-F(a)');
  });

  it('应支持 \\(...\\) 行内公式渲染', () => {
    const html = renderMarkdownWithMath('行内公式 \\(x+y\\) 正常显示。');
    expect(html).toContain('katex');
    expect(html).toContain('application/x-tex');
    expect(html).toContain('x+y');
  });

  it('公式文本应正常渲染为 KaTeX', () => {
    const html = renderMarkdownWithMath('公式是 $x+y$。');
    expect(html).toContain('katex');
    expect(html).toContain('application/x-tex');
    expect(html).toContain('x+y');
  });

  it('混合文本应只渲染真正的公式', () => {
    const html = renderMarkdownWithMath('预算 $5，公式 $x+y$，上限 $10。');
    expect(html).toContain('katex');
    expect(html).toContain('$5');
    expect(html).toContain('$10');
    const mathCount = (html.match(/application\/x-tex/g) ?? []).length;
    expect(mathCount).toBe(1);
  });
});
