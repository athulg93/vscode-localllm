import { OllamaToolCall } from '../types';
import { extractJsonBlock } from './EditPlanParser';

/**
 * Some models emit a tool call as plain JSON text instead of using the native
 * `tool_calls` response field. This parses that fallback shape. Pure function
 * with no I/O so it can be unit tested directly.
 */
export function parseTextToolCall(content: string | undefined): OllamaToolCall[] {
  if (!content) {
    return [];
  }

  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const candidates: unknown[] = [];
  try {
    const parsed = JSON.parse(normalized) as unknown;
    candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  } catch {
    try {
      const parsed = JSON.parse(extractJsonBlock(normalized)) as unknown;
      candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // Continue with line-delimited fallback parsing below.
    }

    if (candidates.length === 0) {
      for (const line of normalized.split(/\r?\n/)) {
        try {
          candidates.push(JSON.parse(line.trim()) as unknown);
        } catch {
          continue;
        }
      }
    }
  }

  return candidates.flatMap((candidate) => {
    const parsed = candidate as {
      name?: unknown;
      arguments?: unknown;
      parameters?: unknown;
      function?: { name?: unknown; arguments?: unknown; parameters?: unknown };
    };
    const functionShape = parsed.function;
    const name = typeof parsed.name === 'string' ? parsed.name : functionShape?.name;
    const arguments_ = parsed.arguments ?? parsed.parameters ?? functionShape?.arguments ?? functionShape?.parameters;
    if (typeof name !== 'string' || !name || !arguments_ || typeof arguments_ !== 'object' || Array.isArray(arguments_)) {
      return [];
    }

    return [{
      function: {
        name,
        arguments: arguments_ as Record<string, unknown>,
      },
    }];
  });
}

export function parseXmlToolCall(content: string | undefined): OllamaToolCall[] {
  if (!content) {
    return [];
  }

  const calls: OllamaToolCall[] = [];
  const callPattern = /<tool_call>\s*(?:<name>([^<]+)<\/name>)?\s*(?:<arguments>([\s\S]*?)<\/arguments>)?\s*<\/tool_call>/gi;
  for (const match of content.matchAll(callPattern)) {
    const name = match[1]?.trim();
    const rawArguments = match[2]?.trim() ?? '{}';
    if (!name) {
      continue;
    }

    try {
      const arguments_ = JSON.parse(rawArguments) as unknown;
      if (typeof arguments_ === 'object' && arguments_ !== null && !Array.isArray(arguments_)) {
        calls.push({ function: { name, arguments: arguments_ as Record<string, unknown> } });
      }
    } catch {
      continue;
    }
  }

  return calls;
}
