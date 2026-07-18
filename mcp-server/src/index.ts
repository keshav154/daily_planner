#!/usr/bin/env node
/**
 * Kortex MCP server — exposes the Kortex daily-planner to a coding agent so you
 * can add and track tasks, and recall past work, without leaving your editor.
 *
 * It's a thin stdio adapter over the existing API-key-authenticated Kortex
 * integration API (backend/src/routes/integration.ts). No business logic lives
 * here — each tool just calls one endpoint with your personal API key.
 *
 * Env:
 *   KORTEX_API_KEY   (required) — your key from the app sidebar "Copy API Key".
 *   KORTEX_BASE_URL  (optional) — defaults to the hosted backend.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';

const API_KEY = process.env.KORTEX_API_KEY;
const BASE_URL = (process.env.KORTEX_BASE_URL || 'https://daily-planner-00g2.onrender.com/api').replace(/\/$/, '');

if (!API_KEY) {
  // Write to stderr (stdout is the MCP protocol channel) and exit.
  console.error('[kortex-mcp] KORTEX_API_KEY environment variable is required.');
  process.exit(1);
}

async function kortexFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY as string,
      ...(init.headers || {})
    }
  });
  const raw = await res.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = raw; }
  if (!res.ok) {
    const msg = typeof data === 'string' ? data : (data?.error || JSON.stringify(data));
    throw new Error(`Kortex API ${res.status}: ${msg}`);
  }
  return data;
}

const TOOLS: Tool[] = [
  {
    name: 'add_task',
    description: 'Add a task to Kortex. Pass natural-language `text` (parsed into a task) OR structured fields (title required if not using text).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Natural-language task, e.g. "deploy EPS on cusdemo tomorrow, high priority"' },
        title: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        dueDate: { type: 'string', description: 'ISO date, e.g. 2026-07-20' },
        estimatedTime: { type: 'number', description: 'Minutes' },
        category: { type: 'string' }
      }
    }
  },
  {
    name: 'list_today_tasks',
    description: "Get today's active tasks and goals from Kortex (what's on your plate right now).",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'complete_task',
    description: 'Mark a Kortex task done. Optionally record how it was resolved and how long it took.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task id (from list_today_tasks)' },
        resolution: { type: 'string', description: 'What was done / how it was resolved' },
        actualTime: { type: 'number', description: 'Actual minutes spent' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'remember_note',
    description: 'Save a durable note/fact to your Kortex second brain (a decision, a command, a reference).',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        category: { type: 'string' }
      },
      required: ['content']
    }
  },
  {
    name: 'search_history',
    description: 'Recall what you did in the past — searches your Kortex work history (completed-task logs, resolutions, saved notes). E.g. "what did I do about the EPS deployment?"',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Max results (default 8)' }
      },
      required: ['query']
    }
  },
  {
    name: 'smart_capture',
    description: 'Send a free-form request to the Kortex agent (full reasoning): it will create tasks, remember facts, or answer, as appropriate. Use for complex asks like "I have an exam Aug 20, add it and adjust my plan".',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  }
];

async function runTool(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
    case 'add_task': {
      if (args.text) {
        return kortexFetch('/integration/task', { method: 'POST', body: JSON.stringify({ text: args.text }) });
      }
      if (!args.title) throw new Error('Provide either `text` or `title`.');
      const taskJson: Record<string, any> = { title: args.title };
      if (args.priority) taskJson.priority = args.priority;
      if (args.dueDate) taskJson.dueDate = args.dueDate;
      if (args.estimatedTime) taskJson.estimatedTime = args.estimatedTime;
      if (args.category) taskJson.category = args.category;
      return kortexFetch('/integration/task', { method: 'POST', body: JSON.stringify({ taskJson }) });
    }
    case 'list_today_tasks':
      return kortexFetch('/integration/context');
    case 'complete_task': {
      if (!args.taskId) throw new Error('taskId is required.');
      const body: Record<string, any> = {};
      if (args.resolution) body.resolution = args.resolution;
      if (args.actualTime) body.actualTime = args.actualTime;
      return kortexFetch(`/integration/task/${args.taskId}/complete`, { method: 'POST', body: JSON.stringify(body) });
    }
    case 'remember_note': {
      if (!args.content) throw new Error('content is required.');
      return kortexFetch('/integration/memory', {
        method: 'POST',
        body: JSON.stringify({ content: args.content, category: args.category })
      });
    }
    case 'search_history': {
      if (!args.query) throw new Error('query is required.');
      const params = new URLSearchParams({ query: args.query, limit: String(args.limit || 8) });
      return kortexFetch(`/integration/recall?${params.toString()}`);
    }
    case 'smart_capture': {
      if (!args.text) throw new Error('text is required.');
      return kortexFetch('/integration/smart-capture', { method: 'POST', body: JSON.stringify({ text: args.text }) });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'kortex', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const result = await runTool(name, (args || {}) as Record<string, any>);
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[kortex-mcp] running (stdio). Base URL:', BASE_URL);
}

main().catch((err) => {
  console.error('[kortex-mcp] fatal:', err);
  process.exit(1);
});
