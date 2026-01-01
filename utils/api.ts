import type { AIProvider, ChatMessage } from './storage';

export interface ModelInfo {
  id: string;
  name?: string;
}

export async function fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/v1/models`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    
    const data = await response.json();
    return (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
    }));
  } catch (error) {
    console.error('Error fetching models:', error);
    return [];
  }
}

export async function* streamChat(
  provider: AIProvider,
  messages: ChatMessage[],
  pageContent?: string
): AsyncGenerator<string, void, unknown> {
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

  const apiMessages = [
    { role: 'system', content: systemMessage },
    ...messages.map(m => ({
      role: m.role,
      content: m.quote ? `[Quote: "${m.quote}"]\n\n${m.content}` : m.content,
    })),
  ];

  const url = `${provider.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.selectedModel,
      messages: apiMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {}
      }
    }
  }
}
