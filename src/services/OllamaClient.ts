/// <reference lib="dom" />

import * as vscode from 'vscode';

import { HUMAN_READABLE_SYSTEM_PROMPT } from '../constants';
import { OllamaChatResponse, OllamaMessage, OllamaTagResponse } from '../types';

type PromptOptions = {
  systemPrompt?: string;
  token?: vscode.CancellationToken;
};

type StreamPromptOptions = PromptOptions & {
  onToken: (chunk: string) => void;
};

export class OllamaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);

    if (!response.ok) {
      throw new Error(`Unable to reach Ollama at ${this.baseUrl}.`);
    }

    const body = (await response.json()) as OllamaTagResponse;
    return (body.models ?? []).map((model) => model.name ?? '').filter(Boolean);
  }

  async ensureModelExists(model: string): Promise<string> {
    const models = await this.listModels();
    if (!models.includes(model)) {
      throw new Error(`The configured model "${model}" is not available on the local Ollama server. Available models: ${models.join(', ') || 'none'}.`);
    }

    return model;
  }

  async sendPrompt(model: string, prompt: string, temperature: number, options: PromptOptions = {}): Promise<string> {
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

  async streamPrompt(model: string, prompt: string, temperature: number, options: StreamPromptOptions): Promise<string> {
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

    return fullText || 'No response returned from Ollama.';
  }

  private buildMessages(prompt: string, systemPrompt?: string): OllamaMessage[] {
    return [
      { role: 'system', content: systemPrompt ?? HUMAN_READABLE_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];
  }

  private async fetchChat(
    model: string,
    temperature: number,
    options: { stream: boolean; messages: OllamaMessage[]; token?: vscode.CancellationToken },
  ): Promise<Response> {
    const controller = new AbortController();
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
        this.outputChannel.appendLine('[Ollama] Request cancelled.');
        return new Response(JSON.stringify({ message: { content: '' } }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      throw error;
    } finally {
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