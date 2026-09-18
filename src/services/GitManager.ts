import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { Logger, ToolDefinition } from '../core/contracts';
import { ActivityTracker } from '../core/ActivityTracker';
import { GitErrorDiagnoser } from './GitErrorDiagnoser';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_CHARS = 12_000;
const SAFE_NAME = /^[A-Za-z0-9._/-]+$/;

type GitArguments = Record<string, unknown>;

export class GitManager {
  constructor(
    private readonly outputChannel: Logger,
    private readonly activityTracker?: ActivityTracker,
  ) {}

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'git_status',
        description: 'Show the current branch and bounded working-tree status for the workspace repository.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'git_diff',
        description: 'Show a bounded diff for the workspace repository. Set staged=true to inspect staged changes.',
        parameters: {
          type: 'object',
          properties: { staged: { type: 'boolean', description: 'Inspect staged changes instead of unstaged changes.' } },
        },
      },
      {
        name: 'git_log',
        description: 'Show recent commits from the workspace repository.',
        parameters: {
          type: 'object',
          properties: { maxEntries: { type: 'integer', minimum: 1, maximum: 20 } },
        },
      },
      {
        name: 'git_branch',
        description: 'Show local branches and the current branch.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'git_checkout',
        description: 'Switch to an existing local branch. This always requires user confirmation and never creates or deletes branches.',
        parameters: {
          type: 'object',
          properties: { branch: { type: 'string', description: 'Existing local branch name.' } },
          required: ['branch'],
        },
      },
      {
        name: 'git_add',
        description: 'Stage specific workspace-relative paths. This always requires user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            paths: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Paths to stage.' },
          },
          required: ['paths'],
        },
      },
      {
        name: 'git_commit',
        description: 'Commit already-staged changes with the supplied message. This always requires user confirmation.',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string', description: 'Commit message.' } },
          required: ['message'],
        },
      },
      {
        name: 'git_push',
        description: 'Push commits to remote repository (e.g. origin or gitlab) and active or specified branch. Do not pass filler words like "latest" or "changes" as remote or branch.',
        parameters: {
          type: 'object',
          properties: {
            remote: { type: 'string', description: 'Configured Git remote name (e.g. origin, gitlab, upstream). Omit to use configured tracking remote.' },
            branch: { type: 'string', description: 'Git branch name (e.g. main, 1.4). Omit to use active branch.' },
            setUpstream: { type: 'boolean', description: 'Set upstream tracking for this branch (-u / --set-upstream).' },
          },
        },
      },
      {
        name: 'git_pull',
        description: 'Pull latest commits from remote repository (e.g. origin or gitlab) and active or specified branch. Do not pass filler words like "latest" or "changes" as remote or branch.',
        parameters: {
          type: 'object',
          properties: {
            remote: { type: 'string', description: 'Configured Git remote name (e.g. origin, gitlab, upstream). Omit to use configured tracking remote.' },
            branch: { type: 'string', description: 'Git branch name (e.g. main, 1.4). Omit to use active branch.' },
            rebase: { type: 'boolean', description: 'Rebase local commits on top of incoming remote branch instead of merging.' },
            autostash: { type: 'boolean', description: 'Automatically create a temporary stash before rebase and apply it after.' },
          },
        },
      },
      {
        name: 'git_stash',
        description: 'Manage uncommitted changes using Git stash. action: "push" (save dirty changes), "pop" (re-apply and remove newest stash), "apply" (re-apply without removing), "list" (view stashes), "drop" (remove newest stash).',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['push', 'pop', 'apply', 'list', 'drop'],
              description: 'Stash action to execute. Defaults to "push".',
            },
            message: { type: 'string', description: 'Optional stash description message when action is "push".' },
            includeUntracked: { type: 'boolean', description: 'Include untracked files when pushing to stash.' },
          },
        },
      },
      {
        name: 'git_fetch',
        description: 'Fetch latest commits, refs, and branches from a remote repository without merging.',
        parameters: {
          type: 'object',
          properties: {
            remote: { type: 'string', description: 'Configured Git remote name (e.g. origin, gitlab). Omit to fetch from default remote.' },
            prune: { type: 'boolean', description: 'Before fetching, remove any remote-tracking references that no longer exist on remote.' },
          },
        },
      },
      {
        name: 'git_remote',
        description: 'List configured Git remotes (origin, gitlab, github, etc.) and inspect their URLs with host provider detection.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'git_merge',
        description: 'Merge an existing local branch into the current branch. This always requires user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            branch: { type: 'string', description: 'Existing local branch name to merge into active branch.' },
          },
          required: ['branch'],
        },
      },
    ];
  }

  async executeTool(name: string, arguments_: GitArguments): Promise<string> {
    const startTime = Date.now();
    let result: string;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      result = this.error('No workspace folder is open.', name, arguments_);
    } else {
      try {
        switch (name) {
          case 'git_status':
            result = await this.run(workspaceFolder.uri.fsPath, ['status', '--short', '--branch']);
            break;
          case 'git_diff':
            result = await this.run(workspaceFolder.uri.fsPath, ['diff', ...(arguments_.staged === true ? ['--cached'] : [])]);
            break;
          case 'git_log':
            result = await this.run(workspaceFolder.uri.fsPath, ['log', `-${this.toEntryLimit(arguments_.maxEntries)}`, '--oneline', '--decorate']);
            break;
          case 'git_branch':
            result = await this.run(workspaceFolder.uri.fsPath, ['branch', '--all', '--verbose']);
            break;
          case 'git_checkout':
            result = await this.checkout(workspaceFolder.uri.fsPath, arguments_);
            break;
          case 'git_add':
            result = await this.add(workspaceFolder.uri.fsPath, arguments_);
            break;
          case 'git_commit':
            result = await this.commit(workspaceFolder.uri.fsPath, arguments_);
            break;
          case 'git_push':
            result = await this.pushOrPull(workspaceFolder.uri.fsPath, 'push', arguments_);
            break;
          case 'git_pull':
            result = await this.pushOrPull(workspaceFolder.uri.fsPath, 'pull', arguments_);
            break;
          case 'git_stash':
            result = await this.stash(workspaceFolder.uri.fsPath, arguments_);
            break;
          case 'git_fetch':
            result = await this.fetch(workspaceFolder.uri.fsPath, arguments_);
            break;
          case 'git_remote':
            result = await this.remote(workspaceFolder.uri.fsPath);
            break;
          case 'git_merge':
            result = await this.merge(workspaceFolder.uri.fsPath, arguments_);
            break;
          default:
            result = this.error(`Unknown Git tool: ${name}`, name, arguments_);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[Git] ${name} failed: ${message}`);
        result = this.error(message, name, arguments_);
      }
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    const hasError = result.includes('"error"');
    this.activityTracker?.recordDirectToolCall(
      name,
      arguments_,
      durationMs,
      hasError ? 'error' : 'success'
    );

    return result;
  }

  private async add(cwd: string, arguments_: GitArguments): Promise<string> {
    const paths = this.getPaths(arguments_.paths);
    if (paths.length === 0) {
      return this.error('At least one workspace-relative path is required.');
    }
    if (paths.some((path) => this.isSensitivePath(path))) {
      return this.error('Staging sensitive files such as .env files is blocked.');
    }

    const approved = await this.confirm(`Stage these Git paths?\n\n${paths.join('\n')}`);
    if (!approved) {
      return this.cancelled();
    }

    return this.run(cwd, ['add', '--', ...paths]);
  }

  private async commit(cwd: string, arguments_: GitArguments): Promise<string> {
    const message = typeof arguments_.message === 'string' ? arguments_.message.trim() : '';
    if (!message) {
      return this.error('A non-empty commit message is required.');
    }

    const approved = await this.confirm(`Commit staged changes with this message?\n\n${message}`);
    if (!approved) {
      return this.cancelled();
    }

    return this.run(cwd, ['commit', '-m', message]);
  }

  private async checkout(cwd: string, arguments_: GitArguments): Promise<string> {
    const branch = this.getOptionalName(arguments_.branch, 'branch');
    if (!branch) {
      return this.error('An existing local branch name is required.');
    }
    if (branch.includes('..')) {
      return this.error('Invalid branch name.');
    }

    const status = await this.run(cwd, ['status', '--short']);
    const dirtyWarning = status === 'Git operation completed successfully.'
      ? 'The working tree is clean.'
      : `The working tree has changes:\n\n${status}`;
    const approved = await this.confirm(`Switch to local branch "${branch}"?\n\n${dirtyWarning}`);
    if (!approved) {
      return this.cancelled();
    }

    return this.run(cwd, ['checkout', branch]);
  }

  private static readonly FILLER_WORDS = new Set([
    'latest', 'changes', 'new', 'recent', 'updates', 'update', 'code',
    'repo', 'repository', 'commits', 'commit', 'all', 'the', 'from',
    'to', 'in', 'my', 'please', 'now', 'local', 'workspace', 'branch', 'remote'
  ]);

  private async pushOrPull(cwd: string, operation: 'push' | 'pull', arguments_: GitArguments): Promise<string> {
    const rawRemote = this.getOptionalName(arguments_.remote, 'remote');
    const rawBranch = this.getOptionalName(arguments_.branch, 'branch');
    if (rawRemote === null || rawBranch === null) {
      return this.error(
        'Remote and branch names may contain only letters, numbers, dots, underscores, slashes, and hyphens.',
        `git_${operation}`,
        arguments_
      );
    }

    const { remote, branch } = await this.resolveRemoteAndBranch(cwd, rawRemote, rawBranch);

    const target = [remote, branch].filter((value): value is string => Boolean(value)).join(' ');
    const approved = await this.confirm(`${operation === 'push' ? 'Push' : 'Pull'} ${target || 'the configured upstream'}?`);
    if (!approved) {
      return this.cancelled();
    }

    const flags: string[] = [];
    if (operation === 'push' && arguments_.setUpstream === true) {
      flags.push('--set-upstream');
    }
    if (operation === 'pull') {
      if (arguments_.rebase === true) {
        flags.push('--rebase');
      }
      if (arguments_.autostash === true) {
        flags.push('--autostash');
      }
    }

    return this.run(cwd, [operation, ...flags, ...(remote ? [remote] : []), ...(branch ? [branch] : [])]);
  }

  private async stash(cwd: string, arguments_: GitArguments): Promise<string> {
    const rawAction = typeof arguments_.action === 'string' ? arguments_.action.trim().toLowerCase() : 'push';
    const action = ['push', 'pop', 'apply', 'list', 'drop'].includes(rawAction) ? rawAction : 'push';
    const message = typeof arguments_.message === 'string' ? arguments_.message.trim() : '';

    if (action === 'list') {
      return this.run(cwd, ['stash', 'list']);
    }

    let confirmPrompt = 'Execute Git stash operation?';
    if (action === 'push') {
      confirmPrompt = `Stash uncommitted local changes?${message ? `\nMessage: "${message}"` : ''}`;
    } else if (action === 'pop') {
      confirmPrompt = 'Restore and pop the newest stashed changes into your working tree?';
    } else if (action === 'apply') {
      confirmPrompt = 'Apply the newest stashed changes to your working tree (retaining the stash)?';
    } else if (action === 'drop') {
      confirmPrompt = 'Drop and permanently remove the newest stash entry?';
    }

    const approved = await this.confirm(confirmPrompt);
    if (!approved) {
      return this.cancelled();
    }

    const args = ['stash', action];
    if (action === 'push') {
      if (arguments_.includeUntracked === true) {
        args.push('--include-untracked');
      }
      if (message) {
        args.push('-m', message);
      }
    }

    return this.run(cwd, args);
  }

  private async fetch(cwd: string, arguments_: GitArguments): Promise<string> {
    const rawRemote = this.getOptionalName(arguments_.remote, 'remote');
    if (rawRemote === null) {
      return this.error(
        'Remote name may contain only letters, numbers, dots, underscores, slashes, and hyphens.',
        'git_fetch',
        arguments_
      );
    }

    const remote = rawRemote ? (await this.resolveRemoteAndBranch(cwd, rawRemote)).remote : undefined;
    const args = ['fetch', ...(remote ? [remote] : []), ...(arguments_.prune === true ? ['--prune'] : [])];
    return this.run(cwd, args);
  }

  private async resolveRemoteAndBranch(
    cwd: string,
    rawRemote?: string,
    rawBranch?: string,
  ): Promise<{ remote?: string; branch?: string }> {
    let cleanRemote = rawRemote?.trim() || undefined;
    let cleanBranch = rawBranch?.trim() || undefined;

    if (cleanRemote && GitManager.FILLER_WORDS.has(cleanRemote.toLowerCase())) {
      this.outputChannel.appendLine(`[Git] Filtered out natural-language filler remote: "${cleanRemote}".`);
      cleanRemote = undefined;
    }

    if (cleanBranch && GitManager.FILLER_WORDS.has(cleanBranch.toLowerCase())) {
      this.outputChannel.appendLine(`[Git] Filtered out natural-language filler branch: "${cleanBranch}".`);
      cleanBranch = undefined;
    }

    // Check configured remotes
    let configuredRemotes: string[] = [];
    try {
      const remoteRes = await this.run(cwd, ['remote']);
      if (remoteRes && remoteRes !== 'Git operation completed successfully.') {
        configuredRemotes = remoteRes.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
      }
    } catch {
      // Ignored
    }

    if (cleanRemote && !configuredRemotes.includes(cleanRemote)) {
      // Check if cleanRemote is actually a known branch (e.g. user ran "git pull 1.4" or "git pull main")
      let isBranch = false;
      try {
        const branchRes = await this.run(cwd, ['branch', '-a']);
        if (branchRes) {
          const branchLines = branchRes.split(/\r?\n/).map((b) => b.replace(/^[*+\s]+/, '').trim());
          isBranch = branchLines.some((b) => b === cleanRemote || b.endsWith(`/${cleanRemote}`));
        }
      } catch {
        // Ignored
      }

      if (isBranch && !cleanBranch) {
        this.outputChannel.appendLine(`[Git] Argument "${cleanRemote}" detected as a branch name rather than a remote; using as branch.`);
        cleanBranch = cleanRemote;
        cleanRemote = undefined;
      } else if (!isBranch && configuredRemotes.length > 0) {
        this.outputChannel.appendLine(`[Git] Remote "${cleanRemote}" is not in configured remotes [${configuredRemotes.join(', ')}]; omitting.`);
        cleanRemote = undefined;
      }
    }

    return { remote: cleanRemote, branch: cleanBranch };
  }

  private async remote(cwd: string): Promise<string> {
    const output = await this.run(cwd, ['remote', '-v']);
    if (!output || output === 'Git operation completed successfully.') {
      return 'No Git remotes configured for this repository.\n\nTo link to GitLab or GitHub, use:\n  git remote add origin <url>';
    }

    const providers: string[] = [];
    if (/gitlab/i.test(output)) providers.push('GitLab');
    if (/github/i.test(output)) providers.push('GitHub');
    if (/bitbucket/i.test(output)) providers.push('Bitbucket');

    const providerHeader = providers.length > 0
      ? `Configured Git Remotes [Detected Provider: ${providers.join(', ')}]:`
      : 'Configured Git Remotes:';

    return `${providerHeader}\n\n${output}`;
  }

  private async merge(cwd: string, arguments_: GitArguments): Promise<string> {
    const branch = this.getOptionalName(arguments_.branch, 'branch');
    if (!branch) {
      return this.error('A branch name to merge is required.');
    }
    if (branch.includes('..')) {
      return this.error('Invalid branch name.');
    }

    let currentBranch = 'active branch';
    try {
      const branchRes = await this.run(cwd, ['branch', '--show-current']);
      if (branchRes && branchRes !== 'Git operation completed successfully.') {
        currentBranch = branchRes.trim();
      }
    } catch {}

    const approved = await this.confirm(`Merge local branch "${branch}" into current branch "${currentBranch}"?`);
    if (!approved) {
      return this.cancelled();
    }

    return this.run(cwd, ['merge', branch]);
  }

  private async confirm(message: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `Local Ollama wants to run a Git operation.\n\n${message}`,
      { modal: true },
      'Allow',
    );
    return choice === 'Allow';
  }

  private async run(cwd: string, args: string[]): Promise<string> {
    this.outputChannel.appendLine(`[Git] Running git ${args.join(' ')}`);
    const result = await execFileAsync('git', ['--no-optional-locks', ...args], {
      cwd,
      maxBuffer: MAX_OUTPUT_CHARS * 2,
      timeout: 60_000,
      windowsHide: true,
    });
    const output = `${result.stdout}${result.stderr}`.trim();
    return output ? this.truncate(output) : 'Git operation completed successfully.';
  }

  private getPaths(value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw new Error('The paths argument must be a non-empty array of workspace-relative paths.');
    }

    const paths = value.map((path) => {
      if (typeof path !== 'string') {
        throw new Error('Every Git path must be a string.');
      }

      const normalizedPath = path.replace(/\\/g, '/').trim();
      if (!normalizedPath || !SAFE_NAME.test(normalizedPath) || normalizedPath.split('/').includes('..')) {
        throw new Error(`Git path is not a safe workspace-relative path: ${path}`);
      }

      return normalizedPath;
    });

    if (paths.length === 0) {
      throw new Error('The paths argument must contain at least one path.');
    }

    return paths;
  }

  private getOptionalName(value: unknown, label: string): string | undefined | null {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string' || !value.trim() || value.trim().startsWith('-') || !SAFE_NAME.test(value.trim())) {
      this.outputChannel.appendLine(`[Git] Invalid ${label} name supplied.`);
      return null;
    }
    return value.trim();
  }

  private isSensitivePath(path: string): boolean {
    return path.split('/').some((segment) => segment === '.env' || segment.startsWith('.env.'));
  }

  private toEntryLimit(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) ? Math.min(Math.max(value, 1), 20) : 10;
  }

  private truncate(value: string): string {
    return value.length <= MAX_OUTPUT_CHARS ? value : `${value.slice(0, MAX_OUTPUT_CHARS)}\n[Git output truncated]`;
  }

  private error(message: string, commandName: string = 'git', commandArgs: GitArguments = {}): string {
    const diagnosis = GitErrorDiagnoser.diagnose(commandName, message, commandArgs);
    const report = GitErrorDiagnoser.formatDiagnosticReport(diagnosis);
    return JSON.stringify({
      success: false,
      error: message,
      category: diagnosis.category,
      diagnosis,
      report,
      agentGuidance: diagnosis.agentGuidance,
    });
  }

  private cancelled(): string {
    return JSON.stringify({ cancelled: true, message: 'The user did not approve this Git operation.' });
  }
}
