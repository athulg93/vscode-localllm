/// <reference types="node" />

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type UpdateWorkspaceOptions = {
  extensionId: string;
  extensionVersion: string;
};

type NpmInvocation = {
  command: string;
  prefixArgs: string[];
};

export class UpdateManager {
  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  async updateFromWorkspace(options: UpdateWorkspaceOptions): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('Open the extension workspace before running update.');
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    const packagePath = path.join(workspacePath, 'package.json');
    const safeExtensionId = options.extensionId.replace(/[^a-zA-Z0-9._-]/g, '-');
    const lockPath = path.join(workspacePath, `.${safeExtensionId}.update.lock`);
    const npmInvocation = this.resolveNpmInvocation();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Updating Local Ollama extension...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Checking workspace...' });
        await this.assertFileExists(packagePath, 'package.json was not found in the current workspace.');
        await this.assertDependenciesPresent(workspacePath);

        progress.report({ message: 'Compiling extension...' });
        await this.runCommand(npmInvocation.command, [...npmInvocation.prefixArgs, 'run', 'compile'], workspacePath);

        progress.report({ message: 'Packaging VSIX...' });
        await this.runCommand(
          npmInvocation.command,
          [...npmInvocation.prefixArgs, 'exec', '--', 'vsce', 'package', '--allow-missing-repository', '--skip-license'],
          workspacePath,
        );

        const vsixPath = path.join(workspacePath, `local-ollama-chat-${options.extensionVersion}.vsix`);
        await this.assertFileExists(vsixPath, `Expected VSIX was not produced at ${vsixPath}.`);

        progress.report({ message: 'Installing updated VSIX...' });
        await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath));

        await vscode.workspace.fs.writeFile(vscode.Uri.file(lockPath), new TextEncoder().encode(new Date().toISOString()));
      },
    );

    const choice = await vscode.window.showInformationMessage(
      'Local Ollama extension was updated from the current workspace. Reload the window to activate it.',
      'Reload Window',
      'Later',
    );

    if (choice === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }

  private async runCommand(command: string, args: string[], cwd: string): Promise<void> {
    this.outputChannel.appendLine(`[Update] Running: ${command} ${args.join(' ')}`);

    try {
      const { stdout, stderr } = await execFileAsync(command, args, { cwd });
      if (stdout) {
        this.outputChannel.appendLine(stdout.trim());
      }

      if (stderr) {
        this.outputChannel.appendLine(stderr.trim());
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown error';
      this.outputChannel.appendLine(`[Update] Command failed: ${details}`);
      throw new Error(`Update step failed while running ${args.slice(-2).join(' ')}. Check the Local Ollama output channel.`);
    }
  }

  private resolveNpmInvocation(): NpmInvocation {
    const cliPath = process.env.npm_execpath;
    if (cliPath) {
      return { command: process.execPath, prefixArgs: [cliPath] };
    }

    return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefixArgs: [] };
  }

  private async assertFileExists(filePath: string, errorMessage: string): Promise<void> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    } catch {
      throw new Error(errorMessage);
    }
  }

  private async assertDependenciesPresent(workspacePath: string): Promise<void> {
    const nodeModulesPath = path.join(workspacePath, 'node_modules');
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(nodeModulesPath));
    } catch {
      throw new Error('node_modules is missing. Run npm install once before using the update command.');
    }
  }
}