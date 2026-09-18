/// <reference lib="dom" />

import { HUMAN_READABLE_SYSTEM_PROMPT, MAX_COMPLETION_CHECKS, OLLAMA_REQUEST_TIMEOUT_MS } from '../constants';
import { OllamaChatResponse, OllamaMessage, OllamaPsResponse, OllamaShowResponse, OllamaTagResponse } from '../types';
import { CancellationLike, ConversationMessage, Logger, ModelProvider, ProviderStatus, ResponseFormat, ToolDefinition } from '../core/contracts';
import { NdjsonParseError, consumeNdjsonBuffer } from '../core/NdjsonStream';
import { ModelBehaviorTelemetry } from '../core/ModelBehaviorTelemetry';
import { ModelBehaviorProfile, resolveModelProfile } from '../core/ModelProfiles';
import { shouldUseWorkspaceTools } from '../core/ToolIntentGate';
import { parseTextToolCall, parseXmlToolCall } from '../core/TextToolCallParser';
import { ActivityTracker } from '../core/ActivityTracker';

type PromptOptions = {
  systemPrompt?: string;
  conversationHistory?: ConversationMessage[];
  token?: CancellationLike;
  responseFormat?: ResponseFormat;
  onStatus?: ProviderStatus;
};

type StreamPromptOptions = PromptOptions & {
  onToken: (chunk: string) => void;
};

type OllamaTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type ToolPromptOptions = PromptOptions & {
  executeTool: (name: string, arguments_: Record<string, unknown>) => Promise<string>;
  maxToolCalls?: number;
  tools: ToolDefinition[];
};

type AgentLoopState = 'awaitingModel' | 'executingTools' | 'checkingCompletion' | 'complete';

export class OllamaClient implements ModelProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly outputChannel: Logger,
    private readonly telemetry?: ModelBehaviorTelemetry,
    private readonly activityTracker?: ActivityTracker,
  ) {}

  async getProcessStats(): Promise<OllamaPsResponse> {
    const endpoint = `${this.baseUrl}/api/ps`;
    try {
      const response = await fetch(endpoint);
      if (!response.ok) return { models: [] };
      return (await response.json()) as OllamaPsResponse;
    } catch {
      return { models: [] };
    }
  }

  async refreshHardwareStats(modelName: string): Promise<void> {
    if (!this.activityTracker) return;
    try {
      const ps = await this.getProcessStats();
      const loaded = ps.models?.find((m) => m.name === modelName || m.model === modelName) || ps.models?.[0];
      if (loaded && loaded.size) {
        const totalGb = (loaded.size / (1024 * 1024 * 1024)).toFixed(1);
        const vramGb = ((loaded.size_vram || 0) / (1024 * 1024 * 1024)).toFixed(1);
        const sysRamBytes = Math.max(0, loaded.size - (loaded.size_vram || 0));
        const sysRamGb = (sysRamBytes / (1024 * 1024 * 1024)).toFixed(1);
        const pctVram = Math.min(100, Math.round(((loaded.size_vram || 0) / loaded.size) * 100));

        this.activityTracker.updateHardwareStats({
          modelName: loaded.name || modelName,
          totalSizeBytes: loaded.size,
          vramSizeBytes: loaded.size_vram || 0,
          totalSizeFormatted: `${totalGb} GB`,
          vramFormatted: `${vramGb} GB`,
          systemRamFormatted: `${sysRamGb} GB`,
          percentVram: pctVram,
          isFullyGpuAccelerated: pctVram >= 99,
          expiresAt: loaded.expires_at,
        });
      }
    } catch {}
  }

  async listModels(): Promise<string[]> {
    const endpoint = `${this.baseUrl}/api/tags`;
    this.outputChannel.appendLine(`[Ollama] Listing models from ${endpoint}`);
    let response: Response;
    try {
      response = await fetch(endpoint);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[Ollama] Model listing request failed at ${endpoint}: ${details}`);
      throw new Error(`Could not connect to Ollama at ${this.baseUrl}. Check that Ollama is running and the Local Ollama URL is correct.`, { cause: error });
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

  async getModelProfile(model: string): Promise<ModelBehaviorProfile> {
    const endpoint = `${this.baseUrl}/api/show`;
    this.outputChannel.appendLine(`[Ollama] Checking capabilities for model ${model}.`);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
    } catch (error) {
      await this.telemetry?.record(model, 'capabilityFailures');
      throw new Error(`Could not check capabilities for model "${model}" at ${this.baseUrl}.`, { cause: error });
    }

    if (!response.ok) {
      const text = await response.text();
      await this.telemetry?.record(model, 'capabilityFailures');
      throw new Error(`Unable to inspect model "${model}": ${response.status} ${response.statusText} ${text}`.trim());
    }

    const body = (await response.json()) as OllamaShowResponse;
    await this.telemetry?.record(model, 'capabilityChecks');
    return resolveModelProfile(model, body.capabilities);
  }

  getModelBehaviorWarning(model: string): string | undefined {
    return this.telemetry?.warning(model);
  }

  async modelSupportsTools(model: string): Promise<boolean> {
    const profile = await this.getModelProfile(model);
    return profile.supportsTools;
  }

  async sendPrompt(model: string, prompt: string, temperature: number, options: PromptOptions = {}): Promise<string> {
    this.outputChannel.appendLine(`[Ollama] Sending non-stream request with model ${model}; prompt length ${prompt.length}.`);
    options.onStatus?.(`Sending request to ${model}...`);
    const response = await this.fetchChat(model, temperature, {
      stream: false,
      messages: this.buildMessages(prompt, options.systemPrompt, options.conversationHistory),
      token: options.token,
      responseFormat: options.responseFormat,
      onStatus: options.onStatus,
    });

    const data = (await response.json()) as OllamaChatResponse;
    if (data.error) {
      throw new Error(data.error);
    }

    const content = data.message?.content ?? 'No response returned from Ollama.';

    if (this.activityTracker) {
      const evalCount = data.eval_count || Math.max(1, Math.round(content.length / 3.8));
      const promptEvalCount = data.prompt_eval_count || Math.max(1, Math.round(prompt.length / 3.8));
      const evalDurationSeconds = data.eval_duration ? data.eval_duration / 1e9 : 0.001;
      const tokensPerSecond = evalDurationSeconds > 0 ? evalCount / evalDurationSeconds : undefined;
      this.activityTracker.recordChatSession({
        model,
        userPromptChars: prompt.length,
        agentResponseChars: content.length,
        promptTokens: promptEvalCount,
        generatedTokens: evalCount,
        tokensPerSecond: tokensPerSecond ? Math.round(tokensPerSecond * 10) / 10 : undefined,
        durationMs: data.total_duration ? Math.round(data.total_duration / 1e6) : 0,
        timeToFirstTokenMs: data.prompt_eval_duration ? Math.round(data.prompt_eval_duration / 1e6) : undefined,
      });
      void this.refreshHardwareStats(model);
    }

    return content;
  }

  async sendPromptWithTools(model: string, prompt: string, temperature: number, options: ToolPromptOptions): Promise<string> {
    const profile = await this.getModelProfile(model);
    if (!shouldUseWorkspaceTools(prompt) || !profile.supportsTools) {
      const response = await this.sendPrompt(model, prompt, temperature, {
        systemPrompt: options.systemPrompt,
        conversationHistory: options.conversationHistory,
        token: options.token,
        onStatus: options.onStatus,
      });
      const unsolicitedToolCalls = profile.toolProtocol === 'xml'
        ? parseXmlToolCall(response)
        : parseTextToolCall(response);
      if (unsolicitedToolCalls.length > 0) {
        await this.telemetry?.record(model, 'falseTriggers');
      }

      return response;
    }

    await this.telemetry?.record(model, 'toolRequests');
    const toolPrompt = profile.toolProtocol === 'native' || profile.toolProtocol === 'none'
      ? prompt
      : this.addTextToolInstructions(prompt, options.tools, profile.toolProtocol);
    const messages: OllamaMessage[] = this.buildMessages(toolPrompt, options.systemPrompt, options.conversationHistory);
    const maxToolCalls = options.maxToolCalls ?? 8;
    let toolCallCount = 0;
    let completionChecks = 0;
    let state: AgentLoopState;

    while (true) {
      if (options.token?.isCancellationRequested) {
        throw new Error('The request was cancelled.');
      }

      this.outputChannel.appendLine(`[Ollama] Sending tool request with model ${model}; prompt length ${prompt.length}; tool calls used ${toolCallCount}.`);
      options.onStatus?.(toolCallCount === 0 ? 'Inspecting the request and deciding what context is needed...' : 'Continuing the request with the available context...');
      state = 'awaitingModel';
      this.outputChannel.appendLine(`[Ollama] Agent state: ${state}.`);
      const response = await this.fetchChat(model, temperature, {
        stream: false,
        messages,
        tools: profile.toolProtocol === 'native' ? this.toOllamaTools(options.tools) : undefined,
        token: options.token,
        responseFormat: undefined,
        onStatus: options.onStatus,
      });
      const data = (await response.json()) as OllamaChatResponse;
      if (data.error) {
        throw new Error(data.error);
      }

      const message = data.message;
      const nativeToolCalls = message?.tool_calls ?? [];
      const textToolCalls = nativeToolCalls.length === 0
        ? profile.toolProtocol === 'xml' ? parseXmlToolCall(message?.content) : parseTextToolCall(message?.content)
        : [];
      if (nativeToolCalls.length === 0 && (message?.content?.includes('"name"') || message?.content?.includes('<tool_call>')) && textToolCalls.length === 0) {
        await this.telemetry?.record(model, 'parseFailures');
      }
      const toolCalls = nativeToolCalls.length > 0 ? nativeToolCalls : textToolCalls;
      if (toolCalls.length === 0) {
        const content = message?.content ?? '';
        const isAskingUser = /\?\s*$/m.test(content.trim()) || /\b(?:would you like|do you want|shall i|should i|please confirm|proceed\?)\b/i.test(content);
        const shouldCheckCompletion = !isAskingUser
          && completionChecks < MAX_COMPLETION_CHECKS
          && (completionChecks === 0 || this.isLikelyIncompleteResponse(content));
        if (shouldCheckCompletion) {
          completionChecks += 1;
          state = 'checkingCompletion';
          this.outputChannel.appendLine(`[Ollama] Agent state: ${state}.`);
          messages.push({ role: 'assistant', content: message?.content ?? '' });
          messages.push({
            role: 'user',
            content: 'Do not stop at a plan or describe future work. Verify that the original request is fully complete. If workspace or Git evidence is still needed, use the available tools now. Otherwise return only the final answer directly.',
          });
          options.onStatus?.(`Checking that the request is fully complete (${completionChecks}/${MAX_COMPLETION_CHECKS})...`);
          continue;
        }

        state = 'complete';
        this.outputChannel.appendLine(`[Ollama] Agent loop completed; tool calls=${toolCallCount}; completion checks=${completionChecks}; state=${state}.`);
        return content || 'No response returned from Ollama.';
      }

      state = 'executingTools';
      this.outputChannel.appendLine(`[Ollama] Agent state: ${state}; tool calls=${toolCalls.length}.`);
      messages.push({
        role: 'assistant',
        content: message?.content ?? '',
        ...(nativeToolCalls.length > 0 ? { tool_calls: nativeToolCalls } : {}),
      });

      for (const toolCall of toolCalls) {
        toolCallCount += 1;
        if (toolCallCount > maxToolCalls) {
          await this.telemetry?.record(model, 'loopIncidents');
          throw new Error(`Ollama requested more than ${maxToolCalls} workspace operations in one request.`);
        }
        await this.telemetry?.record(model, 'toolCalls');

        const name = toolCall.function?.name ?? '';
        options.onStatus?.(`Reading workspace context${toolCallCount > 1 ? ` (${toolCallCount}/${maxToolCalls})` : ''}...`);
        const toolResult = await options.executeTool(name, toolCall.function?.arguments ?? {});

        let toolContent = toolResult;
        const isGitTool = name.startsWith('git_');
        let parsedResult: any = null;
        try {
          parsedResult = JSON.parse(toolResult);
        } catch {}

        if (parsedResult?.agentGuidance) {
          toolContent = `${toolResult}\n\n${parsedResult.agentGuidance}`;
        }

        if (nativeToolCalls.length > 0 && profile.toolResultRole === 'tool') {
          messages.push({ role: 'tool', content: toolContent });
        } else {
          const header = isGitTool ? 'GIT TOOL RESULT' : 'WORKSPACE TOOL RESULT';
          messages.push({
            role: 'user',
            content: `${header}:\n${toolContent}\n\nUse this result to continue the original request. Follow any diagnostic directives provided. Call another tool if needed, or ask the user for confirmation, or return the final answer.`,
          });
        }
      }
    }
  }

  private isLikelyIncompleteResponse(content: string): boolean {
    return /\b(?:i(?:'m| am) going to|i(?:'ll| will)|let me|first,? i|i need to|next,? i)\b[\s\S]*(?:inspect|review|analy[sz]e|check|read|search|look|gather|investigate|continue)/i.test(content);
  }

  async streamPrompt(model: string, prompt: string, temperature: number, options: StreamPromptOptions): Promise<string> {
    this.outputChannel.appendLine(`[Ollama] Sending stream request with model ${model}; prompt length ${prompt.length}.`);
    options.onStatus?.(`Generating a response with ${model}...`);
    const response = await this.fetchChat(model, temperature, {
      stream: true,
      messages: this.buildMessages(prompt, options.systemPrompt, options.conversationHistory),
      token: options.token,
      responseFormat: options.responseFormat,
      onStatus: options.onStatus,
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
    let lastDoneChunk: OllamaChatResponse | undefined;

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
          if (chunk.done) {
            lastDoneChunk = chunk;
          }

          const piece = chunk.message?.content ?? '';
          if (!piece) {
            continue;
          }

          fullText += piece;
          if (fullText.length === piece.length) {
            options.onStatus?.('Response started.');
          }
          options.onToken(piece);
        }
      }

      buffer += decoder.decode();
      const tail = this.consumeStreamBuffer(buffer, true);
      for (const chunk of tail.chunks) {
        if (chunk.error) {
          throw new Error(chunk.error);
        }
        if (chunk.done) {
          lastDoneChunk = chunk;
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

    if (this.activityTracker) {
      const evalCount = lastDoneChunk?.eval_count || Math.max(1, Math.round(responseText.length / 3.8));
      const promptEvalCount = lastDoneChunk?.prompt_eval_count || Math.max(1, Math.round(prompt.length / 3.8));
      const evalDurationSeconds = lastDoneChunk?.eval_duration ? lastDoneChunk.eval_duration / 1e9 : 0.001;
      const tokensPerSecond = evalDurationSeconds > 0 ? evalCount / evalDurationSeconds : undefined;
      this.activityTracker.recordChatSession({
        model,
        userPromptChars: prompt.length,
        agentResponseChars: responseText.length,
        promptTokens: promptEvalCount,
        generatedTokens: evalCount,
        tokensPerSecond: tokensPerSecond ? Math.round(tokensPerSecond * 10) / 10 : undefined,
        durationMs: lastDoneChunk?.total_duration ? Math.round(lastDoneChunk.total_duration / 1e6) : 0,
        timeToFirstTokenMs: lastDoneChunk?.prompt_eval_duration ? Math.round(lastDoneChunk.prompt_eval_duration / 1e6) : undefined,
      });
      void this.refreshHardwareStats(model);
    }

    return responseText;
  }

  private buildMessages(prompt: string, systemPrompt?: string, conversationHistory: ConversationMessage[] = []): OllamaMessage[] {
    return [
      { role: 'system', content: systemPrompt ?? HUMAN_READABLE_SYSTEM_PROMPT },
      ...conversationHistory,
      { role: 'user', content: prompt },
    ];
  }

  private async fetchChat(
    model: string,
    temperature: number,
    options: {
      stream: boolean;
      messages: OllamaMessage[];
      tools?: OllamaTool[];
      token?: CancellationLike;
      responseFormat?: ResponseFormat;
      onStatus?: ProviderStatus;
    },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);
    const subscription = options.token?.onCancellationRequested(() => controller.abort());
    const startedAt = Date.now();
    const progressTimer = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      options.onStatus?.(`Still waiting for Ollama (${elapsedSeconds}s). The model may be loading...`);
    }, 15_000);
    options.onStatus?.('Connecting to the local Ollama server...');

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
          ...(options.responseFormat ? { format: options.responseFormat } : {}),
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
        if (options.token?.isCancellationRequested) {
          throw new Error('The request was cancelled.', { cause: error });
        }

        throw new Error(`Ollama did not respond within ${OLLAMA_REQUEST_TIMEOUT_MS / 60_000} minutes. The model may still be loading, or the prompt may be too large. You can try again, choose a smaller model, or reduce the amount of workspace context.`, { cause: error });
      }

      const details = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[Ollama] Request failed: ${details}`);
      if (details.toLowerCase().includes('fetch failed')) {
        throw new Error(`Could not connect to Ollama at ${this.baseUrl}. The server may have closed the request while processing the large prompt.`, { cause: error });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      clearInterval(progressTimer);
      subscription?.dispose();
    }
  }

  private toOllamaTools(tools: ToolDefinition[]): OllamaTool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private addTextToolInstructions(prompt: string, tools: ToolDefinition[], protocol: 'json' | 'xml'): string {
    const format = protocol === 'xml'
      ? '<tool_call><name>tool_name</name><arguments>{"key":"value"}</arguments></tool_call>'
      : '{"name":"tool_name","arguments":{"key":"value"}}';
    const definitions = tools.map((tool) => `${tool.name}: ${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}`).join('\n');
    return [
      prompt,
      '',
      `Available workspace tools (return exactly one ${protocol.toUpperCase()} tool call at a time using this format: ${format}):`,
      definitions,
      'Use a tool only when the request requires workspace information. Otherwise answer normally.',
    ].join('\n');
  }

  private consumeStreamBuffer(buffer: string, flush = false): { chunks: OllamaChatResponse[]; remaining: string } {
    try {
      return consumeNdjsonBuffer(buffer, flush);
    } catch (error) {
      if (error instanceof NdjsonParseError) {
        this.outputChannel.appendLine(`[Ollama] ${error.message}`);
      }

      throw error;
    }
  }
}