export type CancellationLike = {
  isCancellationRequested: boolean;
  onCancellationRequested: (listener: () => unknown) => { dispose(): unknown };
};

export type Logger = {
  appendLine(message: string): void;
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ModelProvider = {
  listModels(): Promise<string[]>;
  ensureModelExists(model: string): Promise<string>;
  sendPrompt(model: string, prompt: string, temperature: number, options?: {
    systemPrompt?: string;
    token?: CancellationLike;
  }): Promise<string>;
  streamPrompt(model: string, prompt: string, temperature: number, options: {
    systemPrompt?: string;
    token?: CancellationLike;
    onToken: (chunk: string) => void;
  }): Promise<string>;
};
