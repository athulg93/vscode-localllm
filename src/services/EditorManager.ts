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
  path: string;
  content: string;
  summary?: string;
  uri: vscode.Uri;
};

export class EditorManager {
  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  async runEditWorkflow(options: EditWorkflowOptions): Promise<boolean> {
    const editPlan = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Planning file edits...' },
      async () => this.proposeEdits(options),
    );
    const edits = (editPlan.edits ?? []).filter((edit) => edit?.path && typeof edit.content === 'string');

    if (edits.length === 0) {
      options.stream.markdown('No concrete edits were proposed. Try a more specific request.');
      return true;
    }

    const preview = edits
      .slice(0, MAX_EDIT_FILES)
      .map((edit, index) => `${index + 1}. ${edit.path}${edit.summary ? ` - ${edit.summary}` : ''}`)
      .join('\n');

    options.stream.markdown([
      editPlan.summary ? `### Proposed Changes\n${editPlan.summary}\n` : '### Proposed Changes',
      preview,
      '',
      'Opened preview diffs for up to 3 files. Confirm to apply or cancel.',
    ].join('\n'));

    const candidates = await this.prepareEditCandidates(edits);
    await this.previewProposedEdits(candidates);

    const choice = await vscode.window.showInformationMessage(
      `Apply ${candidates.length} proposed file edit(s)?`,
      { modal: true },
      'Apply',
      'Cancel',
    );

    if (choice !== 'Apply') {
      options.stream.markdown('Edit plan was discarded.');
      return true;
    }

    const { applied, skipped } = await this.applyProposedEdits(candidates, edits);
    options.stream.markdown([
      '### Edit Result',
      '**Applied:**',
      applied.length ? applied.map((path) => `- ${path}`).join('\n') : '- none',
      '',
      '**Skipped:**',
      skipped.length ? skipped.map((item) => `- ${item}`).join('\n') : '- none',
    ].join('\n'));

    return true;
  }

  private async proposeEdits(options: EditWorkflowOptions): Promise<ProposedEditsResponse> {
    const contextualPrompt = await options.contextManager.buildPromptWithImplicitContext(options.prompt, {
      client: options.client,
      model: options.model,
      temperature: options.temperature,
      token: options.token,
    });
    const raw = await options.client.sendPrompt(options.model, contextualPrompt, options.temperature, {
      systemPrompt: EDIT_PLAN_SYSTEM_PROMPT,
      token: options.token,
    });

    try {
      return JSON.parse(this.extractJsonBlock(raw)) as ProposedEditsResponse;
    } catch {
      throw new Error('Could not parse edit plan from Ollama. Ask again with a more specific edit request.');
    }
  }

  private async prepareEditCandidates(edits: ProposedFileEdit[]): Promise<EditCandidate[]> {
    const candidates: EditCandidate[] = [];

    for (const edit of edits.slice(0, MAX_EDIT_FILES)) {
      const validation = await this.validateProposedEdit(edit);
      if (validation.ok) {
        candidates.push({
          path: edit.path,
          content: edit.content,
          summary: edit.summary,
          uri: validation.uri,
        });
      } else {
        this.outputChannel.appendLine(`[Edit] Skipping ${edit.path}: ${validation.reason}`);
      }
    }

    return candidates;
  }

  private async applyProposedEdits(candidates: EditCandidate[], sourceEdits: ProposedFileEdit[]): Promise<{ applied: string[]; skipped: string[] }> {
    const workspaceEdit = new vscode.WorkspaceEdit();
    const applied: string[] = [];
    const skipped = sourceEdits
      .slice(0, MAX_EDIT_FILES)
      .filter((edit) => !candidates.some((candidate) => candidate.path === edit.path))
      .map((edit) => `${edit.path} (failed validation)`);

    for (const candidate of candidates) {
      const document = await vscode.workspace.openTextDocument(candidate.uri);
      workspaceEdit.replace(candidate.uri, this.toFullRange(document), candidate.content);
      applied.push(vscode.workspace.asRelativePath(candidate.uri, false));
    }

    if (applied.length > 0) {
      await vscode.workspace.applyEdit(workspaceEdit);

      for (const candidate of candidates) {
        const document = await vscode.workspace.openTextDocument(candidate.uri);
        await document.save();
      }
    }

    return { applied, skipped };
  }

  private async previewProposedEdits(candidates: EditCandidate[]): Promise<void> {
    for (const candidate of candidates.slice(0, 3)) {
      const original = await vscode.workspace.openTextDocument({
        language: (await vscode.workspace.openTextDocument(candidate.uri)).languageId,
        content: await this.readDiskSnapshot(candidate.uri),
      });
      const preview = await vscode.workspace.openTextDocument({
        language: original.languageId,
        content: candidate.content,
      });

      const title = `Proposed: ${vscode.workspace.asRelativePath(candidate.uri, false)}`;
      await vscode.commands.executeCommand('vscode.diff', original.uri, preview.uri, title, { preview: true });
    }
  }

  private async validateProposedEdit(edit: ProposedFileEdit): Promise<{ ok: true; uri: vscode.Uri } | { ok: false; reason: string }> {
    const normalizedPath = edit.path.replace(/\\/g, '/');
    if (!this.isSafeWorkspacePath(normalizedPath)) {
      return { ok: false, reason: 'path is outside the allowed workspace rules' };
    }

    if (this.isProtectedPath(normalizedPath)) {
      return { ok: false, reason: 'path is protected' };
    }

    const matches = await vscode.workspace.findFiles(normalizedPath, undefined, 2);
    if (matches.length !== 1) {
      return { ok: false, reason: 'path was not uniquely found in the workspace' };
    }

    const uri = matches[0];
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.isDirty) {
      return { ok: false, reason: 'file has unsaved changes' };
    }

    if (document.getText().length > MAX_APPLY_FILE_CHARS || edit.content.length > MAX_APPLY_FILE_CHARS) {
      return { ok: false, reason: `file exceeds safe replace size of ${MAX_APPLY_FILE_CHARS} characters` };
    }

    return { ok: true, uri };
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
}