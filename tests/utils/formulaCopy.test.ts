import { describe, expect, it } from 'vitest';
import { extractFormulaText } from '../../utils/formulaCopy';

describe('extractFormulaText', () => {
  it('应优先提取 script[type^="math/tex"] 并去除首尾空白', () => {
    const result = extractFormulaText({
      html: `
        <math>
          <script type="math/tex; mode=display">
            \\frac{a}{b}
          </script>
          <annotation encoding="application/x-tex">x+y</annotation>
        </math>
      `,
      ariaLabel: 'aria-fallback',
      plainText: 'plain-fallback',
    });

    expect(result).toBe('\\frac{a}{b}');
  });

  it('应按 annotation -> ariaLabel -> plainText 顺序回退', () => {
    const fromAnnotation = extractFormulaText({
      html: `
        <math>
          <script type="math/tex">   </script>
          <annotation encoding="application/x-tex"> y^2 </annotation>
        </math>
      `,
      ariaLabel: 'aria-fallback',
      plainText: 'plain-fallback',
    });
    expect(fromAnnotation).toBe('y^2');

    const fromAria = extractFormulaText({
      html: '<div>no formula</div>',
      ariaLabel: ' z = 1 ',
      plainText: 'plain-fallback',
    });
    expect(fromAria).toBe('z = 1');

    const fromPlain = extractFormulaText({
      html: '<div>no formula</div>',
      ariaLabel: '   ',
      plainText: '  x + 1  ',
    });
    expect(fromPlain).toBe('x + 1');
  });

  it('所有输入都为空时应返回 null', () => {
    expect(
      extractFormulaText({
        html: '<script type="math/tex">   </script>',
        ariaLabel: ' ',
        plainText: '',
      }),
    ).toBeNull();
  });

  it('应解码常见 HTML 实体', () => {
    const fromHtml = extractFormulaText({
      html: '<script type="math/tex"> &lt;x&gt;&amp;&quot;&#39;&nbsp;y </script>',
    });
    expect(fromHtml).toBe('<x>&"\' y');

    const fromAria = extractFormulaText({
      ariaLabel: ' &lt;a&gt;&amp;b&nbsp; ',
    });
    expect(fromAria).toBe('<a>&b');
  });
});
