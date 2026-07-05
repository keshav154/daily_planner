import dotenv from 'dotenv';

// Load env variables
dotenv.config();

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Communicates with the OpenAI-compatible NVIDIA NIM inference endpoint.
 * Default model: meta/llama-3.1-405b-instruct
 */
export const queryNvidiaNim = async (
  messages: ChatMessage[],
  model: string = 'meta/llama-3.1-405b-instruct',
  temperature: number = 0.2,
  maxTokens: number = 1000
): Promise<string> => {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || apiKey === 'your_nvidia_api_key_here') {
    throw new Error('NVIDIA_API_KEY is not defined in the environment variables.');
  }

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
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

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA NIM API responded with status ${response.status}: ${errText}`);
    }

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('Error querying NVIDIA NIM LLM:', error);
    throw error;
  }
};
