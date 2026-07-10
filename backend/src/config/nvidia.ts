import dotenv from 'dotenv';

// Load env variables
dotenv.config();

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface NimChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSchema[];
  toolChoice?: 'auto' | 'none' | 'required';
  jsonMode?: boolean;
}

export interface NimChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  raw: any;
}

const getNvidiaApiKey = (): string => {
  let apiKey = process.env.NVIDIA_API_KEY || '';
  apiKey = apiKey.trim().replace(/^['"]|['"]$/g, '');
  if (!apiKey || apiKey === 'your_nvidia_api_key_here') {
    throw new Error('NVIDIA_API_KEY is not defined in the environment variables.');
  }
  return apiKey;
};

const CHAT_HOSTS = [
  'https://integrate.api.nvidia.com/v1/chat/completions',
  'https://api.nvcf.nvidia.com/v1/chat/completions'
];

/**
 * Full-featured chat call against the NVIDIA NIM OpenAI-compatible endpoint.
 * Supports function/tool calling and JSON response mode so the agent loop can
 * take real actions instead of parsing free-form text.
 */
export const queryNvidiaNimChat = async (
  messages: ChatMessage[],
  options: NimChatOptions = {}
): Promise<NimChatResult> => {
  const apiKey = getNvidiaApiKey();
  const model = options.model || process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct';

  const body: Record<string, any> = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 1000
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice || 'auto';
  }

  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  let lastError: any = null;

  for (const url of CHAT_HOSTS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (response.ok) {
        const data: any = await response.json();
        const message = data.choices?.[0]?.message || {};
        return {
          content: message.content ?? null,
          toolCalls: message.tool_calls || [],
          raw: data
        };
      }

      const errText = await response.text();
      lastError = new Error(`NVIDIA NIM API at ${url} responded with status ${response.status}: ${errText}`);

      // If it is not a 404 (e.g. 401, 429, 500), throw immediately since it's a real auth/limit error
      if (response.status !== 404) {
        throw lastError;
      }
    } catch (error: any) {
      console.warn(`Warning: Host ${url} failed: ${error.message}`);
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to query NVIDIA NIM LLM on all available hosts.');
};

/**
 * Backwards-compatible simple text-completion helper. Communicates with the
 * OpenAI-compatible NVIDIA NIM inference endpoint and returns raw text content.
 * Default model: meta/llama-3.3-70b-instruct
 */
export const queryNvidiaNim = async (
  messages: ChatMessage[],
  model: string = process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct',
  temperature: number = 0.2,
  maxTokens: number = 1000
): Promise<string> => {
  const result = await queryNvidiaNimChat(messages, { model, temperature, maxTokens });
  return result.content || '';
};

/**
 * Requests embedding vectors from the NVIDIA NIM embeddings endpoint.
 * Used for semantic memory search instead of keyword/token overlap.
 */
export const queryNvidiaEmbedding = async (
  texts: string[],
  inputType: 'query' | 'passage' = 'passage',
  model: string = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5'
): Promise<number[][]> => {
  const apiKey = getNvidiaApiKey();
  const url = 'https://integrate.api.nvidia.com/v1/embeddings';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: texts,
      input_type: inputType,
      encoding_format: 'float'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`NVIDIA NIM embeddings API responded with status ${response.status}: ${errText}`);
  }

  const data: any = await response.json();
  return (data.data || [])
    .sort((a: any, b: any) => a.index - b.index)
    .map((item: any) => item.embedding as number[]);
};
