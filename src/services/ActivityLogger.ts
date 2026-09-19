import * as vscode from 'vscode';
import * as fs from 'fs/promises';

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB per log file before rotation guard.
const ROTATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week rotation interval.

export class ActivityLogger {
  private writeQueue: Promise<void> = Promise.resolve();
  private directoryEnsured = false;
  private readonly summaryLogUri: vscode.Uri;
  private readonly detailedLogUri: vscode.Uri;

  constructor(
    private readonly outputChannel: vscode.OutputChannel,
    private readonly logDirectory: vscode.Uri,
    detailedLogUri?: vscode.Uri,
    summaryLogUri?: vscode.Uri,
  ) {
    this.detailedLogUri = detailedLogUri ?? vscode.Uri.joinPath(logDirectory, 'detailed-activity.log');
    this.summaryLogUri = summaryLogUri ?? vscode.Uri.joinPath(logDirectory, 'summary-activity.log');
  }

  get logPath(): string {
    return this.detailedLogUri.fsPath;
  }

  get summaryLogPath(): string {
    return this.summaryLogUri.fsPath;
  }

  get detailedLogPath(): string {
    return this.detailedLogUri.fsPath;
  }

  /**
   * Appends an event to both the VS Code output channel and the detailed step log file.
   * If the event represents a high-level summary or session lifecycle event,
   * it is also appended to the executive summary log.
   */
  appendLine(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`;
    this.outputChannel.appendLine(line);

    const isSummaryCandidate = this.isSummaryEvent(message);

    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.persistDetailed(line);
        if (isSummaryCandidate) {
          await this.persistSummary(line);
        }
      })
      .catch((error) => {
        const details = error instanceof Error ? error.message : 'Unknown error';
        this.outputChannel.appendLine(`[Logger] Failed to persist activity log: ${details}`);
      });
  }

  /**
   * Explicitly appends a clean executive milestone to the summary log (and detailed log).
   */
  appendSummary(headline: string, metricsOverview?: string): void {
    const line = `[${new Date().toISOString()}] [SUMMARY] ${headline}${metricsOverview ? ` | ${metricsOverview}` : ''}`;
    this.outputChannel.appendLine(line);

    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.persistSummary(line);
        await this.persistDetailed(line);
      })
      .catch((error) => {
        const details = error instanceof Error ? error.message : 'Unknown error';
        this.outputChannel.appendLine(`[Logger] Failed to persist summary log: ${details}`);
      });
  }

  private isSummaryEvent(message: string): boolean {
    return (
      message.startsWith('[Lifecycle]') ||
      message.startsWith('[Session]') ||
      message.startsWith('[SUMMARY]') ||
      message.startsWith('[Chat] Request started') ||
      message.startsWith('[Chat] Conversation history prepared') ||
      message.startsWith('[Ollama] Stream completed') ||
      message.startsWith('[Ollama] Agent loop completed') ||
      message.startsWith('[EditPlan]') ||
      message.startsWith('[EditorManager] Edit outcome') ||
      message.startsWith('[GitManager]')
    );
  }

  private async ensureDirectory(): Promise<void> {
    if (!this.directoryEnsured) {
      await vscode.workspace.fs.createDirectory(this.logDirectory);
      this.directoryEnsured = true;
    }
  }

  private async persistDetailed(line: string): Promise<void> {
    await this.ensureDirectory();
    await this.rotateFileIfNeeded(this.detailedLogUri.fsPath, 'detailed');
    await fs.appendFile(this.detailedLogUri.fsPath, `${line}\n`, 'utf8');
  }

  private async persistSummary(line: string): Promise<void> {
    await this.ensureDirectory();
    await this.rotateFileIfNeeded(this.summaryLogUri.fsPath, 'summary');
    await fs.appendFile(this.summaryLogUri.fsPath, `${line}\n`, 'utf8');
  }

  private async rotateFileIfNeeded(filePath: string, label: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      const now = Date.now();
      const ageMs = now - stats.birthtimeMs;
      const isPastOneWeek = ageMs >= ROTATION_INTERVAL_MS;
      const isOverSize = stats.size >= MAX_LOG_BYTES;

      if (isPastOneWeek || isOverSize) {
        // Rotate: archive the current file with timestamp before creating fresh file
        const rotatedName = `${filePath}.${new Date(stats.birthtimeMs || now).toISOString().slice(0, 10)}.bak`;
        try {
          await fs.rename(filePath, rotatedName);
        } catch {
          // If rename fails (e.g. cross-device), remove it cleanly
          await fs.rm(filePath, { force: true });
        }
        this.outputChannel.appendLine(`[Logger] Rotated ${label} log (age: ${Math.round(ageMs / 86400000)}d, size: ${(stats.size / 1024).toFixed(1)} KB) -> fresh 1-week log created.`);
      }
    } catch {
      // File does not exist yet; nothing to rotate.
    }
  }
}

