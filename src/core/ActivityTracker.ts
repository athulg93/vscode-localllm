export interface ToolCallActivity {
  id: string;
  timestamp: string;
  toolName: string;
  args: Record<string, unknown>;
  durationMs: number;
  status: 'running' | 'success' | 'error';
  summary: string;
  error?: string;
  rawOutput?: string;
}

export interface FileReadActivity {
  id: string;
  timestamp: string;
  path: string;
  startLine?: number;
  endLine?: number;
  lineCount: number;
  charCount: number;
  snippet?: string;
}

export interface PendingDiffActivityFile {
  path: string;
  operation: 'create' | 'update' | 'delete' | 'rename' | 'copy';
  newPath?: string;
  linesAdded?: number;
  linesRemoved?: number;
  summary?: string;
}

export interface PendingDiffActivity {
  id: string;
  timestamp: string;
  summary: string;
  status: 'pending' | 'applied' | 'discarded';
  files: PendingDiffActivityFile[];
}

export class ActivityTracker {
  private toolCalls: ToolCallActivity[] = [];
  private fileReads: FileReadActivity[] = [];
  private pendingDiffs: PendingDiffActivity[] = [];
  private listeners: Set<() => void> = new Set();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('Error notifying activity listener', err);
      }
    });
  }

  // Tool calls
  startToolCall(toolName: string, args: Record<string, unknown>): string {
    const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record: ToolCallActivity = {
      id,
      timestamp: new Date().toLocaleTimeString(),
      toolName,
      args,
      durationMs: 0,
      status: 'running',
      summary: this.summarizeArgs(toolName, args),
    };
    this.toolCalls.unshift(record);
    if (this.toolCalls.length > 100) this.toolCalls.pop();
    this.notify();
    return id;
  }

  finishToolCall(id: string, status: 'success' | 'error', durationMs: number, result?: string, error?: string): void {
    const found = this.toolCalls.find((t) => t.id === id);
    if (found) {
      found.status = status;
      found.durationMs = durationMs;
      found.rawOutput = result;
      found.error = error;
      if (status === 'error' && error) {
        found.summary = `Error: ${error}`;
      }
      this.notify();
    }
  }

  recordDirectToolCall(toolName: string, args: Record<string, unknown>, durationMs: number, status: 'success' | 'error', summary?: string): void {
    const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.toolCalls.unshift({
      id,
      timestamp: new Date().toLocaleTimeString(),
      toolName,
      args,
      durationMs,
      status,
      summary: summary || this.summarizeArgs(toolName, args),
    });
    if (this.toolCalls.length > 100) this.toolCalls.pop();
    this.notify();
  }

  // File reads
  recordFileRead(read: Omit<FileReadActivity, 'id' | 'timestamp'>): void {
    const id = `read_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.fileReads.unshift({
      ...read,
      id,
      timestamp: new Date().toLocaleTimeString(),
    });
    if (this.fileReads.length > 100) this.fileReads.pop();
    this.notify();
  }

  // Pending Diffs
  setPendingDiff(summary: string, files: PendingDiffActivityFile[]): string {
    const id = `diff_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.pendingDiffs.unshift({
      id,
      timestamp: new Date().toLocaleTimeString(),
      summary,
      status: 'pending',
      files,
    });
    if (this.pendingDiffs.length > 20) this.pendingDiffs.pop();
    this.notify();
    return id;
  }

  updatePendingDiffStatus(id: string, status: 'applied' | 'discarded'): void {
    const found = this.pendingDiffs.find((d) => d.id === id);
    if (found) {
      found.status = status;
      this.notify();
    }
  }

  clearPendingDiffs(): void {
    this.pendingDiffs = [];
    this.notify();
  }

  clearHistory(): void {
    this.toolCalls = [];
    this.fileReads = [];
    this.pendingDiffs = this.pendingDiffs.filter((d) => d.status === 'pending');
    this.notify();
  }

  getToolCalls(): ToolCallActivity[] {
    return [...this.toolCalls];
  }

  getFileReads(): FileReadActivity[] {
    return [...this.fileReads];
  }

  getPendingDiffs(): PendingDiffActivity[] {
    return [...this.pendingDiffs];
  }

  private summarizeArgs(name: string, args: Record<string, unknown>): string {
    if (name === 'read_file') {
      const path = typeof args.path === 'string' ? args.path : '';
      const range = args.startLine ? `lines ${args.startLine}-${args.endLine ?? 'end'}` : 'full';
      return `${path} (${range})`;
    }
    if (name === 'search_workspace') {
      return `"${args.query ?? ''}" in ${args.pathPrefix || 'entire workspace'}`;
    }
    if (name === 'list_workspace_files') {
      return `prefix: ${args.pathPrefix || '/'}`;
    }
    if (name === 'git_status') return 'git status';
    if (name === 'git_diff') return `git diff (${args.staged ? 'staged' : 'working tree'})`;
    if (name === 'git_pull') return 'git pull';
    if (name === 'git_push') return 'git push';
    if (name === 'git_log') return `git log (limit: ${args.maxCommits ?? 10})`;
    return JSON.stringify(args).slice(0, 60);
  }
}

export const globalActivityTracker = new ActivityTracker();
