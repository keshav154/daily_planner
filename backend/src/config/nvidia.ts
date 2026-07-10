import dotenv from 'dotenv';

// Load env variables
dotenv.config();

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Communicates with the OpenAI-compatible NVIDIA NIM inference endpoint.
 * Default model: meta/llama-3.1-70b-instruct
 */
export const queryNvidiaNim = async (
  messages: ChatMessage[],
  model: string = process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
  temperature: number = 0.2,
  maxTokens: number = 1000
): Promise<string> => {
  // Trim quotes and whitespace from key
  let apiKey = process.env.NVIDIA_API_KEY || '';
  apiKey = apiKey.trim().replace(/^['"]|['"]$/g, '');

  if (!apiKey || apiKey === 'your_nvidia_api_key_here') {
    throw new Error('NVIDIA_API_KEY is not defined in the environment variables.');
  }

  const hosts = [
    'https://integrate.api.nvidia.com/v1/chat/completions',
    'https://api.nvcf.nvidia.com/v1/chat/completions'
  ];

  let lastError: any = null;

  for (const url of hosts) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens
        })
      });

      if (response.ok) {
        const data: any = await response.json();
        return data.choices?.[0]?.message?.content || '';
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
