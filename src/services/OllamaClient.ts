/// <reference lib="dom" />

import * as vscode from 'vscode';

import { HUMAN_READABLE_SYSTEM_PROMPT, OLLAMA_REQUEST_TIMEOUT_MS } from '../constants';
import { OllamaChatResponse, OllamaMessage, OllamaTagResponse, OllamaToolCall } from '../types';
import { Logger } from '../core/contracts';

type PromptOptions = {
  systemPrompt?: string;
  token?: vscode.CancellationToken;
};

type StreamPromptOptions = PromptOptions & {
  onToken: (chunk: string) => void;
};

export type OllamaTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type ToolPromptOptions = PromptOptions & {
  tools: OllamaTool[];
  executeTool: (name: string, arguments_: Record<string, unknown>) => Promise<string>;
  maxToolCalls?: number;
};

export class OllamaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly outputChannel: Logger,
  ) {}

  async listModels(): Promise<string[]> {
    const endpoint = `${this.baseUrl}/api/tags`;
    this.outputChannel.appendLine(`[Ollama] Listing models from ${endpoint}`);
    let response: Response;
    try {
      response = await fetch(endpoint);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[Ollama] Model listing request failed at ${endpoint}: ${details}`);
      throw new Error(`Could not connect to Ollama at ${this.baseUrl}. Check that Ollama is running and the Local Ollama URL is correct.`);
    }

    if (!response.ok) {
      throw new Error(`Unable to reach Ollama at ${endpoint}: ${response.status} ${response.statusText}.`);
    }

    const body = (await response.json()) as OllamaTagResponse;
    const models = (body.models ?? []).map((model) => model.name ?? '').filter(Boolean);
    this.outputChannel.appendLine(`[Ollama] Model listing returned ${models.length} model(s).`);
    return models;
  }

  async ensureModelExists(model: string): Promise<string> {
    const models = await this.listModels();
    if (!models.includes(model)) {
      throw new Error(`The configured model "${model}" is not available on the local Ollama server. Available models: ${models.join(', ') || 'none'}.`);
    }

    return model;
  }

  async sendPrompt(model: string, prompt: string, temperature: number, options: PromptOptions = {}): Promise<string> {
    this.outputChannel.appendLine(`[Ollama] Sending non-stream request with model ${model}; prompt length ${prompt.length}.`);
    const response = await this.fetchChat(model, temperature, {
      stream: false,
      messages: this.buildMessages(prompt, options.systemPrompt),
      token: options.token,
    });

    const data = (await response.json()) as OllamaChatResponse;
    if (data.error) {
      throw new Error(data.error);
    }

    return data.message?.content ?? 'No response returned from Ollama.';
  }

  async sendPromptWithTools(model: string, prompt: string, temperature: number, options: ToolPromptOptions): Promise<string> {
    const messages: OllamaMessage[] = this.buildMessages(prompt, options.systemPrompt);
    const maxToolCalls = options.maxToolCalls ?? 8;
    let toolCallCount = 0;

    while (true) {
      this.outputChannel.appendLine(`[Ollama] Sending tool request with model ${model}; prompt length ${prompt.length}; tool calls used ${toolCallCount}.`);
      const response = await this.fetchChat(model, temperature, {
        stream: false,
        messages,
        tools: options.tools,
        token: options.token,
      });
      const data = (await response.json()) as OllamaChatResponse;
      if (data.error) {
        throw new Error(data.error);
      }

      const message = data.message;
      const toolCalls = message?.tool_calls ?? this.parseTextToolCall(message?.content);
      if (toolCalls.length === 0) {
        return message?.content ?? 'No response returned from Ollama.';
      }

      messages.push({
        role: 'assistant',
        content: message?.content ?? '',
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        toolCallCount += 1;
        if (toolCallCount > maxToolCalls) {
          throw new Error(`Ollama requested more than ${maxToolCalls} file operations while planning the edit.`);
        }

        const name = toolCall.function?.name ?? '';
        const toolResult = await options.executeTool(name, toolCall.function?.arguments ?? {});
        messages.push({ role: 'tool', content: toolResult });
      }
    }
  }

  async streamPrompt(model: string, prompt: string, temperature: number, options: StreamPromptOptions): Promise<string> {
    this.outputChannel.appendLine(`[Ollama] Sending stream request with model ${model}; prompt length ${prompt.length}.`);
    const response = await this.fetchChat(model, temperature, {
      stream: true,
      messages: this.buildMessages(prompt, options.systemPrompt),
      token: options.token,
    });

    if (!response.body) {
      const data = (await response.json()) as OllamaChatResponse;
      if (data.error) {
        throw new Error(data.error);
      }

      const text = data.message?.content ?? 'No response returned from Ollama.';
      options.onToken(text);
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    try {
      while (true) {
        if (options.token?.isCancellationRequested) {
          return fullText;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parsed = this.consumeStreamBuffer(buffer);
        buffer = parsed.remaining;

        for (const chunk of parsed.chunks) {
          if (chunk.error) {
            throw new Error(chunk.error);
          }

          const piece = chunk.message?.content ?? '';
          if (!piece) {
            continue;
          }

          fullText += piece;
          options.onToken(piece);
        }
      }

      buffer += decoder.decode();
      const tail = this.consumeStreamBuffer(buffer, true);
      for (const chunk of tail.chunks) {
        if (chunk.error) {
          throw new Error(chunk.error);
        }

        const piece = chunk.message?.content ?? '';
        if (!piece) {
          continue;
        }

        fullText += piece;
        options.onToken(piece);
      }
    } finally {
      reader.releaseLock();
    }

    const responseText = fullText || 'No response returned from Ollama.';
    this.outputChannel.appendLine(`[Ollama] Stream completed; response length ${responseText.length}.`);
    return responseText;
  }

  private buildMessages(prompt: string, systemPrompt?: string): OllamaMessage[] {
    return [
      { role: 'system', content: systemPrompt ?? HUMAN_READABLE_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];
  }

  private parseTextToolCall(content: string | undefined): OllamaToolCall[] {
    if (!content) {
      return [];
    }

    try {
      const parsed = JSON.parse(content) as { name?: unknown; arguments?: unknown };
      if (typeof parsed.name !== 'string' || !parsed.name || !parsed.arguments || typeof parsed.arguments !== 'object' || Array.isArray(parsed.arguments)) {
        return [];
      }

      return [{
        function: {
          name: parsed.name,
          arguments: parsed.arguments as Record<string, unknown>,
        },
      }];
    } catch {
      return [];
    }
  }

  private async fetchChat(
    model: string,
    temperature: number,
    options: { stream: boolean; messages: OllamaMessage[]; tools?: OllamaTool[]; token?: vscode.CancellationToken },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);
    const subscription = options.token?.onCancellationRequested(() => controller.abort());

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: options.stream,
          options: { temperature },
          messages: options.messages,
          ...(options.tools ? { tools: options.tools } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText} ${text}`.trim());
      }

      return response;
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = options.token?.isCancellationRequested ? 'cancelled by user' : `timed out after ${OLLAMA_REQUEST_TIMEOUT_MS / 1000} seconds`;
        this.outputChannel.appendLine(`[Ollama] Request aborted: ${reason}.`);
        throw new Error(`Ollama request ${reason}. The prompt may be too large or the model may still be loading.`);
      }

      const details = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[Ollama] Request failed: ${details}`);
      if (details.toLowerCase().includes('fetch failed')) {
        throw new Error(`Could not connect to Ollama at ${this.baseUrl}. The server may have closed the request while processing the large prompt.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      subscription?.dispose();
    }
  }

  private consumeStreamBuffer(buffer: string, flush = false): { chunks: OllamaChatResponse[]; remaining: string } {
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
      } catch (error) {
        this.outputChannel.appendLine(`[Ollama] Failed to parse streamed chunk: ${line}`);
        throw error;
      }
    }

    if (flush) {
      const line = buffer.trim();
      if (line) {
        chunks.length = 0;
        try {
          chunks.push(JSON.parse(line) as OllamaChatResponse);
        } catch (error) {
          this.outputChannel.appendLine(`[Ollama] Failed to parse streamed tail chunk: ${line}`);
          throw error;
        }
      }
    }

    return { chunks, remaining };
  }
}