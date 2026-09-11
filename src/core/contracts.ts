export type CancellationLike = {
  isCancellationRequested: boolean;
  onCancellationRequested: (listener: () => unknown) => { dispose(): unknown };
};

export type Logger = {
  appendLine(message: string): void;
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
};

export type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ResponseFormat = 'json' | Record<string, unknown>;

export type ModelProvider = {
  listModels(): Promise<string[]>;
  ensureModelExists(model: string): Promise<string>;
  sendPrompt(model: string, prompt: string, temperature: number, options?: {
    systemPrompt?: string;
    token?: CancellationLike;
    responseFormat?: ResponseFormat;
  }): Promise<string>;
  streamPrompt(model: string, prompt: string, temperature: number, options: {
    systemPrompt?: string;
    token?: CancellationLike;
    onToken: (chunk: string) => void;
    responseFormat?: ResponseFormat;
  }): Promise<string>;
  sendPromptWithTools(model: string, prompt: string, temperature: number, options: {
    systemPrompt?: string;
    token?: CancellationLike;
    tools: ToolDefinition[];
    executeTool: (name: string, arguments_: Record<string, unknown>) => Promise<string>;
    maxToolCalls?: number;
    responseFormat?: ResponseFormat;
  }): Promise<string>;
};
