import * as vscode from 'vscode';
import * as fs from 'fs/promises';

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB before the log is rotated (truncated).

export class ActivityLogger {
  private writeQueue: Promise<void> = Promise.resolve();
  private directoryEnsured = false;

  constructor(
    private readonly outputChannel: vscode.OutputChannel,
    private readonly logDirectory: vscode.Uri,
    private readonly logUri: vscode.Uri,
  ) {}

  get logPath(): string {
    return this.logUri.fsPath;
  }

  appendLine(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`;
    this.outputChannel.appendLine(line);
    this.writeQueue = this.writeQueue
      .then(() => this.persistLine(line))
      .catch((error) => {
        const details = error instanceof Error ? error.message : 'Unknown error';
        this.outputChannel.appendLine(`[Logger] Failed to persist activity log: ${details}`);
      });
  }

  private async persistLine(line: string): Promise<void> {
    if (!this.directoryEnsured) {
      await vscode.workspace.fs.createDirectory(this.logDirectory);
      this.directoryEnsured = true;
    }

    await this.rotateIfNeeded();
    await fs.appendFile(this.logUri.fsPath, `${line}\n`, 'utf8');
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await fs.stat(this.logUri.fsPath);
      if (stats.size >= MAX_LOG_BYTES) {
        await fs.rm(this.logUri.fsPath, { force: true });
      }
    } catch {
      // Log file does not exist yet; nothing to rotate.
    }
  }
}
