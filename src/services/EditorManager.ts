import * as vscode from 'vscode';

import {
  EDIT_PLAN_SYSTEM_PROMPT,
  MAX_APPLY_FILE_CHARS,
  MAX_EDIT_FILES,
  PROTECTED_FILE_NAMES,
  PROTECTED_PATH_SEGMENTS,
} from '../constants';
import { ProposedEditsResponse, ProposedFileEdit } from '../types';
import { ContextManager } from './ContextManager';
import { OllamaClient } from './OllamaClient';
import { parseEditPlan } from '../core/EditPlanParser';
import { Logger } from '../core/contracts';

type EditWorkflowOptions = {
  client: OllamaClient;
  contextManager: ContextManager;
  model: string;
  prompt: string;
  temperature: number;
  stream: vscode.ChatResponseStream;
  token?: vscode.CancellationToken;
};

type EditCandidate = {
  operation: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  newPath?: string;
  content: string;
  summary?: string;
  uri: vscode.Uri;
  destinationUri?: vscode.Uri;
  createParentDirectories: vscode.Uri[];
};

type EditValidationResult =
  | {
    ok: true;
    operation: 'create' | 'update' | 'delete' | 'rename';
    uri: vscode.Uri;
    destinationUri?: vscode.Uri;
    createParentDirectories: vscode.Uri[];
  }
  | { ok: false; reason: string };

export class EditorManager {
  constructor(private readonly outputChannel: Logger) {}

  async runEditWorkflow(options: EditWorkflowOptions): Promise<boolean> {
    options.stream.progress('Understanding the requested file operation...');
    const editPlan = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Planning file edits...' },
      async (progress) => {
        progress.report({ message: 'Reading relevant workspace context...' });
        return this.proposeEdits(options);
      },
    );
    this.outputChannel.appendLine(`[Edit] Model returned ${editPlan.edits?.length ?? 0} proposed operation(s).`);
    const edits = (editPlan.edits ?? []).filter((edit) => this.isRunnableEdit(edit));

    if (edits.length === 0) {
      options.stream.markdown('No concrete edits were proposed. Try a more specific request.');
      return true;
    }

    const preview = edits
      .slice(0, MAX_EDIT_FILES)
      .map((edit, index) => {
        const operation = edit.operation ?? 'update';
        const target = operation === 'rename' && edit.newPath ? `${edit.path} -> ${edit.newPath}` : edit.path;
        return `${index + 1}. [${operation}] ${target}${edit.summary ? ` - ${edit.summary}` : ''}`;
      })
      .join('\n');

    options.stream.markdown([
      editPlan.summary ? `### Proposed Changes\n${editPlan.summary}\n` : '### Proposed Changes',
      preview,
      '',
      'Opened preview diffs for up to 3 files. Review each change and choose keep or discard.',
    ].join('\n'));

    const candidates = await this.prepareEditCandidates(edits);
    this.outputChannel.appendLine(`[Edit] ${candidates.length} operation(s) passed validation.`);
    if (candidates.length === 0) {
      options.stream.markdown('No validated edits are safe to apply. Check the Local Ollama output channel for skip reasons.');
      return true;
    }

    options.stream.progress(`Prepared ${candidates.length} validated file operation(s).`);
    await this.previewProposedEdits(candidates);

    const selectedCandidates = await this.collectPerFileDecisions(candidates);
    if (selectedCandidates === undefined) {
      options.stream.markdown('Edit plan was discarded.');
      return true;
    }

    if (selectedCandidates.length === 0) {
      options.stream.markdown('All proposed edits were discarded.');
      return true;
    }

    this.outputChannel.appendLine(`[Edit] User kept ${selectedCandidates.length} of ${candidates.length} validated operation(s).`);

    const validationSkipped = edits
      .slice(0, MAX_EDIT_FILES)
      .filter((edit) => !candidates.some((candidate) => candidate.path === edit.path && candidate.operation === (edit.operation ?? 'update')))
      .map((edit) => `${edit.path} (failed validation)`);
    const discardedByUser = candidates
      .filter((candidate) => !selectedCandidates.includes(candidate))
      .map((candidate) => `${this.describeCandidate(candidate)} (discarded by user)`);

    const { applied, skipped } = await this.applyProposedEdits(selectedCandidates);
    this.outputChannel.appendLine(`[Edit] Apply completed; applied=${applied.length}, skipped=${skipped.length}.`);
    const combinedSkipped = [...validationSkipped, ...discardedByUser, ...skipped];
    options.stream.markdown([
      '### Edit Result',
      '**Applied:**',
      applied.length ? applied.map((path) => `- ${path}`).join('\n') : '- none',
      '',
      '**Skipped:**',
      combinedSkipped.length ? combinedSkipped.map((item) => `- ${item}`).join('\n') : '- none',
    ].join('\n'));

    return true;
  }

  private async proposeEdits(options: EditWorkflowOptions): Promise<ProposedEditsResponse> {
    const toolPrompt = [
      options.prompt,
      '',
      'You may use the read_file tool to inspect only the workspace-relative files needed for this request.',
      'Do not assume you can access the filesystem directly. For an existing file, read the relevant lines before proposing an update.',
      'For a new file, do not read a nonexistent path; return a create operation with the requested workspace-relative path.',
    ].join('\n');
    const raw = await options.client.sendPromptWithTools(options.model, toolPrompt, options.temperature, {
      systemPrompt: EDIT_PLAN_SYSTEM_PROMPT,
      token: options.token,
      tools: options.contextManager.getFileTools(),
      executeTool: (name, arguments_) => options.contextManager.executeFileTool(name, arguments_),
    });

    try {
      return parseEditPlan(raw);
    } catch {
      this.outputChannel.appendLine('[Edit] Ollama returned a non-JSON edit plan; retrying with a stricter format request.');
      const retry = await options.client.sendPrompt(
        options.model,
        `${toolPrompt}\n\nYour previous response could not be parsed. Return only the JSON edit plan now. Do not include markdown, explanations, or code fences.`,
        options.temperature,
        {
          systemPrompt: EDIT_PLAN_SYSTEM_PROMPT,
          token: options.token,
        },
      );

      try {
        return parseEditPlan(retry);
      } catch {
        throw new Error('Could not parse an edit plan from Ollama after two attempts. Check the Local Ollama output channel and try a more specific request.');
      }
    }
  }

  private async prepareEditCandidates(edits: ProposedFileEdit[]): Promise<EditCandidate[]> {
    const candidates: EditCandidate[] = [];

    for (const edit of edits.slice(0, MAX_EDIT_FILES)) {
      const validation = await this.validateProposedEdit(edit);
      if (validation.ok) {
        candidates.push({
          operation: validation.operation,
          path: edit.path,
          newPath: edit.newPath,
          content: edit.content ?? '',
          summary: edit.summary,
          uri: validation.uri,
          destinationUri: validation.destinationUri,
          createParentDirectories: validation.createParentDirectories,
        });
      } else {
        this.outputChannel.appendLine(`[Edit] Skipping ${edit.path}: ${validation.reason}`);
      }
    }

    return candidates;
  }

  private async applyProposedEdits(candidates: EditCandidate[]): Promise<{ applied: string[]; skipped: string[] }> {
    const workspaceEdit = new vscode.WorkspaceEdit();
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const candidate of candidates) {
      for (const parent of candidate.createParentDirectories) {
        await vscode.workspace.fs.createDirectory(parent);
      }

      if (candidate.operation === 'create') {
        workspaceEdit.createFile(candidate.uri, { ignoreIfExists: false });
        workspaceEdit.insert(candidate.uri, new vscode.Position(0, 0), candidate.content);
      } else if (candidate.operation === 'update') {
        const document = await vscode.workspace.openTextDocument(candidate.uri);
        workspaceEdit.replace(candidate.uri, this.toFullRange(document), candidate.content);
      } else if (candidate.operation === 'delete') {
        workspaceEdit.deleteFile(candidate.uri, { ignoreIfNotExists: true, recursive: false });
      } else if (candidate.destinationUri) {
        workspaceEdit.renameFile(candidate.uri, candidate.destinationUri, { overwrite: false, ignoreIfExists: false });
      } else {
        skipped.push(`${candidate.path} (missing rename target)`);
        continue;
      }

      applied.push(this.describeCandidate(candidate));
    }

    if (applied.length > 0) {
      await vscode.workspace.applyEdit(workspaceEdit);

      for (const candidate of candidates) {
        if (candidate.operation === 'delete') {
          continue;
        }

        const targetUri = candidate.operation === 'rename' && candidate.destinationUri
          ? candidate.destinationUri
          : candidate.uri;
        const document = await vscode.workspace.openTextDocument(targetUri);
        await document.save();
      }
    }

    return { applied, skipped };
  }

  private async previewProposedEdits(candidates: EditCandidate[]): Promise<void> {
    for (const candidate of candidates.slice(0, 3)) {
      const languageId = await this.resolveLanguageId(candidate);
      const originalContent = candidate.operation === 'create'
        ? ''
        : await this.readDiskSnapshot(candidate.uri);
      const previewContent = candidate.operation === 'delete'
        ? ''
        : candidate.operation === 'rename'
          ? await this.readDiskSnapshot(candidate.uri)
          : candidate.content;
      const original = await vscode.workspace.openTextDocument({
        language: languageId,
        content: originalContent,
      });
      const preview = await vscode.workspace.openTextDocument({
        language: original.languageId,
        content: previewContent,
      });

      const title = `Proposed (${candidate.operation}): ${this.describeCandidateTarget(candidate)}`;
      await vscode.commands.executeCommand('vscode.diff', original.uri, preview.uri, title, { preview: true });
    }
  }

  private async collectPerFileDecisions(candidates: EditCandidate[]): Promise<EditCandidate[] | undefined> {
    const selected: EditCandidate[] = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Keep', description: 'Apply this change', value: 'keep' },
          { label: 'Discard', description: 'Skip this change', value: 'discard' },
          { label: 'Cancel All', description: 'Stop and discard all pending changes', value: 'cancel' },
        ],
        {
          placeHolder: `[${index + 1}/${candidates.length}] ${this.describeCandidate(candidate)}${candidate.summary ? ` - ${candidate.summary}` : ''}`,
          ignoreFocusOut: true,
        },
      );

      if (!choice || choice.value === 'cancel') {
        return undefined;
      }

      if (choice.value === 'keep') {
        selected.push(candidate);
      }
    }

    return selected;
  }

  private async validateProposedEdit(edit: ProposedFileEdit): Promise<EditValidationResult> {
    const normalizedPath = edit.path.replace(/\\/g, '/');
    if (!this.isSafeWorkspacePath(normalizedPath)) {
      return { ok: false, reason: 'path is outside the allowed workspace rules' };
    }

    if (this.isProtectedPath(normalizedPath)) {
      return { ok: false, reason: 'path is protected' };
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return { ok: false, reason: 'no workspace folder is open' };
    }

    const operation = edit.operation ?? 'update';
    const autoCreateDirectories = vscode.workspace
      .getConfiguration('localOllama')
      .get<boolean>('autoCreateDirectories', true);

    const targetUri = vscode.Uri.joinPath(workspaceFolder.uri, normalizedPath);

    const matches = await vscode.workspace.findFiles(normalizedPath, undefined, 2);
    if (operation === 'delete') {
      if (matches.length !== 1) {
        return { ok: false, reason: 'delete requires exactly one existing file path' };
      }

      const document = await vscode.workspace.openTextDocument(matches[0]);
      if (document.isDirty) {
        return { ok: false, reason: 'file has unsaved changes' };
      }

      return { ok: true, uri: matches[0], operation: 'delete', createParentDirectories: [] };
    }

    if (operation === 'rename') {
      const normalizedNewPath = (edit.newPath ?? '').replace(/\\/g, '/');
      if (!normalizedNewPath) {
        return { ok: false, reason: 'rename requires newPath' };
      }

      if (!this.isSafeWorkspacePath(normalizedNewPath) || this.isProtectedPath(normalizedNewPath)) {
        return { ok: false, reason: 'rename target path is not allowed' };
      }

      if (matches.length !== 1) {
        return { ok: false, reason: 'rename source requires exactly one existing file path' };
      }

      const sourceDocument = await vscode.workspace.openTextDocument(matches[0]);
      if (sourceDocument.isDirty) {
        return { ok: false, reason: 'source file has unsaved changes' };
      }

      const destinationUri = vscode.Uri.joinPath(workspaceFolder.uri, normalizedNewPath);
      const destinationMatches = await vscode.workspace.findFiles(normalizedNewPath, undefined, 2);
      if (destinationMatches.length > 0) {
        return { ok: false, reason: 'rename target already exists' };
      }

      const parentResolution = await this.resolveMissingParentDirectories(
        workspaceFolder.uri,
        normalizedNewPath,
        autoCreateDirectories,
      );
      if (!parentResolution.ok) {
        return parentResolution;
      }

      return {
        ok: true,
        uri: matches[0],
        destinationUri,
        operation: 'rename',
        createParentDirectories: parentResolution.directories,
      };
    }

    if (operation !== 'create' && operation !== 'update') {
      return { ok: false, reason: `unsupported edit operation: ${operation}` };
    }

    if (typeof edit.content !== 'string') {
      return { ok: false, reason: `${operation} requires file content` };
    }

    if (edit.content.length > MAX_APPLY_FILE_CHARS) {
      return { ok: false, reason: `content exceeds safe size of ${MAX_APPLY_FILE_CHARS} characters` };
    }

    if (matches.length === 0) {
      if (operation === 'update') {
        return { ok: false, reason: 'update requires an existing file path' };
      }

      const parentResolution = await this.resolveMissingParentDirectories(
        workspaceFolder.uri,
        normalizedPath,
        autoCreateDirectories,
      );
      if (!parentResolution.ok) {
        return parentResolution;
      }

      return {
        ok: true,
        uri: targetUri,
        operation: 'create',
        createParentDirectories: parentResolution.directories,
      };
    }

    if (matches.length > 1) {
      return { ok: false, reason: 'path was not uniquely found in the workspace' };
    }

    if (operation === 'create') {
      return { ok: false, reason: 'create operation requires a new path that does not already exist' };
    }

    const uri = matches[0];
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.isDirty) {
      return { ok: false, reason: 'file has unsaved changes' };
    }

    if (document.getText().length > MAX_APPLY_FILE_CHARS) {
      return { ok: false, reason: `file exceeds safe replace size of ${MAX_APPLY_FILE_CHARS} characters` };
    }

    return { ok: true, uri, operation: 'update', createParentDirectories: [] };
  }

  private async resolveMissingParentDirectories(
    workspaceUri: vscode.Uri,
    relativePath: string,
    autoCreateDirectories: boolean,
  ): Promise<{ ok: true; directories: vscode.Uri[] } | { ok: false; reason: string }> {
    const parentSegments = relativePath.split('/').slice(0, -1).filter(Boolean);
    if (parentSegments.length === 0) {
      return { ok: true, directories: [] };
    }

    const missingDirectories: vscode.Uri[] = [];
    const currentSegments: string[] = [];

    for (const segment of parentSegments) {
      currentSegments.push(segment);
      const candidate = vscode.Uri.joinPath(workspaceUri, ...currentSegments);
      try {
        await vscode.workspace.fs.stat(candidate);
      } catch {
        missingDirectories.push(candidate);
      }
    }

    if (missingDirectories.length > 0 && !autoCreateDirectories) {
      return { ok: false, reason: 'parent directory does not exist and auto-create is disabled' };
    }

    return { ok: true, directories: missingDirectories };
  }

  private describeCandidate(candidate: EditCandidate): string {
    return `${candidate.operation}: ${this.describeCandidateTarget(candidate)}`;
  }

  private describeCandidateTarget(candidate: EditCandidate): string {
    if (candidate.operation === 'rename' && candidate.destinationUri) {
      return `${vscode.workspace.asRelativePath(candidate.uri, false)} -> ${vscode.workspace.asRelativePath(candidate.destinationUri, false)}`;
    }

    return vscode.workspace.asRelativePath(candidate.uri, false);
  }

  private isRunnableEdit(edit: ProposedFileEdit): boolean {
    if (!edit?.path) {
      return false;
    }

    const operation = edit.operation ?? 'update';
    if (operation === 'delete') {
      return true;
    }

    if (operation === 'rename') {
      return Boolean(edit.newPath);
    }

    return typeof edit.content === 'string';
  }

  private async resolveLanguageId(candidate: EditCandidate): Promise<string> {
    if (candidate.operation === 'update' || candidate.operation === 'delete' || candidate.operation === 'rename') {
      const document = await vscode.workspace.openTextDocument(candidate.uri);
      return document.languageId;
    }

    return 'plaintext';
  }

  private isSafeWorkspacePath(pathLike: string): boolean {
    return !pathLike.startsWith('/')
      && !pathLike.includes('..')
      && !/[\*\?\[\]\{\}!]/.test(pathLike);
  }

  private isProtectedPath(pathLike: string): boolean {
    const segments = pathLike.split('/').filter(Boolean);
    const fileName = segments[segments.length - 1] ?? '';

    if (fileName.startsWith('.')) {
      return true;
    }

    if (PROTECTED_FILE_NAMES.has(fileName)) {
      return true;
    }

    if (/^\.env(\..+)?$/.test(fileName)) {
      return true;
    }

    return segments.some((segment) => segment.startsWith('.') || PROTECTED_PATH_SEGMENTS.has(segment));
  }

  private async readDiskSnapshot(uri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
  }

  private toFullRange(document: vscode.TextDocument): vscode.Range {
    const lastLine = document.lineCount - 1;
    return new vscode.Range(0, 0, lastLine, document.lineAt(lastLine).text.length);
  }

}