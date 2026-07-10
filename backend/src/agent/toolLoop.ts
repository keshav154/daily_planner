import Anthropic from '@anthropic-ai/sdk';
import { queryNvidiaNimChat, ChatMessage } from '../config/nvidia';
import { AGENT_TOOLS, executeAgentTool, ToolContext, ToolExecutionResult } from './tools';

export interface ToolLoopResult {
  rationale: string;
  executedLogs: string[];
  suggestions: Array<{ id: string; actionType: string; description: string; details: Record<string, any> }>;
}

const MAX_ITERATIONS = 6;

function synthesizeFallbackRationale(executedLogs: string[]): string {
  return executedLogs.length > 0
    ? `Autonomous agent executed ${executedLogs.length} action(s): ${executedLogs.join('; ')}`
    : 'Autonomous agent completed a review cycle with no actions needed.';
}

/**
 * Runs a real Think-Act-Observe tool-calling loop against NVIDIA NIM
 * (OpenAI-compatible function calling). The model decides which tools to
 * call, sees the results, and can call more tools in response — instead of
 * emitting a single one-shot JSON blob.
 */
export async function runNimToolLoop(
  systemPrompt: string,
  userPrompt: string,
  ctx: ToolContext
): Promise<ToolLoopResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const executedLogs: string[] = [];
  const suggestions: ToolLoopResult['suggestions'] = [];
  let rationale = '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await queryNvidiaNimChat(messages, {
      tools: AGENT_TOOLS,
      toolChoice: 'auto',
      temperature: 0.3,
      maxTokens: 1200
    });

    if (response.toolCalls && response.toolCalls.length > 0) {
      // This NIM-hosted model's chat template only supports a single tool call
      // per assistant turn (returning more than one causes a 500 on the *next*
      // request, once that turn is replayed back as history). If the model
      // proposes several at once, honor only the first — it will see that
      // tool's result and can propose the next one on a later turn.
      const call = response.toolCalls[0];
      messages.push({ role: 'assistant', content: response.content, tool_calls: [call] });

      let args: any = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        // leave args empty; executor will report a missing-field error
      }

      let execResult: ToolExecutionResult;
      try {
        execResult = await executeAgentTool(call.function.name, args, ctx);
      } catch (err: any) {
        execResult = { result: `Error executing ${call.function.name}: ${err.message}` };
      }

      if (execResult.suggestion) suggestions.push(execResult.suggestion);
      if (!execResult.result.startsWith('Error')) executedLogs.push(execResult.result);

      messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: execResult.result });

      if (response.content) rationale = response.content;
      continue;
    }

    rationale = response.content || rationale;
    break;
  }

  if (!rationale) rationale = synthesizeFallbackRationale(executedLogs);
  return { rationale, executedLogs, suggestions };
}

function toAnthropicTools(): Anthropic.Tool[] {
  return AGENT_TOOLS.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as any
  }));
}

/**
 * Same Think-Act-Observe loop, backed by Anthropic's native tool-use API.
 * Used as an automatic fallback when NVIDIA NIM is unavailable.
 */
export async function runAnthropicToolLoop(
  client: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  ctx: ToolContext
): Promise<ToolLoopResult> {
  const tools = toAnthropicTools();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];

  const executedLogs: string[] = [];
  const suggestions: ToolLoopResult['suggestions'] = [];
  let rationale = '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 1200,
      system: systemPrompt,
      tools,
      messages
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    if (toolUseBlocks.length > 0) {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        let execResult: ToolExecutionResult;
        try {
          execResult = await executeAgentTool(block.name, block.input as any, ctx);
        } catch (err: any) {
          execResult = { result: `Error executing ${block.name}: ${err.message}` };
        }

        if (execResult.suggestion) suggestions.push(execResult.suggestion);
        if (!execResult.result.startsWith('Error')) executedLogs.push(execResult.result);

        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: execResult.result });
      }
      messages.push({ role: 'user', content: toolResults });
      if (textContent) rationale = textContent;
      continue;
    }

    rationale = textContent || rationale;
    break;
  }

  if (!rationale) rationale = synthesizeFallbackRationale(executedLogs);
  return { rationale, executedLogs, suggestions };
}
