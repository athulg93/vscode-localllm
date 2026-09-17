export type OllamaTagResponse = {
  models?: Array<{ name?: string }>;
};

export type OllamaShowResponse = {
  capabilities?: string[];
};

export type OllamaPsModel = {
  name?: string;
  model?: string;
  size?: number;
  size_vram?: number;
  details?: {
    format?: string;
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
  expires_at?: string;
};

export type OllamaPsResponse = {
  models?: OllamaPsModel[];
};

export type OllamaChatResponse = {
  message?: {
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  error?: string;
  done?: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
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
  operation?: 'create' | 'update' | 'delete' | 'rename' | 'copy';
  path: string;
  newPath?: string;
  content?: string;
  summary?: string;
};

export type ProposedEditsResponse = {
  summary?: string;
  edits?: ProposedFileEdit[];
};

export type EditPlan = ProposedEditsResponse;
export type EditPlanItem = ProposedFileEdit;

export enum PromptIntent {
  General = 'general',
  AnalyzeFile = 'analyzeFile',
  AnalyzeProject = 'analyzeProject',
  EditFile = 'editFile',
  EditProject = 'editProject',
  GitTransaction = 'gitTransaction',
}

export type ContextScope = 'none' | 'activeFile' | 'project' | 'paths';

export type ContextSelectionResponse = {
  scope?: ContextScope;
  paths?: string[];
  reason?: string;
};