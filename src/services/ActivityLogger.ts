import * as vscode from 'vscode';

export class ActivityLogger {
  private writeQueue: Promise<void> = Promise.resolve();

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
      .then(async () => {
        await vscode.workspace.fs.createDirectory(this.logDirectory);
        let existing = '';
        try {
          const bytes = await vscode.workspace.fs.readFile(this.logUri);
          existing = new TextDecoder().decode(bytes);
        } catch {}

        await vscode.workspace.fs.writeFile(
          this.logUri,
          new TextEncoder().encode(`${existing}${line}\n`),
        );
      })
      .catch((error) => {
        const details = error instanceof Error ? error.message : 'Unknown error';
        this.outputChannel.appendLine(`[Logger] Failed to persist activity log: ${details}`);
      });
  }
}
