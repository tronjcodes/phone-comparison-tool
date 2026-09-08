const OPENAI_DISABLED = (process.env.COMPARE_ASSISTANT_DISABLE_OPENAI || '').toLowerCase() === 'true';
const OPENAI_API_KEY = OPENAI_DISABLED ? undefined : process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
const HUGGINGFACE_BASE_URL = process.env.HUGGINGFACE_BASE_URL || 'https://router.huggingface.co/v1';
const HUGGINGFACE_MODEL = process.env.HUGGINGFACE_MODEL || 'Qwen/Qwen2.5-72B-Instruct:fastest';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

export const ASSISTANT_PROVIDER =
  process.env.COMPARE_ASSISTANT_PROVIDER ||
  (OPENAI_API_KEY ? 'openai' : HUGGINGFACE_API_KEY ? 'huggingface' : 'ollama');

const PROVIDER_REQUEST_TIMEOUT_MS = 20_000;
const HUGGINGFACE_REQUEST_TIMEOUT_MS = 40_000;

export type ProviderSource = 'openai' | 'huggingface' | 'ollama' | 'fallback';

export type ProviderResult = {
  answer: string;
  source: Exclude<ProviderSource, 'fallback'>;
  model: string;
};

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number, label: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const getTextFromOpenAIResponse = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const directOutput = (payload as { output_text?: unknown }).output_text;
  if (typeof directOutput === 'string' && directOutput.trim()) {
    return directOutput.trim();
  }

  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return null;
  }

  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }

      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim()) {
        chunks.push(text.trim());
      }
    }
  }

  return chunks.length > 0 ? chunks.join('\n\n') : null;
};

const getTextFromChatCompletionResponse = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return null;
  }

  const chunks: string[] = [];

  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') {
      continue;
    }

    const message = (choice as { message?: unknown }).message;
    if (!message || typeof message !== 'object') {
      continue;
    }

    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string' && content.trim()) {
      chunks.push(content.trim());
      continue;
    }

    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') {
          continue;
        }

        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim()) {
          chunks.push(text.trim());
        }
      }
    }
  }

  return chunks.length > 0 ? chunks.join('\n\n') : null;
};

const askOpenAI = async (prompt: string): Promise<ProviderResult> => {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const response = await fetchWithTimeout(
    `${OPENAI_BASE_URL}/responses`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: prompt,
        max_output_tokens: 1200,
        text: {
          format: {
            type: 'text',
          },
        },
      }),
    },
    PROVIDER_REQUEST_TIMEOUT_MS,
    'OpenAI'
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI request failed with status ${response.status}: ${details}`);
  }

  const payload = (await response.json()) as unknown;
  const answer = getTextFromOpenAIResponse(payload);

  if (!answer) {
    throw new Error('OpenAI returned an empty response');
  }

  return {
    answer,
    source: 'openai',
    model: OPENAI_MODEL,
  };
};

const askHuggingFace = async (prompt: string): Promise<ProviderResult> => {
  if (!HUGGINGFACE_API_KEY) {
    throw new Error('HF_TOKEN or HUGGINGFACE_API_KEY is not set');
  }

  const response = await fetchWithTimeout(
    `${HUGGINGFACE_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
      },
      body: JSON.stringify({
        model: HUGGINGFACE_MODEL,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 1000,
        temperature: 0.2,
      }),
    },
    HUGGINGFACE_REQUEST_TIMEOUT_MS,
    'Hugging Face'
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Hugging Face request failed with status ${response.status}: ${details}`);
  }

  const payload = (await response.json()) as unknown;
  const answer = getTextFromChatCompletionResponse(payload);

  if (!answer) {
    throw new Error('Hugging Face returned an empty response');
  }

  return {
    answer,
    source: 'huggingface',
    model: HUGGINGFACE_MODEL,
  };
};

const askOllama = async (prompt: string): Promise<ProviderResult> => {
  const response = await fetchWithTimeout(
    `${OLLAMA_BASE_URL}/api/chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        options: {
          num_predict: 1000,
          temperature: 0.2,
        },
      }),
    },
    PROVIDER_REQUEST_TIMEOUT_MS,
    'Ollama'
  );

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    message?: { content?: string };
  };

  const answer = payload.message?.content?.trim();
  if (!answer) {
    throw new Error('Ollama returned an empty response');
  }

  return {
    answer,
    source: 'ollama',
    model: OLLAMA_MODEL,
  };
};

export const getProviderOrder = (): ProviderSource[] => {
  if (ASSISTANT_PROVIDER === 'openai') {
    return ['openai', 'huggingface', 'ollama', 'fallback'];
  }

  if (ASSISTANT_PROVIDER === 'huggingface') {
    return ['huggingface', 'ollama', 'openai', 'fallback'];
  }

  if (ASSISTANT_PROVIDER === 'ollama') {
    return ['ollama', 'huggingface', 'openai', 'fallback'];
  }

  return ['openai', 'huggingface', 'ollama', 'fallback'];
};

/**
 * Tries each configured provider in order (per getProviderOrder), returning the
 * first success. Returns null if every real provider fails - callers supply
 * their own contextual fallback (e.g. a deterministic, non-AI answer) rather
 * than this module picking one, since that fallback differs per feature.
 */
export const runProviderChain = async (prompt: string): Promise<ProviderResult | null> => {
  const providerErrors: string[] = [];

  for (const provider of getProviderOrder()) {
    if (provider === 'fallback') {
      break;
    }

    try {
      return await (provider === 'openai' ? askOpenAI(prompt) : provider === 'huggingface' ? askHuggingFace(prompt) : askOllama(prompt));
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unknown ${provider} error`;
      console.warn(`[ai-providers] ${provider} provider failed: ${message}`);
      providerErrors.push(`${provider}: ${message}`);
    }
  }

  if (providerErrors.length > 0) {
    console.error(`[ai-providers] All providers failed: ${providerErrors.join(' | ')}`);
  }

  return null;
};
