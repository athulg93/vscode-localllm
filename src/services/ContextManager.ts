import * as vscode from 'vscode';

import {
  CONTEXT_CACHE_TTL_MS,
  CONTEXT_SELECTION_SYSTEM_PROMPT,
  MAX_CONTEXT_CANDIDATE_FILES,
  MAX_FILE_CHARS,
  MAX_EDIT_CONTEXT_CHARS,
  MAX_PROJECT_FILES,
  MAX_PROJECT_TOTAL_CHARS,
  MAX_TARGETED_CONTEXT_FILES,
  PROTECTED_PATH_SEGMENTS,
  PROJECT_EXCLUDE_GLOB,
  TEXT_FILE_EXTENSIONS,
} from '../constants';
import { OllamaClient } from './OllamaClient';
import { classifyPromptIntent } from '../core/PromptIntentClassifier';
import { Logger } from '../core/contracts';
import { ContextSelectionResponse, PromptIntent } from '../types';
import { OllamaTool } from './OllamaClient';

type ContextBuildOptions = {
  client: OllamaClient;
  model: string;
  temperature: number;
  token?: vscode.CancellationToken;
  maxTotalChars?: number;
};

type ContextCacheEntry = {
  expiresAt: number;
  value: string;
};

type ContextPlan = {
  scope: 'none' | 'activeFile' | 'project' | 'paths';
  paths?: string[];
  reason?: string;
};

export class ContextManager {
  private readonly cache = new Map<string, ContextCacheEntry>();

  constructor(private readonly outputChannel: Logger) {}

  classifyPromptIntent(prompt: string): PromptIntent {
    return classifyPromptIntent(prompt);
  }

  getFileTools(): OllamaTool[] {
    return [{
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a bounded line range from a text file in the current workspace. Use this before proposing updates to an existing file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative file path.' },
            startLine: { type: 'integer', minimum: 1, description: 'First line to read, inclusive.' },
            endLine: { type: 'integer', minimum: 1, description: 'Last line to read, inclusive. Maximum 240 lines.' },
          },
          required: ['path'],
        },
      },
    }];
  }

  async executeFileTool(name: string, arguments_: Record<string, unknown>): Promise<string> {
    if (name !== 'read_file') {
      return JSON.stringify({ error: `Unknown file tool: ${name}` });
    }

    const path = typeof arguments_.path === 'string' ? arguments_.path.replace(/\\/g, '/') : '';
    if (!path || !this.isSafeToolPath(path)) {
      return JSON.stringify({ error: 'The requested path is not allowed. Use a workspace-relative text-file path without .. segments.' });
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return JSON.stringify({ error: 'No workspace folder is open.' });
    }

    const matches = await vscode.workspace.findFiles(path, undefined, 2);
    if (matches.length !== 1) {
      return JSON.stringify({ error: `Could not resolve exactly one workspace file for ${path}.` });
    }

    try {
      const text = await this.readDocumentText(matches[0]);
      const allLines = text.split(/\r?\n/);
      const startLine = this.toToolLine(arguments_.startLine, 1);
      const endLine = Math.min(this.toToolLine(arguments_.endLine, startLine + 239), startLine + 239);
      const content = allLines.slice(startLine - 1, endLine).join('\n');
      return JSON.stringify({ path, startLine, endLine, content });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown file read error.';
      return JSON.stringify({ error: `Could not read ${path}: ${message}` });
    }
  }

  async buildPromptWithImplicitContext(prompt: string, options: ContextBuildOptions): Promise<string> {
    const intent = this.classifyPromptIntent(prompt);
    this.outputChannel.appendLine(`[Context] Building context; intent=${intent}, prompt length=${prompt.length}.`);
    const plan = await this.resolveContextPlan(prompt, intent, options);
    this.outputChannel.appendLine(`[Context] Context plan selected: scope=${plan.scope}${plan.paths?.length ? `, paths=${plan.paths.length}` : ''}.`);

    if (plan.scope === 'none') {
      return prompt;
    }

    const contextBlock = await this.buildContextBlock(plan, options.token, options.maxTotalChars);
    if (!contextBlock) {
      this.outputChannel.appendLine('[Context] No context block was assembled.');
      return prompt;
    }

    this.outputChannel.appendLine(`[Context] Context block assembled; length=${contextBlock.length}.`);

    return [
      prompt,
      '',
      '---',
      'Additional local context automatically supplied by the VS Code extension:',
      contextBlock,
    ].join('\n');
  }

  private async resolveContextPlan(prompt: string, intent: PromptIntent, options: ContextBuildOptions): Promise<ContextPlan> {
    if (intent === PromptIntent.AnalyzeFile || intent === PromptIntent.EditFile) {
      return { scope: 'activeFile', reason: 'Intent matched current file workflow.' };
    }

    if (intent === PromptIntent.AnalyzeProject || intent === PromptIntent.EditProject) {
      return { scope: 'project', reason: 'Intent matched current project workflow.' };
    }

    if (!this.mightNeedContext(prompt)) {
      return { scope: 'none', reason: 'Prompt does not appear to require local context.' };
    }

    const selection = await this.selectContextDynamically(prompt, options);
    return {
      scope: selection.scope ?? 'none',
      paths: selection.paths,
      reason: selection.reason,
    };
  }

  private mightNeedContext(prompt: string): boolean {
    return /\b(this|current|active|that|it|here|project|workspace|repo|repository|folder|file|code|function|class|module|component|error|issue|bug|fix|change|update|refactor|improve|create|add|write|generate|delete|rename|move)\b/i.test(prompt);
  }

  private async selectContextDynamically(prompt: string, options: ContextBuildOptions): Promise<ContextSelectionResponse> {
    const candidatePaths = await this.getCandidateFilePaths();
    const activeFile = this.getActiveFilePath();

    if (candidatePaths.length === 0 && !activeFile) {
      return { scope: 'none', reason: 'No local file context is available.' };
    }

    const selectionPrompt = [
      `User request: ${prompt}`,
      `Active file: ${activeFile ?? 'none'}`,
      '',
      'Candidate workspace files:',
      candidatePaths.length > 0 ? candidatePaths.join('\n') : 'none',
      '',
      'Select the minimal context needed.',
    ].join('\n');

    try {
      const raw = await options.client.sendPrompt(options.model, selectionPrompt, 0, {
        systemPrompt: CONTEXT_SELECTION_SYSTEM_PROMPT,
        token: options.token,
      });

      const parsed = this.parseContextSelection(raw, candidatePaths);
      this.outputChannel.appendLine(`[Context] Dynamic selection: ${parsed.scope}${parsed.reason ? ` - ${parsed.reason}` : ''}`);
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.outputChannel.appendLine(`[Context] Dynamic selection failed, falling back: ${message}`);
      if (activeFile && /\b(this|current|active|that|it|here)\b/i.test(prompt)) {
        return { scope: 'activeFile', reason: 'Fallback to active file based on deictic wording.' };
      }

      return { scope: 'none', reason: 'Fallback after selector failure.' };
    }
  }

  private parseContextSelection(raw: string, candidatePaths: string[]): ContextSelectionResponse {
    const parsed = JSON.parse(this.extractJsonBlock(raw)) as ContextSelectionResponse;
    const candidateSet = new Set(candidatePaths);
    const scope = parsed.scope ?? 'none';

    if (scope === 'paths') {
      const paths = (parsed.paths ?? []).filter((path) => candidateSet.has(path)).slice(0, MAX_TARGETED_CONTEXT_FILES);
      if (paths.length === 0) {
        return { scope: 'none', reason: parsed.reason ?? 'No valid candidate paths were selected.' };
      }

      return { scope, paths, reason: parsed.reason };
    }

    if (scope === 'activeFile' || scope === 'project' || scope === 'none') {
      return { scope, reason: parsed.reason };
    }

    return { scope: 'none', reason: 'Selector returned an invalid scope.' };
  }

  private async buildContextBlock(plan: ContextPlan, token?: vscode.CancellationToken, maxTotalChars = MAX_PROJECT_TOTAL_CHARS): Promise<string | undefined> {
    if (plan.scope === 'activeFile') {
      return this.buildActiveFileContext();
    }

    if (plan.scope === 'project') {
      return this.buildProjectContext(undefined, token, maxTotalChars);
    }

    if (plan.scope === 'paths' && plan.paths && plan.paths.length > 0) {
      return this.buildProjectContext(plan.paths, token, maxTotalChars);
    }

    return undefined;
  }

  private async buildActiveFileContext(): Promise<string | undefined> {
    const editor = this.getPreferredEditor();
    if (!editor) {
      return undefined;
    }

    const document = editor.document;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const filePath = workspaceFolder ? vscode.workspace.asRelativePath(document.uri, false) : document.uri.fsPath;
    const content = this.truncateContent(document.getText(), MAX_FILE_CHARS);

    return [
      'User asked about the current file. Use the following file context in your response:',
      `File path: ${filePath}`,
      '',
      '```',
      content,
      '```',
    ].join('\n');
  }

  private async buildProjectContext(paths: string[] | undefined, token?: vscode.CancellationToken, maxTotalChars = MAX_PROJECT_TOTAL_CHARS): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }

    const cacheKey = this.createCacheKey(paths, maxTotalChars);
    if (!this.hasDirtyOpenDocuments() && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.outputChannel.appendLine(`[Context] Cache hit for ${cacheKey}.`);
        return cached.value;
      }
    }

    const title = paths?.length ? 'Gathering targeted workspace context...' : 'Gathering project context...';
    const context = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title },
      async (progress) => {
        progress.report({ message: 'Scanning files...' });
        const fileUris = paths?.length ? await this.resolveCandidateUris(paths) : await this.findPrioritizedProjectFiles();
        const selected: Array<{ path: string; content: string }> = [];
        let totalChars = 0;

        for (const uri of fileUris) {
          if (token?.isCancellationRequested) {
            return undefined;
          }

          const entry = await this.readContextEntry(uri, totalChars, maxTotalChars);
          if (!entry) {
            continue;
          }

          selected.push(entry);
          totalChars += entry.content.length;
          progress.report({ message: `${selected.length} file(s) staged` });

          if (selected.length >= MAX_PROJECT_FILES || totalChars >= maxTotalChars) {
            break;
          }
        }

        if (selected.length === 0) {
          return undefined;
        }

        const folderList = folders.map((folder) => folder.name).join(', ');
        const header = paths?.length
          ? 'User asked about a targeted set of project files. Use this workspace context in your response:'
          : 'User asked about the current project. Use this workspace context in your response:';
        const parts: string[] = [
          header,
          `Workspace folders: ${folderList}`,
          `Included files: ${selected.length}`,
          '',
        ];

        for (const entry of selected) {
          parts.push(`File path: ${entry.path}`);
          parts.push('```');
          parts.push(entry.content);
          parts.push('```');
          parts.push('');
        }

        return parts.join('\n');
      },
    );

    if (context) {
      this.cache.set(cacheKey, { expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS, value: context });
    }

    return context;
  }

  private async getCandidateFilePaths(): Promise<string[]> {
    const uris = await this.findPrioritizedProjectFiles();
    return uris.map((uri) => vscode.workspace.asRelativePath(uri, false)).slice(0, MAX_CONTEXT_CANDIDATE_FILES);
  }

  private async findPrioritizedProjectFiles(): Promise<vscode.Uri[]> {
    const uris = await vscode.workspace.findFiles('**/*', PROJECT_EXCLUDE_GLOB, MAX_CONTEXT_CANDIDATE_FILES);
    const textUris = uris.filter((uri) => this.isLikelyTextSourceFile(uri));
    const activeFilePath = this.getActiveFilePath();

    textUris.sort((left, right) => this.scoreCandidate(right, activeFilePath) - this.scoreCandidate(left, activeFilePath));
    return textUris;
  }

  private async resolveCandidateUris(paths: string[]): Promise<vscode.Uri[]> {
    const resolved: vscode.Uri[] = [];

    for (const path of paths) {
      const matches = await vscode.workspace.findFiles(path, undefined, 2);
      if (matches.length === 1 && this.isLikelyTextSourceFile(matches[0])) {
        resolved.push(matches[0]);
      }
    }

    return resolved;
  }

  private async readContextEntry(uri: vscode.Uri, totalChars: number, maxTotalChars: number): Promise<{ path: string; content: string } | undefined> {
    try {
      const text = await this.readDocumentText(uri);
      if (text.includes('\u0000')) {
        return undefined;
      }

      const relativePath = vscode.workspace.asRelativePath(uri, false);
      const remainingChars = maxTotalChars - totalChars;
      if (remainingChars <= 0) {
        return undefined;
      }

      const content = this.truncateContent(text, Math.min(MAX_FILE_CHARS, remainingChars));
      return { path: relativePath, content };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.outputChannel.appendLine(`[Context] Failed to read ${vscode.workspace.asRelativePath(uri, false)}: ${message}`);
      return undefined;
    }
  }

  private async readDocumentText(uri: vscode.Uri): Promise<string> {
    const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    if (openDocument) {
      return openDocument.getText();
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
  }

  private extractJsonBlock(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch && fencedMatch[1]) {
      return fencedMatch[1].trim();
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1).trim();
    }

    return trimmed;
  }

  private truncateContent(content: string, maxChars: number): string {
    return content.length <= maxChars ? content : `${content.slice(0, maxChars)}\n\n...[truncated]`;
  }

  private getFileExtension(fileName: string): string {
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
  }

  private isLikelyTextSourceFile(uri: vscode.Uri): boolean {
    return uri.scheme === 'file' && TEXT_FILE_EXTENSIONS.has(this.getFileExtension(uri.fsPath));
  }

  private isSafeToolPath(path: string): boolean {
    const segments = path.split('/');
    return !path.startsWith('/')
      && !segments.includes('..')
      && !segments.some((segment) => PROTECTED_PATH_SEGMENTS.has(segment))
      && !/[\*?\[\]{}]/.test(path)
      && this.isLikelyTextSourceFile(vscode.Uri.file(path));
  }

  private toToolLine(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private scoreCandidate(uri: vscode.Uri, activeFilePath: string | undefined): number {
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    if (!activeFilePath) {
      return relativePath.split('/').length * -1;
    }

    if (relativePath === activeFilePath) {
      return 100;
    }

    const activeFolder = activeFilePath.includes('/') ? activeFilePath.slice(0, activeFilePath.lastIndexOf('/')) : '';
    if (activeFolder && relativePath.startsWith(`${activeFolder}/`)) {
      return 80;
    }

    const sharedSegments = relativePath.split('/').filter((segment, index) => activeFilePath.split('/')[index] === segment).length;
    return sharedSegments;
  }

  private getActiveFilePath(): string | undefined {
    const editor = this.getPreferredEditor();
    if (!editor) {
      return undefined;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    return workspaceFolder ? vscode.workspace.asRelativePath(editor.document.uri, false) : undefined;
  }

  private getPreferredEditor(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (active && this.isUsableEditor(active)) {
      return active;
    }

    return vscode.window.visibleTextEditors.find((editor) => this.isUsableEditor(editor));
  }

  private isUsableEditor(editor: vscode.TextEditor): boolean {
    return !editor.document.isUntitled && editor.document.uri.scheme === 'file';
  }

  private createCacheKey(paths: string[] | undefined, maxTotalChars: number): string {
    const folders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()).join('|') ?? 'no-workspace';
    if (!paths || paths.length === 0) {
      return `${folders}:project:all:${maxTotalChars}`;
    }

    return `${folders}:project:${paths.slice().sort().join('|')}:${maxTotalChars}`;
  }

  private hasDirtyOpenDocuments(): boolean {
    return vscode.workspace.textDocuments.some((document) => document.isDirty);
  }
}