/// <reference types="node" />

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GITHUB_RELEASES_API } from '../constants';
import { Logger } from '../core/contracts';

const execFileAsync = promisify(execFile);

type UpdateWorkspaceOptions = {
  extensionId: string;
};

type NpmInvocation = {
  command: string;
  prefixArgs: string[];
};

type GitHubRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
};

export class UpdateManager {
  constructor(
    private readonly outputChannel: Logger,
    private readonly storageUri: vscode.Uri,
  ) {}

  async updateFromRelease(currentVersion: string): Promise<void> {
    const release = await this.getLatestRelease();
    const releaseVersion = this.normalizeVersion(release.tag_name ?? release.name ?? '');
    if (!releaseVersion || !this.isNewerVersion(releaseVersion, currentVersion)) {
      vscode.window.showInformationMessage(`Local Ollama is already up to date (${currentVersion}).`);
      return;
    }

    const asset = release.assets?.find((candidate) => candidate.name?.toLowerCase().endsWith('.vsix') && candidate.browser_download_url);
    if (!asset?.browser_download_url || !asset.name) {
      throw new Error(`Release ${releaseVersion} does not contain a downloadable VSIX file.`);
    }

    const choice = await vscode.window.showInformationMessage(
      `Local Ollama ${releaseVersion} is available. Download and install it now?`,
      'Install Update',
      'Cancel',
    );
    if (choice !== 'Install Update') {
      return;
    }

    const downloadUrl = asset.browser_download_url;
    const targetUri = vscode.Uri.joinPath(this.getStorageUri(), asset.name);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Updating Local Ollama...' },
      async (progress) => {
        progress.report({ message: `Downloading ${asset.name}...` });
        const response = await fetch(downloadUrl, {
          headers: { Accept: 'application/octet-stream', 'User-Agent': 'local-ollama' },
        });
        if (!response.ok) {
          throw new Error(`GitHub returned ${response.status} ${response.statusText} while downloading the update.`);
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length < 100 || !this.isZip(bytes)) {
          throw new Error('The downloaded update was not a valid VSIX archive.');
        }

        await vscode.workspace.fs.createDirectory(this.getStorageUri());
        await vscode.workspace.fs.writeFile(targetUri, bytes);
        progress.report({ message: 'Installing update...' });
        await vscode.commands.executeCommand('workbench.extensions.installExtension', targetUri);
      },
    );

    this.outputChannel.appendLine(`[Update] Installed GitHub release ${releaseVersion} from ${release.html_url ?? GITHUB_RELEASES_API}.`);
    const choiceAfterInstall = await vscode.window.showInformationMessage(
      `Local Ollama was updated to ${releaseVersion}. Reload the window to activate it.`,
      'Reload Window',
      'Later',
    );
    if (choiceAfterInstall === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }

  /**
   * Compiles, packages, and installs the extension from the current VS Code
   * workspace. This is a developer-only workflow: it shells out to `npm` and
   * `vsce` to run arbitrary build scripts from whatever workspace happens to
   * be open, so it requires an explicit user confirmation and validates that
   * the workspace's package.json looks like this extension before proceeding.
   */
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

    await this.assertFileExists(packagePath, 'package.json was not found in the current workspace.');
    const workspaceVersion = await this.assertWorkspaceMatchesExtension(packagePath, options.extensionId);

    const confirmation = await vscode.window.showWarningMessage(
      `This will run "npm run compile" and package a VSIX using the workspace at ${workspacePath}, then install the result. Continue?`,
      { modal: true },
      'Run Update',
    );
    if (confirmation !== 'Run Update') {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Updating Local Ollama extension...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Checking workspace...' });
        await this.assertDependenciesPresent(workspacePath);

        progress.report({ message: 'Compiling extension...' });
        await this.runCommand(npmInvocation.command, [...npmInvocation.prefixArgs, 'run', 'compile'], workspacePath);

        progress.report({ message: 'Packaging VSIX...' });
        await this.runCommand(
          npmInvocation.command,
          [...npmInvocation.prefixArgs, 'exec', '--', 'vsce', 'package', '--allow-missing-repository', '--skip-license'],
          workspacePath,
        );

        const vsixPath = path.join(workspacePath, `local-ollama-${workspaceVersion}.vsix`);
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

  private async getLatestRelease(): Promise<GitHubRelease> {
    const response = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'local-ollama' },
    });
    if (!response.ok) {
      throw new Error(`Could not check GitHub Releases (${response.status} ${response.statusText}).`);
    }

    return (await response.json()) as GitHubRelease;
  }

  private getStorageUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.storageUri, 'update-cache');
  }

  private normalizeVersion(value: string): string | undefined {
    const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
  }

  private isNewerVersion(candidate: string, current: string): boolean {
    const next = this.normalizeVersion(candidate);
    const installed = this.normalizeVersion(current);
    if (!next || !installed) {
      return false;
    }

    const nextParts = next.split('.').map(Number);
    const installedParts = installed.split('.').map(Number);
    for (let index = 0; index < nextParts.length; index += 1) {
      if (nextParts[index] > installedParts[index]) {
        return true;
      }

      if (nextParts[index] < installedParts[index]) {
        return false;
      }
    }

    return false;
  }

  private isZip(bytes: Uint8Array): boolean {
    return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
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
      throw new Error(`Update step failed while running ${args.slice(-2).join(' ')}. Check the Local Ollama output channel.`, { cause: error });
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

  /** Guards against running build commands in an unrelated workspace that happens to have a package.json. */
  private async assertWorkspaceMatchesExtension(packagePath: string, extensionId: string): Promise<string> {
    const expectedName = extensionId.includes('.') ? extensionId.slice(extensionId.lastIndexOf('.') + 1) : extensionId;

    let parsed: { name?: string; version?: string };
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(packagePath));
      parsed = JSON.parse(new TextDecoder().decode(bytes)) as { name?: string };
    } catch (error) {
      throw new Error('Could not read the workspace package.json.', { cause: error });
    }

    if (parsed.name !== expectedName) {
      throw new Error(
        `The open workspace's package.json name ("${parsed.name ?? 'unknown'}") does not match the running extension ("${expectedName}"). Open the Local Ollama extension source before running this command.`,
      );
    }

    if (!parsed.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(parsed.version)) {
      throw new Error(`The workspace package.json does not contain a valid extension version. Found: "${parsed.version ?? 'missing'}".`);
    }

    return parsed.version;
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