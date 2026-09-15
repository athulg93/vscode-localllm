import { OllamaChatResponse } from '../types';

/**
 * Thrown when a single newline-delimited JSON (NDJSON) line from an Ollama
 * streaming response body cannot be parsed. Carries the raw offending line so
 * callers can log it without the parser needing a logger dependency.
 */
export class NdjsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawLine: string,
    public readonly isTailChunk: boolean,
  ) {
    super(message);
    this.name = 'NdjsonParseError';
  }
}

export type NdjsonParseResult = { chunks: OllamaChatResponse[]; remaining: string };

/**
 * Consumes as many complete NDJSON lines as are available in `buffer` and
 * returns the parsed chunks plus any trailing partial line. Pass `flush: true`
 * once the stream has ended to parse a final line that has no trailing
 * newline. Pure function with no I/O so it can be unit tested directly.
 */
export function consumeNdjsonBuffer(buffer: string, flush = false): NdjsonParseResult {
  const chunks: OllamaChatResponse[] = [];
  const lines = buffer.split('\n');
  const remaining = flush ? '' : lines.pop() ?? '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    try {
      chunks.push(JSON.parse(line) as OllamaChatResponse);
    } catch {
      throw new NdjsonParseError(`Failed to parse streamed chunk: ${line}`, line, false);
    }
  }

  if (flush) {
    // Note: when the buffer is a single non-empty line, the loop above already
    // parsed (or threw for) it, so this block is only reached to re-confirm
    // success or handle multi-line edge cases. Callers should only pass a
    // buffer containing at most one leftover line when flushing.
    const line = buffer.trim();
    if (line) {
      chunks.length = 0;
      try {
        chunks.push(JSON.parse(line) as OllamaChatResponse);
      } catch {
        throw new NdjsonParseError(`Failed to parse streamed tail chunk: ${line}`, line, true);
      }
    }
  }

  return { chunks, remaining };
}
