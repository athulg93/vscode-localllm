import * as vscode from 'vscode';
import { DEFAULT_BASE_URL, DEFAULT_MAX_TOOL_CALLS, DEFAULT_MODEL, DEFAULT_TEMPERATURE, HUMAN_READABLE_SYSTEM_PROMPT, MAX_ALLOWED_TOOL_CALLS } from './constants';
import { ContextManager } from './services/ContextManager';
import { EditorManager, EditStream } from './services/EditorManager';
import { OllamaClient } from './services/OllamaClient';
import { UpdateManager } from './services/UpdateManager';
import { ActivityLogger } from './services/ActivityLogger';
import { ModelProvider } from './core/contracts';
import { ModelBehaviorTelemetry } from './core/ModelBehaviorTelemetry';
import { modelProfileLabel } from './core/ModelProfiles';

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

async function promptForModel(
  baseUrl: string,
  outputChannel: ActivityLogger,
  telemetry?: ModelBehaviorTelemetry,
): Promise<string | undefined> {
  let models: string[];
  const client = new OllamaClient(baseUrl, outputChannel, telemetry);

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
    const model = result?.trim() || undefined;
    if (model) {
      await showModelCapabilities(client, model, outputChannel);
    }

    return model;
  }

  const selection = await vscode.window.showQuickPick(models, {
    placeHolder: 'Select the local Ollama model (tool support will be checked)',
    ignoreFocusOut: true,
  });

  if (selection) {
    await showModelCapabilities(client, selection, outputChannel);
  }

  return selection;
}

async function showModelCapabilities(
  client: OllamaClient,
  model: string,
  outputChannel: ActivityLogger,
): Promise<void> {
  try {
    const profile = await client.getModelProfile(model);
    const behaviorWarning = client.getModelBehaviorWarning(model);
    if (!profile.supportsTools) {
      await vscode.window.showWarningMessage(
        `Model "${model}" has no tool support. Normal chat will work, but workspace exploration and AI edit workflows are unavailable. Choose a tool-capable model for those features.`,
        'Continue',
      );
    } else if (behaviorWarning) {
      await vscode.window.showWarningMessage(`${behaviorWarning} ${modelProfileLabel(profile)}.`, 'Continue');
    } else {
      await vscode.window.showInformationMessage(`${modelProfileLabel(profile)} for ${model}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    outputChannel.appendLine(`[Connect] Could not verify tool support for ${model}: ${message}`);
    await vscode.window.showWarningMessage(`Tool capability could not be verified for "${model}". Normal chat will remain available, but workspace tools may not work.`, 'Continue');
  }
}

function parseModelChangeRequest(prompt: string): { isRequest: boolean; requestedModel?: string } {
  const trimmed = prompt.trim();
  const namedModel = trimmed.match(
    /^(?:please\s+)?(?:change|switch)\s+(?:my\s+|the\s+)?(?:local\s+ollama\s+)?model\s+(?:to|:)\s+([^\s.!?]+)[.!?\s]*$/i,
  );
  if (namedModel?.[1]) {
    return { isRequest: true, requestedModel: namedModel[1] };
  }

  const switchToModel = trimmed.match(/^(?:please\s+)?switch\s+to\s+([^\s.!?]+)(?:\s+model)?[.!?\s]*$/i);
  if (switchToModel?.[1]) {
    return { isRequest: true, requestedModel: switchToModel[1] };
  }

  return {
    isRequest: /^(?:please\s+)?(?:change|switch)\s+(?:my\s+|the\s+)?(?:local\s+ollama\s+)?model[.!?\s]*$/i.test(trimmed),
  };
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

async function resolveModelName(client: ModelProvider, requestedModel: string): Promise<string> {
  const models = await client.listModels();
  const exact = models.find((model) => model === requestedModel);
  if (exact) {
    return exact;
  }

  const caseInsensitive = models.find((model) => model.toLowerCase() === requestedModel.toLowerCase());
  if (caseInsensitive) {
    return caseInsensitive;
  }

  const untaggedMatch = models.filter((model) => model.split(':', 1)[0]?.toLowerCase() === requestedModel.toLowerCase());
  if (untaggedMatch.length === 1) {
    return untaggedMatch[0];
  }

  throw new Error(`Model "${requestedModel}" was not found on the local Ollama server. Available models: ${models.join(', ') || 'none'}.`);
}

function createNotificationStream(outputChannel: vscode.OutputChannel): EditStream {
  return {
    markdown: (value: string | vscode.MarkdownString) => {
      const text = value.toString();
      outputChannel.appendLine(text);
      void vscode.window.showInformationMessage(text.slice(0, 400));
    },
    progress: (value?: string | vscode.MarkdownString) => {
      if (value) {
        outputChannel.appendLine(value.toString());
      }
    },
  };
}

function registerChatParticipant(
  context: vscode.ExtensionContext,
  contextManager: ContextManager,
  editorManager: EditorManager,
  updateManager: UpdateManager,
  extensionVersion: string,
  outputChannel: ActivityLogger,
  telemetry: ModelBehaviorTelemetry,
) {
  const participant = vscode.chat.createChatParticipant('local-ollama.participant', async (request, _, stream, token) => {
    outputChannel.appendLine(`[Chat] Request started; command=${request.command ?? 'none'}, prompt length=${request.prompt.length}.`);
    const baseUrl = getSetting<string>('baseUrl', DEFAULT_BASE_URL);
    let defaultModel = getSetting<string>('defaultModel', DEFAULT_MODEL);
    const temperature = getSetting<number>('temperature', DEFAULT_TEMPERATURE);
    const maxToolCalls = Math.min(getSetting<number>('maxToolCalls', DEFAULT_MAX_TOOL_CALLS), MAX_ALLOWED_TOOL_CALLS);
    const client = new OllamaClient(baseUrl, outputChannel, telemetry);
    const { requestedModel, remainingPrompt } = parseInlineModelDirective(request.prompt);
    const effectivePrompt = requestedModel ? remainingPrompt : request.prompt;
    const modelChange = parseModelChangeRequest(effectivePrompt);

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
        await showModelCapabilities(client, defaultModel, outputChannel);

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

    if (request.command === 'change-model' || modelChange.isRequest) {
      try {
        const model = modelChange.requestedModel
          ? await resolveModelName(client, modelChange.requestedModel)
          : await promptForModel(baseUrl, outputChannel, telemetry);
        if (!model) {
          stream.markdown('No model change was made.');
          return;
        }

        if (modelChange.requestedModel) {
          await showModelCapabilities(client, model, outputChannel);
        }
        await vscode.workspace.getConfiguration('localOllama').update('defaultModel', model, vscode.ConfigurationTarget.Global);
        stream.markdown(`Active default model changed to **${model}**.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        stream.markdown(`I could not change the model.\n\n${message}`);
      }
      return;
    }

    if (request.command === 'update' || /^(?:run\s+)?update\b/i.test(effectivePrompt)) {
      try {
        stream.progress('Checking for a newer Local Ollama release...');
        await updateManager.updateFromRelease(extensionVersion);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        outputChannel.appendLine(`[Update] ${message}`);
        stream.markdown(`I could not update Local Ollama.\n\n${message}`);
      }
      return;
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
          maxToolCalls,
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

      const model = await promptForModel(connection, outputChannel, telemetry);
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
      stream.progress(`Connected to Ollama. Model ${resolvedModel} is available.`);

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
          maxToolCalls,
        });
        return;
      }

      const response = await client.sendPromptWithTools(resolvedModel, [
        effectivePrompt,
        '',
        'You have bounded workspace exploration tools. Use list_workspace_files to discover candidates, search_workspace to find symbols or related code, and read_file to inspect relevant line ranges.',
        'Use multiple tool calls when needed. Do not claim to have inspected a file unless a tool result provided its content.',
        'After gathering enough evidence, answer the user directly in concise markdown. Do not return tool-call JSON in the final answer.',
      ].join('\n'), temperature, {
        systemPrompt: HUMAN_READABLE_SYSTEM_PROMPT,
        token,
        tools: contextManager.getFileTools(),
        executeTool: (name, arguments_) => contextManager.executeFileTool(name, arguments_),
        maxToolCalls,
        onStatus: (message) => stream.progress(message),
      });

      if (!response.trim()) {
        stream.markdown('No response returned from Ollama.');
      } else {
        stream.markdown(response);
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
  const telemetry = new ModelBehaviorTelemetry(context.globalState);
  activityLogger.appendLine(`[Lifecycle] Extension activated; version=${context.extension.packageJSON.version ?? 'unknown'}; log=${activityLogger.logPath}.`);
  const contextManager = new ContextManager(activityLogger);
  const editorManager = new EditorManager(activityLogger);
  const updateManager = new UpdateManager(activityLogger, context.globalStorageUri);
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

    const model = await promptForModel(baseUrl, activityLogger, telemetry);
    if (!model) {
      return;
    }

    await vscode.workspace.getConfiguration('localOllama').update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('localOllama').update('defaultModel', model, vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage(`Connected to ${baseUrl} and default model set to ${model}.`);
  });

  const changeModel = async () => {
    const baseUrl = getSetting<string>('baseUrl', DEFAULT_BASE_URL);
    const model = await promptForModel(baseUrl, activityLogger, telemetry);
    if (!model) {
      return;
    }

    await vscode.workspace.getConfiguration('localOllama').update('defaultModel', model, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Active default model changed to ${model}.`);
  };
  const selectModelCommand = vscode.commands.registerCommand('localOllama.selectModel', changeModel);
  const changeModelCommand = vscode.commands.registerCommand('localOllama.changeModel', changeModel);

  const listModelsCommand = vscode.commands.registerCommand('localOllama.listModels', async () => {
    const baseUrl = getSetting<string>('baseUrl', DEFAULT_BASE_URL);
    const client = new OllamaClient(baseUrl, activityLogger, telemetry);

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
    const maxToolCalls = Math.min(getSetting<number>('maxToolCalls', DEFAULT_MAX_TOOL_CALLS), MAX_ALLOWED_TOOL_CALLS);
    const client = new OllamaClient(baseUrl, activityLogger, telemetry);

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
        maxToolCalls,
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
    const maxToolCalls = Math.min(getSetting<number>('maxToolCalls', DEFAULT_MAX_TOOL_CALLS), MAX_ALLOWED_TOOL_CALLS);
    const client = new OllamaClient(baseUrl, activityLogger, telemetry);

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
        maxToolCalls,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Unable to refactor project: ${message}`);
    }
  });

  const updateFromWorkspaceCommand = vscode.commands.registerCommand('localOllama.updateFromWorkspace', async () => {
    try {
      await updateManager.updateFromWorkspace({ extensionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      outputChannel.appendLine(`[Update] ${message}`);
      vscode.window.showErrorMessage(`Unable to update Local Ollama: ${message}`);
    }
  });

  const updateCommand = vscode.commands.registerCommand('localOllama.update', async () => {
    try {
      await updateManager.updateFromRelease(extensionVersion);
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
    changeModelCommand,
    listModelsCommand,
    applySuggestedEditCommand,
    refactorProjectCommand,
    updateFromWorkspaceCommand,
    updateCommand,
    openActivityLogCommand,
  );
  registerChatParticipant(context, contextManager, editorManager, updateManager, extensionVersion, activityLogger, telemetry);
}

export function deactivate() {
  // no-op
}
