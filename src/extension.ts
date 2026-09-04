import * as vscode from 'vscode';
import { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_TEMPERATURE } from './constants';
import { ContextManager } from './services/ContextManager';
import { EditorManager } from './services/EditorManager';
import { OllamaClient } from './services/OllamaClient';
import { UpdateManager } from './services/UpdateManager';
import { ActivityLogger } from './services/ActivityLogger';

function getSetting<T>(section: string, fallback: T): T {
  const value = vscode.workspace.getConfiguration('localOllama').get<T>(section, fallback);
  return value ?? fallback;
}

async function promptForBaseUrl(): Promise<string | undefined> {
  const current = getSetting<string>('baseUrl', DEFAULT_BASE_URL);
  const result = await vscode.window.showInputBox({
    prompt: 'Enter your Ollama base URL',
    value: current,
    placeHolder: DEFAULT_BASE_URL,
    ignoreFocusOut: true,
  });

  return result?.trim() || undefined;
}

async function promptForModel(baseUrl: string, outputChannel: ActivityLogger): Promise<string | undefined> {
  let models: string[] = [];
  const client = new OllamaClient(baseUrl, outputChannel);

  try {
    models = await client.listModels();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    outputChannel.appendLine(`[Connect] Failed to list models for picker: ${message}`);
    models = [];
  }

  if (models.length === 0) {
    const result = await vscode.window.showInputBox({
      prompt: 'No models were found. Enter the model name manually',
      value: getSetting<string>('defaultModel', DEFAULT_MODEL),
      placeHolder: DEFAULT_MODEL,
      ignoreFocusOut: true,
    });
    return result?.trim() || undefined;
  }

  const selection = await vscode.window.showQuickPick(models, {
    placeHolder: 'Select the local Ollama model',
    ignoreFocusOut: true,
  });

  return selection;
}

function parseInlineModelDirective(prompt: string): { requestedModel?: string; remainingPrompt: string } {
  const trimmed = prompt.trim();
  if (trimmed === '@') {
    return { requestedModel: 'models', remainingPrompt: '' };
  }

  const match = trimmed.match(/^@([^\s]+)\s*(.*)$/s);
  if (!match) {
    return { remainingPrompt: prompt };
  }

  const [, requestedModelRaw, remainingPrompt] = match;
  const requestedModel = requestedModelRaw?.trim();
  if (!requestedModel) {
    return { remainingPrompt: prompt };
  }

  return { requestedModel, remainingPrompt: remainingPrompt?.trim() ?? '' };
}

async function resolveModelName(client: OllamaClient, requestedModel: string): Promise<string> {
  const models = await client.listModels();
  const exact = models.find((model) => model === requestedModel);
  if (exact) {
    return exact;
  }

  const caseInsensitive = models.find((model) => model.toLowerCase() === requestedModel.toLowerCase());
  if (caseInsensitive) {
    return caseInsensitive;
  }

  throw new Error(`Model "${requestedModel}" was not found on the local Ollama server. Available models: ${models.join(', ') || 'none'}.`);
}

function createNotificationStream(outputChannel: vscode.OutputChannel): vscode.ChatResponseStream {
  const streamLike: vscode.ChatResponseStream = {
    markdown: (value: string | vscode.MarkdownString) => {
      const text = value.toString();
      outputChannel.appendLine(text);
      void vscode.window.showInformationMessage(text.slice(0, 400));
      return streamLike;
    },
    progress: (value?: string | vscode.MarkdownString) => {
      if (value) {
        outputChannel.appendLine(value.toString());
      }

      return streamLike;
    },
    anchor: () => streamLike,
    button: () => streamLike,
    filetree: () => streamLike,
    reference: () => streamLike,
    push: () => streamLike,
  } as unknown as vscode.ChatResponseStream;

  return streamLike;
}

function registerChatParticipant(
  context: vscode.ExtensionContext,
  contextManager: ContextManager,
  editorManager: EditorManager,
  outputChannel: ActivityLogger,
) {
  const participant = vscode.chat.createChatParticipant('local-ollama.participant', async (request, _, stream, token) => {
    outputChannel.appendLine(`[Chat] Request started; command=${request.command ?? 'none'}, prompt length=${request.prompt.length}.`);
    const baseUrl = getSetting<string>('baseUrl', DEFAULT_BASE_URL);
    let defaultModel = getSetting<string>('defaultModel', DEFAULT_MODEL);
    const temperature = getSetting<number>('temperature', DEFAULT_TEMPERATURE);
    const client = new OllamaClient(baseUrl, outputChannel);
    const { requestedModel, remainingPrompt } = parseInlineModelDirective(request.prompt);
    const effectivePrompt = requestedModel ? remainingPrompt : request.prompt;

    if (requestedModel) {
      if (requestedModel.toLowerCase() === 'models') {
        try {
          const models = await client.listModels();
          const summary = models.length ? models.map((model) => `- ${model}`).join('\n') : 'No models found.';
          stream.markdown(`Available local Ollama models:\n\n${summary}\n\nUse @<model-name> in chat to switch models.`);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          stream.markdown(`I could not query the local Ollama server.\n\n${message}`);
          return;
        }
      }

      try {
        defaultModel = await resolveModelName(client, requestedModel);
        outputChannel.appendLine(`[Chat] Inline model selected: ${defaultModel}.`);
        await vscode.workspace.getConfiguration('localOllama').update('defaultModel', defaultModel, vscode.ConfigurationTarget.Global);

        if (!effectivePrompt.trim()) {
          stream.markdown(`Switched default model to **${defaultModel}**. Send your next message to continue.`);
          return;
        }

        stream.progress(`Using model ${defaultModel} for this request.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        stream.markdown(`I could not switch models.\n\n${message}`);
        return;
      }
    }

    if (request.command === 'models') {
      try {
        const models = await client.listModels();
        const summary = models.length ? models.map((model) => `- ${model}`).join('\n') : 'No models found.';
        stream.markdown(`Available local Ollama models:\n\n${summary}\n\nUse @<model-name> in chat to switch models.`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        stream.markdown(`I could not query the local Ollama server.\n\n${message}`);
        return;
      }
    }

    if (request.command === 'edit' || request.command === 'refactor') {
      try {
        outputChannel.appendLine(`[Chat] Explicit ${request.command} workflow requested.`);
        const resolvedModel = await client.ensureModelExists(defaultModel);
        await editorManager.runEditWorkflow({
          client,
          contextManager,
          model: resolvedModel,
          prompt: effectivePrompt,
          temperature,
          stream,
          token,
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        stream.markdown(`I hit a problem while generating edits.\n\n${message}`);
        return;
      }
    }

    if (request.command === 'connect') {
      const connection = await promptForBaseUrl();
      if (!connection) {
        stream.markdown('No connection change was made.');
        return;
      }

      const model = await promptForModel(connection, outputChannel);
      if (!model) {
        stream.markdown('No model was selected.');
        return;
      }

      await vscode.workspace.getConfiguration('localOllama').update('baseUrl', connection, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('localOllama').update('defaultModel', model, vscode.ConfigurationTarget.Global);
      stream.markdown(`Connected to ${connection} and set the default model to **${model}**.`);
      return;
    }

    try {
      const resolvedModel = await client.ensureModelExists(defaultModel);
      stream.progress('Calling your local Ollama model...');

      if (token.isCancellationRequested) {
        return;
      }

      const promptIntent = contextManager.classifyPromptIntent(effectivePrompt);
      outputChannel.appendLine(`[Chat] Prompt intent classified as ${promptIntent}.`);
      if (promptIntent === 'editFile' || promptIntent === 'editProject') {
        await editorManager.runEditWorkflow({
          client,
          contextManager,
          model: resolvedModel,
          prompt: effectivePrompt,
          temperature,
          stream,
          token,
        });
        return;
      }

      const promptWithContext = await contextManager.buildPromptWithImplicitContext(effectivePrompt, {
        client,
        model: resolvedModel,
        temperature,
        token,
      });
      const response = await client.streamPrompt(resolvedModel, promptWithContext, temperature, {
        token,
        onToken: (chunk) => {
          stream.markdown(chunk);
        },
      });

      if (!response.trim()) {
        stream.markdown('No response returned from Ollama.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      outputChannel.appendLine(`[Chat] ${message}`);
      stream.markdown(`I hit a problem while contacting your local Ollama agent.\n\n${message}`);
    }
  });

  context.subscriptions.push(participant);
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Local Ollama');
  const logDirectory = context.globalStorageUri;
  const logUri = vscode.Uri.joinPath(logDirectory, 'activity.log');
  const activityLogger = new ActivityLogger(outputChannel, logDirectory, logUri);
  activityLogger.appendLine(`[Lifecycle] Extension activated; version=${context.extension.packageJSON.version ?? 'unknown'}; log=${activityLogger.logPath}.`);
  const contextManager = new ContextManager(activityLogger);
  const editorManager = new EditorManager(activityLogger);
  const updateManager = new UpdateManager(activityLogger);
  const extensionPackage = context.extension.packageJSON as { name?: string; publisher?: string; version?: string };
  const extensionId = extensionPackage.publisher && extensionPackage.name
    ? `${extensionPackage.publisher}.${extensionPackage.name}`
    : 'local-ollama.local-ollama-chat';
  const extensionVersion = extensionPackage.version ?? '0.1.0';

  const connectCommand = vscode.commands.registerCommand('localOllama.connect', async () => {
    const baseUrl = await promptForBaseUrl();
    if (!baseUrl) {
      return;
    }

    const model = await promptForModel(baseUrl, activityLogger);
    if (!model) {
      return;
    }

    await vscode.workspace.getConfiguration('localOllama').update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('localOllama').update('defaultModel', model, vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage(`Connected to ${baseUrl} and default model set to ${model}.`);
  });

  const selectModelCommand = vscode.commands.registerCommand('localOllama.selectModel', async () => {
    const baseUrl = getSetting<string>('baseUrl', DEFAULT_BASE_URL);
    const model = await promptForModel(baseUrl, activityLogger);
    if (!model) {
      return;
    }

    await vscode.workspace.getConfiguration('localOllama').update('defaultModel', model, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Default model updated to ${model}.`);
  });

  const listModelsCommand = vscode.commands.registerCommand('localOllama.listModels', async () => {
    const baseUrl = getSetting<string>('baseUrl', DEFAULT_BASE_URL);
    const client = new OllamaClient(baseUrl, activityLogger);

    try {
      const models = await client.listModels();
      if (models.length === 0) {
        vscode.window.showInformationMessage('No models were found on the local Ollama server.');
        return;
      }

      vscode.window.showInformationMessage(`Available local Ollama models: ${models.join(', ')}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Unable to list models: ${message}`);
    }
  });

  const applySuggestedEditCommand = vscode.commands.registerCommand('localOllama.applySuggestedEdit', async () => {
    const baseUrl = getSetting<string>('baseUrl', DEFAULT_BASE_URL);
    const defaultModel = getSetting<string>('defaultModel', DEFAULT_MODEL);
    const temperature = getSetting<number>('temperature', DEFAULT_TEMPERATURE);
    const client = new OllamaClient(baseUrl, activityLogger);

    const prompt = await vscode.window.showInputBox({
      prompt: 'Describe how you want the current file changed',
      placeHolder: 'e.g., Refactor this file to improve error handling and readability',
      ignoreFocusOut: true,
    });

    if (!prompt?.trim()) {
      return;
    }

    try {
      const resolvedModel = await client.ensureModelExists(defaultModel);
      await editorManager.runEditWorkflow({
        client,
        contextManager,
        model: resolvedModel,
        prompt: `Please edit this file: ${prompt}`,
        temperature,
        stream: createNotificationStream(outputChannel),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Unable to apply suggested edit: ${message}`);
    }
  });

  const refactorProjectCommand = vscode.commands.registerCommand('localOllama.refactorProject', async () => {
    const baseUrl = getSetting<string>('baseUrl', DEFAULT_BASE_URL);
    const defaultModel = getSetting<string>('defaultModel', DEFAULT_MODEL);
    const temperature = getSetting<number>('temperature', DEFAULT_TEMPERATURE);
    const client = new OllamaClient(baseUrl, activityLogger);

    const prompt = await vscode.window.showInputBox({
      prompt: 'Describe what project refactor you want',
      placeHolder: 'e.g., Improve naming consistency and simplify duplicated logic',
      ignoreFocusOut: true,
    });

    if (!prompt?.trim()) {
      return;
    }

    try {
      const resolvedModel = await client.ensureModelExists(defaultModel);
      await editorManager.runEditWorkflow({
        client,
        contextManager,
        model: resolvedModel,
        prompt: `Please refactor this project: ${prompt}`,
        temperature,
        stream: createNotificationStream(outputChannel),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Unable to refactor project: ${message}`);
    }
  });

  const updateFromWorkspaceCommand = vscode.commands.registerCommand('localOllama.updateFromWorkspace', async () => {
    try {
      await updateManager.updateFromWorkspace({ extensionId, extensionVersion });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      outputChannel.appendLine(`[Update] ${message}`);
      vscode.window.showErrorMessage(`Unable to update Local Ollama: ${message}`);
    }
  });

  const openActivityLogCommand = vscode.commands.registerCommand('localOllama.openActivityLog', async () => {
    await vscode.window.showTextDocument(logUri, { preview: false });
  });

  context.subscriptions.push(
    outputChannel,
    connectCommand,
    selectModelCommand,
    listModelsCommand,
    applySuggestedEditCommand,
    refactorProjectCommand,
    updateFromWorkspaceCommand,
    openActivityLogCommand,
  );
  registerChatParticipant(context, contextManager, editorManager, activityLogger);
}

export function deactivate() {
  // no-op
}
