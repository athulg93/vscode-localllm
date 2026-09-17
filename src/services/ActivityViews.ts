import * as vscode from 'vscode';
import {
  ActivityTracker,
  FileReadActivity,
  PendingDiffActivity,
  PendingDiffActivityFile,
  ToolCallActivity,
} from '../core/ActivityTracker';

export class PendingDiffsTreeDataProvider implements vscode.TreeDataProvider<PendingDiffTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<PendingDiffTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<PendingDiffTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private readonly tracker: ActivityTracker) {
    this.tracker.subscribe(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PendingDiffTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PendingDiffTreeItem): Thenable<PendingDiffTreeItem[]> {
    if (!element) {
      const diffs = this.tracker.getPendingDiffs();
      if (diffs.length === 0) {
        const item = new PendingDiffTreeItem('No pending diffs', vscode.TreeItemCollapsibleState.None);
        item.description = 'All edits applied or clean';
        item.iconPath = new vscode.ThemeIcon('check-all');
        return Promise.resolve([item]);
      }
      return Promise.resolve(diffs.map((diff) => new PendingDiffTreeItem(diff, vscode.TreeItemCollapsibleState.Expanded)));
    }

    if (element.diff) {
      return Promise.resolve(
        element.diff.files.map((file) => new PendingDiffTreeItem(file, vscode.TreeItemCollapsibleState.None, element.diff)),
      );
    }

    return Promise.resolve([]);
  }
}

export class PendingDiffTreeItem extends vscode.TreeItem {
  constructor(
    public readonly data: string | PendingDiffActivity | PendingDiffActivityFile,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly parentDiff?: PendingDiffActivity,
  ) {
    let label = '';
    if (typeof data === 'string') {
      label = data;
    } else if ('files' in data) {
      label = data.summary || `Proposed Edit Plan (${data.timestamp})`;
    } else {
      label = data.path;
    }

    super(label, collapsibleState);

    if (typeof data !== 'string') {
      if ('files' in data) {
        this.contextValue = 'pendingDiffGroup';
        this.description = `${data.status.toUpperCase()} • ${data.files.length} file(s)`;
        this.iconPath = data.status === 'pending'
          ? new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.orange'))
          : data.status === 'applied'
            ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'))
            : new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.red'));
      } else {
        this.contextValue = 'pendingDiffFile';
        const file = data as PendingDiffActivityFile;
        const op = file.operation.toUpperCase();
        const added = file.linesAdded ? `+${file.linesAdded}` : '';
        const removed = file.linesRemoved ? `-${file.linesRemoved}` : '';
        this.description = [op, added, removed].filter(Boolean).join(' ');
        this.tooltip = file.summary || `${file.operation} ${file.path}`;

        if (file.operation === 'create') {
          this.iconPath = new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'));
        } else if (file.operation === 'delete') {
          this.iconPath = new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
        } else {
          this.iconPath = new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
        }

        this.command = {
          command: 'localOllama.reviewPlan',
          title: 'Review Diff Plan',
        };
      }
    }
  }

  get diff(): PendingDiffActivity | undefined {
    if (typeof this.data !== 'string' && 'files' in this.data) {
      return this.data as PendingDiffActivity;
    }
    return undefined;
  }
}

export class ToolCallsTreeDataProvider implements vscode.TreeDataProvider<ToolCallTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ToolCallTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ToolCallTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private readonly tracker: ActivityTracker) {
    this.tracker.subscribe(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ToolCallTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ToolCallTreeItem): Thenable<ToolCallTreeItem[]> {
    if (!element) {
      const calls = this.tracker.getToolCalls();
      if (calls.length === 0) {
        const item = new ToolCallTreeItem('No tool calls recorded', vscode.TreeItemCollapsibleState.None);
        item.description = 'Awaiting chat interactions';
        item.iconPath = new vscode.ThemeIcon('info');
        return Promise.resolve([item]);
      }
      return Promise.resolve(calls.map((c) => new ToolCallTreeItem(c, vscode.TreeItemCollapsibleState.Collapsed)));
    }

    if (element.call) {
      const items: ToolCallTreeItem[] = [];
      items.push(new ToolCallTreeItem(`Duration: ${element.call.durationMs}ms [${element.call.status}]`, vscode.TreeItemCollapsibleState.None));
      items.push(new ToolCallTreeItem(`Args: ${JSON.stringify(element.call.args)}`, vscode.TreeItemCollapsibleState.None));
      if (element.call.rawOutput) {
        const preview = element.call.rawOutput.slice(0, 150).replace(/\n/g, ' ');
        items.push(new ToolCallTreeItem(`Result: ${preview}...`, vscode.TreeItemCollapsibleState.None));
      }
      if (element.call.error) {
        items.push(new ToolCallTreeItem(`Error: ${element.call.error}`, vscode.TreeItemCollapsibleState.None));
      }
      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }
}

export class ToolCallTreeItem extends vscode.TreeItem {
  constructor(
    public readonly data: string | ToolCallActivity,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    let label = '';
    if (typeof data === 'string') {
      label = data;
    } else {
      label = `${data.toolName}`;
    }

    super(label, collapsibleState);

    if (typeof data !== 'string') {
      const call = data as ToolCallActivity;
      this.description = `${call.durationMs}ms • ${call.summary}`;
      this.tooltip = `Status: ${call.status}\nTime: ${call.timestamp}\nArgs: ${JSON.stringify(call.args, null, 2)}`;
      if (call.status === 'running') {
        this.iconPath = new vscode.ThemeIcon('loading~spin');
      } else if (call.status === 'error') {
        this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      } else {
        this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
      }
    } else {
      this.iconPath = new vscode.ThemeIcon('detail');
    }
  }

  get call(): ToolCallActivity | undefined {
    if (typeof this.data !== 'string') {
      return this.data as ToolCallActivity;
    }
    return undefined;
  }
}

export class FileReadsTreeDataProvider implements vscode.TreeDataProvider<FileReadTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<FileReadTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<FileReadTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private readonly tracker: ActivityTracker) {
    this.tracker.subscribe(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FileReadTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FileReadTreeItem): Thenable<FileReadTreeItem[]> {
    if (!element) {
      const reads = this.tracker.getFileReads();
      if (reads.length === 0) {
        const item = new FileReadTreeItem('No workspace reads recorded', vscode.TreeItemCollapsibleState.None);
        item.description = 'Files inspected by agent appear here';
        item.iconPath = new vscode.ThemeIcon('file');
        return Promise.resolve([item]);
      }
      return Promise.resolve(reads.map((r) => new FileReadTreeItem(r, vscode.TreeItemCollapsibleState.None)));
    }

    return Promise.resolve([]);
  }
}

export class FileReadTreeItem extends vscode.TreeItem {
  constructor(
    public readonly data: string | FileReadActivity,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    let label = '';
    if (typeof data === 'string') {
      label = data;
    } else {
      label = data.path;
    }

    super(label, collapsibleState);

    if (typeof data !== 'string') {
      const read = data as FileReadActivity;
      const lines = read.startLine ? `lines ${read.startLine}-${read.endLine ?? ''}` : `${read.lineCount} lines`;
      const kb = (read.charCount / 1024).toFixed(1);
      this.description = `${lines} (${kb} KB) • ${read.timestamp}`;
      this.tooltip = `Path: ${read.path}\nCharacters: ${read.charCount}\nTime: ${read.timestamp}`;
      this.iconPath = new vscode.ThemeIcon('file-code');

      // Clicking opens the file in VS Code
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        this.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.joinPath(workspaceFolder.uri, read.path)],
        };
      }
    }
  }
}

export class SummaryMetricsTreeDataProvider implements vscode.TreeDataProvider<SummaryMetricTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SummaryMetricTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<SummaryMetricTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private readonly tracker: ActivityTracker) {
    this.tracker.subscribe(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SummaryMetricTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SummaryMetricTreeItem): Thenable<SummaryMetricTreeItem[]> {
    if (!element) {
      const metrics = this.tracker.getSummaryMetrics();
      const hw = metrics.hardware;

      const items: SummaryMetricTreeItem[] = [
        new SummaryMetricTreeItem(
          `Model: ${hw.modelName}`,
          `${hw.totalSizeFormatted} • ${hw.percentVram}% VRAM (${hw.isFullyGpuAccelerated ? 'GPU' : 'Hybrid'})`,
          'server-process',
          new vscode.ThemeColor('charts.blue')
        ),
        new SummaryMetricTreeItem(
          `Speed: ${metrics.latestTokensPerSecond} tok/s`,
          `Avg: ${metrics.avgTokensPerSecond} tok/s across session`,
          'zap',
          new vscode.ThemeColor('charts.yellow')
        ),
        new SummaryMetricTreeItem(
          `Context Window: ${hw.contextTokensUsed} / ${hw.contextTokensLimit}`,
          `${Math.round((hw.contextTokensUsed / hw.contextTokensLimit) * 100)}% utilized`,
          'graph',
          new vscode.ThemeColor('charts.purple')
        ),
        new SummaryMetricTreeItem(
          `Conversations: ${metrics.totalConversations}`,
          `${metrics.userPromptsCount} prompts, ${metrics.agentResponsesCount} replies`,
          'comment-discussion',
          new vscode.ThemeColor('charts.green')
        ),
        new SummaryMetricTreeItem(
          `Tokens: ${metrics.promptTokensIn.toLocaleString()} in • ${metrics.generatedTokensOut.toLocaleString()} out`,
          `${(metrics.promptTokensIn + metrics.generatedTokensOut).toLocaleString()} total`,
          'database',
          new vscode.ThemeColor('charts.foreground')
        ),
        new SummaryMetricTreeItem(
          `Code Edits: ${metrics.editsApplied} applied / ${metrics.editsProposed} proposed`,
          metrics.editsDiscarded > 0 ? `${metrics.editsDiscarded} discarded` : '100% accepted',
          'git-pull-request',
          new vscode.ThemeColor('charts.orange')
        ),
        new SummaryMetricTreeItem(
          '100% Local Execution',
          '0 KB sent to external cloud (Private & Offline)',
          'lock',
          new vscode.ThemeColor('charts.green')
        ),
        new SummaryMetricTreeItem(
          `Retention: Rolling ${metrics.retentionDays} days`,
          'Configurable via localOllama.activityRetentionDays',
          'history',
          new vscode.ThemeColor('charts.gray')
        ),
      ];

      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }
}

export class SummaryMetricTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: string,
    color?: vscode.ThemeColor
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon, color);
    this.tooltip = `${label}\n${description}`;
  }
}

