export type OllamaTagResponse = {
  models?: Array<{ name?: string }>;
};

export type OllamaChatResponse = {
  message?: {
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  error?: string;
  done?: boolean;
};

export type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
};

export type OllamaToolCall = {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

export type ProposedFileEdit = {
  operation?: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  newPath?: string;
  content?: string;
  summary?: string;
};

export type ProposedEditsResponse = {
  summary?: string;
  edits?: ProposedFileEdit[];
};

export enum PromptIntent {
  General = 'general',
  AnalyzeFile = 'analyzeFile',
  AnalyzeProject = 'analyzeProject',
  EditFile = 'editFile',
  EditProject = 'editProject',
}

export type ContextScope = 'none' | 'activeFile' | 'project' | 'paths';

export type ContextSelectionResponse = {
  scope?: ContextScope;
  paths?: string[];
  reason?: string;
};