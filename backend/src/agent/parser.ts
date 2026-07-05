import Anthropic from '@anthropic-ai/sdk';
import { queryNvidiaNim } from '../config/nvidia';

export interface ParsedTaskResult {
  title: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
  estimatedTime: number; // in minutes
  category: string;
  tags: string[];
}

// Instantiate Anthropic Client
const getAnthropicClient = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return null;
  }
  return new Anthropic({ apiKey });
};

// Fallback Parser if Claude is offline/unconfigured
export const parseFallback = (text: string): ParsedTaskResult => {
  const lowercase = text.toLowerCase();
  
  // Extract priority
  let priority: 'high' | 'medium' | 'low' = 'medium';
  if (lowercase.includes('high') || lowercase.includes('urgent') || lowercase.includes('p1')) {
    priority = 'high';
  } else if (lowercase.includes('low') || lowercase.includes('p3')) {
    priority = 'low';
  }

  // Extract estimated time (e.g. 1h, 30m, 2 hours)
  let estimatedTime = 30;
  const hourMatch = text.match(/(\d+)\s*(hour|hr|h)s?\b/i);
  const minMatch = text.match(/(\d+)\s*(min|m)s?\b/i);
  if (hourMatch) {
    estimatedTime = parseInt(hourMatch[1]) * 60;
  } else if (minMatch) {
    estimatedTime = parseInt(minMatch[1]);
  }

  // Extract category
  let category = 'Work';
  if (lowercase.includes('personal') || lowercase.includes('home') || lowercase.includes('family')) {
    category = 'Personal';
  } else if (lowercase.includes('health') || lowercase.includes('gym') || lowercase.includes('workout')) {
    category = 'Health';
  } else if (lowercase.includes('learning') || lowercase.includes('study') || lowercase.includes('read')) {
    category = 'Learning';
  }

  // Extract tags from hashtags (e.g. #report)
  const tags: string[] = [];
  const hashtagMatch = text.match(/#(\w+)/g);
  if (hashtagMatch) {
    hashtagMatch.forEach(tag => tags.push(tag.replace('#', '').toLowerCase()));
  }

  // Clean title: remove metadata words
  let title = text
    .replace(/#\w+/g, '') // remove hashtags
    .replace(/\b(high|medium|low|urgent)\s+priority\b/gi, '')
    .replace(/\b(priority)\s+(high|medium|low|urgent)\b/gi, '')
    .replace(/\b(by|at|on)\s+.*$/i, '') // strip due date phrases simplistically
    .trim();
  
  if (!title) {
    title = text;
  }

  // Due Date: default to end of today
  const dueDate = new Date();
  dueDate.setHours(18, 0, 0, 0); // 6:00 PM today as a reasonable default

  return {
    title,
    dueDate: dueDate.toISOString(),
    priority,
    estimatedTime,
    category,
    tags
  };
};

// Claude or NVIDIA NIM-based Natural Language Task Parser
export const parseNaturalLanguageTask = async (
  text: string,
  timezone: string = 'UTC'
): Promise<ParsedTaskResult> => {
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
  const client = getAnthropicClient();
  
  if (!client && !isNvidiaActive) {
    return parseFallback(text);
  }

  const currentLocalTime = new Date().toISOString();

  try {
    const prompt = `You are a productivity agent. Parse this natural language task input into a structured JSON task object:
"${text}"

Context:
- Current UTC local time: ${currentLocalTime}
- User Timezone: ${timezone}

You must return ONLY a JSON object matching this TypeScript interface, and no other text:
interface ParsedTaskResult {
  title: string; // The action-oriented title of the task
  dueDate: string; // ISO 8601 string, compute relative to current time/timezone. Default to end of current day (6 PM in user timezone) if not specified.
  priority: 'high' | 'medium' | 'low'; // Default is 'medium'.
  estimatedTime: number; // in minutes. Look for words like '1 hour', '30m', 'half day' (240m). Defaults to 30.
  category: string; // "Work", "Personal", "Health", "Learning", or "Finance". Default is "Work".
  tags: string[]; // extracted tags or keywords
}

Format output as raw JSON only. Do not wrap in markdown \`\`\`json block.`;

    let responseText = '';

    if (isNvidiaActive) {
      responseText = await queryNvidiaNim([
        { role: 'user', content: prompt }
      ], process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct', 0.1, 400);
    } else if (client) {
      const response = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      });
      responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    }
    
    // Clean JSON content block if the model wraps it
    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.slice(7);
    }
    if (cleanJson.endsWith('```')) {
      cleanJson = cleanJson.slice(0, -3);
    }
    
    const parsed: ParsedTaskResult = JSON.parse(cleanJson.trim());
    return parsed;
  } catch (error) {
    console.error('LLM API failed to parse task. Using fallback parser.', error);
    return parseFallback(text);
  }
};
