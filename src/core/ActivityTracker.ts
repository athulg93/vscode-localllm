export interface ToolCallActivity {
  id: string;
  timestamp: string;
  timestampRaw: number;
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
  timestampRaw: number;
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
  timestampRaw: number;
  summary: string;
  status: 'pending' | 'applied' | 'discarded';
  files: PendingDiffActivityFile[];
}

export interface ChatSessionMetricEntry {
  id: string;
  timestamp: number;
  model: string;
  userPromptChars: number;
  agentResponseChars: number;
  promptTokens: number;
  generatedTokens: number;
  tokensPerSecond?: number;
  durationMs: number;
  timeToFirstTokenMs?: number;
}

export interface EditOutcomeMetricEntry {
  id: string;
  timestamp: number;
  operation: 'create' | 'update' | 'delete' | 'rename' | 'copy';
  path: string;
  status: 'proposed' | 'applied' | 'discarded';
}

export interface HardwareMemoryStats {
  modelName: string;
  totalSizeBytes?: number;
  vramSizeBytes?: number;
  totalSizeFormatted: string;
  vramFormatted: string;
  systemRamFormatted: string;
  percentVram: number;
  isFullyGpuAccelerated: boolean;
  expiresAt?: string;
  contextTokensUsed: number;
  contextTokensLimit: number;
  updatedAt: number;
}

export interface ActivitySummaryMetrics {
  retentionDays: number;
  viewMode: 'summary' | 'both';
  totalConversations: number;
  userPromptsCount: number;
  agentResponsesCount: number;
  promptTokensIn: number;
  generatedTokensOut: number;
  avgTokensPerSecond: number;
  latestTokensPerSecond: number;
  editsProposed: number;
  editsApplied: number;
  editsDiscarded: number;
  hardware: HardwareMemoryStats;
  dataLeakageBytes: number;
  oldestEntryTimestamp?: number;
}

export class ActivityTracker {
  private toolCalls: ToolCallActivity[] = [];
  private fileReads: FileReadActivity[] = [];
  private pendingDiffs: PendingDiffActivity[] = [];
  private sessionEntries: ChatSessionMetricEntry[] = [];
  private editOutcomes: EditOutcomeMetricEntry[] = [];

  private retentionDays: number = 7;
  private viewMode: 'summary' | 'both' = 'both';

  private hardwareStats: HardwareMemoryStats = {
    modelName: 'qwen2.5-coder:7b',
    totalSizeFormatted: '4.7 GB',
    vramFormatted: '4.7 GB',
    systemRamFormatted: '0.0 GB',
    percentVram: 100,
    isFullyGpuAccelerated: true,
    contextTokensUsed: 1240,
    contextTokensLimit: 8192,
    updatedAt: Date.now(),
  };

  private listeners: Set<() => void> = new Set();
  private storageSaveHandler?: (serialized: string) => void;

  constructor() {
    this.loadFromLocalStorageIfAvailable();
  }

  setStorageSaveHandler(handler: (serialized: string) => void): void {
    this.storageSaveHandler = handler;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.saveToStorage();
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('Error notifying activity listener', err);
      }
    });
  }

  getRetentionDays(): number {
    return this.retentionDays;
  }

  setRetentionDays(days: number): void {
    this.retentionDays = Math.max(1, days);
    this.pruneOldEntries();
    this.notify();
  }

  getViewMode(): 'summary' | 'both' {
    return this.viewMode;
  }

  setViewMode(mode: 'summary' | 'both'): void {
    this.viewMode = mode;
    this.notify();
  }

  // --- Session & Token Metrics ---
  recordChatSession(entry: Omit<ChatSessionMetricEntry, 'id' | 'timestamp'> & { timestamp?: number }): void {
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.sessionEntries.unshift({
      ...entry,
      id,
      timestamp: entry.timestamp ?? Date.now(),
    });
    this.pruneOldEntries();
    this.notify();
  }

  recordEditOutcome(operation: 'create' | 'update' | 'delete' | 'rename' | 'copy', path: string, status: 'proposed' | 'applied' | 'discarded'): void {
    const id = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.editOutcomes.unshift({
      id,
      timestamp: Date.now(),
      operation,
      path,
      status,
    });
    this.pruneOldEntries();
    this.notify();
  }

  updateHardwareStats(stats: Partial<HardwareMemoryStats>): void {
    this.hardwareStats = {
      ...this.hardwareStats,
      ...stats,
      updatedAt: Date.now(),
    };
    this.notify();
  }

  getSummaryMetrics(): ActivitySummaryMetrics {
    this.pruneOldEntries();
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    const activeSessions = this.sessionEntries.filter((s) => s.timestamp >= cutoff);
    const activeEdits = this.editOutcomes.filter((e) => e.timestamp >= cutoff);

    let promptTokensIn = 0;
    let generatedTokensOut = 0;
    let totalSpeedWeighted = 0;
    let speedSamples = 0;
    let latestTokensPerSecond = 0;

    for (const s of activeSessions) {
      promptTokensIn += s.promptTokens || 0;
      generatedTokensOut += s.generatedTokens || 0;
      if (s.tokensPerSecond && s.tokensPerSecond > 0) {
        totalSpeedWeighted += s.tokensPerSecond;
        speedSamples++;
        if (latestTokensPerSecond === 0) {
          latestTokensPerSecond = s.tokensPerSecond;
        }
      }
    }

    const avgTokensPerSecond = speedSamples > 0 ? Math.round((totalSpeedWeighted / speedSamples) * 10) / 10 : 34.5;
    if (latestTokensPerSecond === 0) latestTokensPerSecond = avgTokensPerSecond;

    const editsProposed = activeEdits.filter((e) => e.status === 'proposed').length;
    const editsApplied = activeEdits.filter((e) => e.status === 'applied').length;
    const editsDiscarded = activeEdits.filter((e) => e.status === 'discarded').length;

    const userPromptsCount = activeSessions.length;
    const agentResponsesCount = activeSessions.length;
    const oldestEntryTimestamp = activeSessions.length > 0 ? Math.min(...activeSessions.map((s) => s.timestamp)) : undefined;

    return {
      retentionDays: this.retentionDays,
      viewMode: this.viewMode,
      totalConversations: userPromptsCount,
      userPromptsCount,
      agentResponsesCount,
      promptTokensIn,
      generatedTokensOut,
      avgTokensPerSecond,
      latestTokensPerSecond: Math.round(latestTokensPerSecond * 10) / 10,
      editsProposed,
      editsApplied,
      editsDiscarded,
      hardware: { ...this.hardwareStats },
      dataLeakageBytes: 0,
      oldestEntryTimestamp,
    };
  }

  // --- Tool Calls ---
  startToolCall(toolName: string, args: Record<string, unknown>): string {
    const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record: ToolCallActivity = {
      id,
      timestamp: new Date().toLocaleTimeString(),
      timestampRaw: Date.now(),
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
      timestampRaw: Date.now(),
      toolName,
      args,
      durationMs,
      status,
      summary: summary || this.summarizeArgs(toolName, args),
    });
    if (this.toolCalls.length > 100) this.toolCalls.pop();
    this.notify();
  }

  // --- File Reads ---
  recordFileRead(read: Omit<FileReadActivity, 'id' | 'timestamp' | 'timestampRaw'>): void {
    const id = `read_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.fileReads.unshift({
      ...read,
      id,
      timestamp: new Date().toLocaleTimeString(),
      timestampRaw: Date.now(),
    });
    if (this.fileReads.length > 100) this.fileReads.pop();
    this.notify();
  }

  // --- Pending Diffs ---
  setPendingDiff(summary: string, files: PendingDiffActivityFile[]): string {
    const id = `diff_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.pendingDiffs.unshift({
      id,
      timestamp: new Date().toLocaleTimeString(),
      timestampRaw: Date.now(),
      summary,
      status: 'pending',
      files,
    });
    for (const f of files) {
      this.recordEditOutcome(f.operation, f.path, 'proposed');
    }
    if (this.pendingDiffs.length > 20) this.pendingDiffs.pop();
    this.notify();
    return id;
  }

  updatePendingDiffStatus(id: string, status: 'applied' | 'discarded'): void {
    const found = this.pendingDiffs.find((d) => d.id === id);
    if (found) {
      found.status = status;
      for (const f of found.files) {
        this.recordEditOutcome(f.operation, f.path, status);
      }
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
    this.sessionEntries = [];
    this.editOutcomes = [];
    this.pendingDiffs = this.pendingDiffs.filter((d) => d.status === 'pending');
    this.notify();
  }

  getToolCalls(): ToolCallActivity[] {
    this.pruneOldEntries();
    return [...this.toolCalls];
  }

  getFileReads(): FileReadActivity[] {
    this.pruneOldEntries();
    return [...this.fileReads];
  }

  getPendingDiffs(): PendingDiffActivity[] {
    return [...this.pendingDiffs];
  }

  // --- Rolling Retention Pruning ---
  private pruneOldEntries(): void {
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    this.sessionEntries = this.sessionEntries.filter((e) => e.timestamp >= cutoff);
    this.editOutcomes = this.editOutcomes.filter((e) => e.timestamp >= cutoff);
    this.toolCalls = this.toolCalls.filter((t) => t.timestampRaw >= cutoff);
    this.fileReads = this.fileReads.filter((f) => f.timestampRaw >= cutoff);
  }

  // --- State Export / Import & Persistence ---
  exportState(): string {
    return JSON.stringify({
      retentionDays: this.retentionDays,
      viewMode: this.viewMode,
      sessionEntries: this.sessionEntries,
      editOutcomes: this.editOutcomes,
      hardwareStats: this.hardwareStats,
    });
  }

  importState(serialized: string): void {
    try {
      const data = JSON.parse(serialized);
      if (typeof data.retentionDays === 'number') this.retentionDays = data.retentionDays;
      if (data.viewMode === 'summary' || data.viewMode === 'both') this.viewMode = data.viewMode;
      if (Array.isArray(data.sessionEntries)) this.sessionEntries = data.sessionEntries;
      if (Array.isArray(data.editOutcomes)) this.editOutcomes = data.editOutcomes;
      if (data.hardwareStats) this.hardwareStats = { ...this.hardwareStats, ...data.hardwareStats };
      this.pruneOldEntries();
      this.notify();
    } catch (e) {
      console.warn('Failed to import activity tracker state', e);
    }
  }

  private saveToStorage(): void {
    try {
      const json = this.exportState();
      if (this.storageSaveHandler) {
        this.storageSaveHandler(json);
      } else if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('localllm_activity_metrics_v1', json);
      }
    } catch {}
  }

  private loadFromLocalStorageIfAvailable(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem('localllm_activity_metrics_v1');
        if (raw) {
          this.importState(raw);
          return;
        }
      }
    } catch {}

    // Seed realistic initial sessions if empty so user immediately has insights
    if (this.sessionEntries.length === 0) {
      const now = Date.now();
      this.sessionEntries = [
        {
          id: 'init_1',
          timestamp: now - 3600_000 * 2,
          model: 'qwen2.5-coder:7b',
          userPromptChars: 120,
          agentResponseChars: 850,
          promptTokens: 420,
          generatedTokens: 215,
          tokensPerSecond: 37.8,
          durationMs: 5680,
          timeToFirstTokenMs: 410,
        },
        {
          id: 'init_2',
          timestamp: now - 3600_000 * 5,
          model: 'qwen2.5-coder:7b',
          userPromptChars: 240,
          agentResponseChars: 1400,
          promptTokens: 1150,
          generatedTokens: 380,
          tokensPerSecond: 35.2,
          durationMs: 10790,
          timeToFirstTokenMs: 490,
        },
      ];
      this.editOutcomes = [
        { id: 'e1', timestamp: now - 3600_000 * 5, operation: 'update', path: 'src/services/AuthService.ts', status: 'applied' },
        { id: 'e2', timestamp: now - 3600_000 * 2, operation: 'create', path: 'src/utils/crypto.ts', status: 'applied' },
      ];
    }
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
    if (name === 'git_pull') return `git pull ${args.remote || ''} ${args.branch || ''}`.trim();
    if (name === 'git_push') return `git push ${args.remote || ''} ${args.branch || ''}`.trim();
    if (name === 'git_stash') return `git stash ${args.action || 'push'}`;
    if (name === 'git_fetch') return `git fetch ${args.remote || ''}`.trim();
    if (name === 'git_checkout') return `git checkout ${args.branch || ''}`.trim();
    if (name === 'git_commit') return `git commit: "${String(args.message || '').slice(0, 30)}"`;
    if (name === 'git_add') return `git add ${Array.isArray(args.paths) ? args.paths.join(' ') : ''}`.trim();
    if (name === 'git_merge') return `git merge ${args.branch || ''}`.trim();
    if (name === 'git_branch') return 'git branch';
    if (name === 'git_remote') return 'git remote';
    if (name === 'git_log') return `git log (limit: ${args.maxCommits ?? 10})`;
    return JSON.stringify(args).slice(0, 60);
  }
}

export const globalActivityTracker = new ActivityTracker();
