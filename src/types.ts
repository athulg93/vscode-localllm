export type OllamaTagResponse = {
  models?: Array<{ name?: string }>;
};

export type OllamaChatResponse = {
  message?: { content?: string };
  error?: string;
  done?: boolean;
};

export type OllamaMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ProposedFileEdit = {
  path: string;
  content: string;
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