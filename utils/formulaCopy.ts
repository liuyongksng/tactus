export interface FormulaCopyInput {
  html?: string | null;
  ariaLabel?: string | null;
  plainText?: string | null;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(lt|gt|amp|quot|#39|nbsp);/gi, (entity) => {
    switch (entity.toLowerCase()) {
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&amp;':
        return '&';
      case '&quot;':
        return '"';
      case '&#39;':
        return '\'';
      case '&nbsp;':
        return ' ';
      default:
        return entity;
    }
  });
}

function normalizeFormulaText(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = decodeHtmlEntities(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function getAttributeValue(attributes: string, attributeName: string): string | null {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`' + `]+))`,
    'i',
  );
  const match = attributes.match(pattern);
  if (!match) {
    return null;
  }
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function extractTagContent(
  html: string,
  tagName: 'script' | 'annotation',
  attributeName: string,
  predicate: (value: string) => boolean,
): string | null {
  const tagPattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  for (const match of html.matchAll(tagPattern)) {
    const attributes = match[1] ?? '';
    const attributeValue = getAttributeValue(attributes, attributeName);
    if (!attributeValue || !predicate(attributeValue)) {
      continue;
    }
    return match[2] ?? '';
  }
  return null;
}

function extractFromHtml(html: string): Array<string | null> {
  return [
    extractTagContent(html, 'script', 'type', (value) =>
      value.trim().toLowerCase().startsWith('math/tex'),
    ),
    extractTagContent(html, 'annotation', 'encoding', (value) =>
      value.trim().toLowerCase() === 'application/x-tex',
    ),
  ];
}

export function extractFormulaText(input: FormulaCopyInput): string | null {
  const html = input.html ?? '';
  const candidates: Array<string | null | undefined> = [
    ...extractFromHtml(html),
    input.ariaLabel,
    input.plainText,
  ];

  for (const candidate of candidates) {
    const result = normalizeFormulaText(candidate);
    if (result !== null) {
      return result;
    }
  }
  return null;
}
