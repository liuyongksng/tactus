let openaiModulePromise: Promise<typeof import('openai')> | null = null;
let anthropicModulePromise: Promise<typeof import('../anthropic')> | null = null;
let geminiModulePromise: Promise<typeof import('../gemini')> | null = null;

export async function loadOpenAIModule(): Promise<typeof import('openai')> {
  if (!openaiModulePromise) {
    openaiModulePromise = import('openai').catch((error) => {
      openaiModulePromise = null;
      throw error;
    });
  }
  return openaiModulePromise;
}

export async function loadAnthropicModule(): Promise<typeof import('../anthropic')> {
  if (!anthropicModulePromise) {
    anthropicModulePromise = import('../anthropic').catch((error) => {
      anthropicModulePromise = null;
      throw error;
    });
  }
  return anthropicModulePromise;
}

export async function loadGeminiModule(): Promise<typeof import('../gemini')> {
  if (!geminiModulePromise) {
    geminiModulePromise = import('../gemini').catch((error) => {
      geminiModulePromise = null;
      throw error;
    });
  }
  return geminiModulePromise;
}
