import * as vscode from 'vscode';
import { DEFAULT_BASE_URL, DEFAULT_MAX_TOOL_CALLS, DEFAULT_MODEL, DEFAULT_TEMPERATURE, HUMAN_READABLE_SYSTEM_PROMPT, MAX_ALLOWED_TOOL_CALLS } from './constants';
import { ContextManager } from './services/ContextManager';
import { EditorManager, EditStream } from './services/EditorManager';
import { OllamaClient } from './services/OllamaClient';
import { UpdateManager } from './services/UpdateManager';
import { ActivityLogger } from './services/ActivityLogger';
import { GitManager } from './services/GitManager';
import { ActivityTracker } from './core/ActivityTracker';
import { McpManager } from './services/McpManager';
import { McpTreeDataProvider } from './services/McpTreeDataProvider';
import { McpConfigFile } from './core/mcpTypes';
import { SkillManager } from './services/SkillManager';
import { SkillsTreeDataProvider } from './services/SkillsTreeDataProvider';
import {
  FileReadsTreeDataProvider,
  PendingDiffsTreeDataProvider,
  SummaryMetricsTreeDataProvider,
  ToolCallsTreeDataProvider,
} from './services/ActivityViews';
import { ModelProvider } from './core/contracts';
import { ModelBehaviorTelemetry } from './core/ModelBehaviorTelemetry';
import { modelProfileLabel } from './core/ModelProfiles';
import { boundConversationHistory, isConversationResetRequest } from './core/ConversationHistory';
import { ConversationMessage } from './core/contracts';

type ModelChangeRequest = {
  isRequest: boolean;
  requestedModel?: string;
};

type InlineModelDirective = {
  requestedModel?: string;
  remainingPrompt: string;
};

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

function parseModelChangeRequest(prompt: string): ModelChangeRequest {
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
    requestedModel: undefined,
  };
}

function parseInlineModelDirective(prompt: string): InlineModelDirective {
  const trimmed = prompt.trim();
  if (trimmed === '@') {
    return { requestedModel: 'models', remainingPrompt: '' };
  }

  const match = trimmed.match(/^@([^\s]+)\s*(.*)$/s);
  if (!match) {
    return { requestedModel: undefined, remainingPrompt: prompt };
  }

  const [, requestedModelRaw, remainingPrompt] = match;
  const requestedModel = requestedModelRaw?.trim();
  if (!requestedModel) {
    return { requestedModel: undefined, remainingPrompt: prompt };
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

function getConversationHistory(chatContext: vscode.ChatContext): ConversationMessage[] {
  const history: ConversationMessage[] = [];

  for (const turn of chatContext.history) {
    if ('prompt' in turn) {
      history.push({ role: 'user', content: turn.prompt });
      continue;
    }

    const content = turn.response
      .filter((part): part is vscode.ChatResponseMarkdownPart => 'value' in part)
      .map((part) => part.value.toString())
      .join('')
      .trim();
    if (content) {
      history.push({ role: 'assistant', content });
    }
  }

  return boundConversationHistory(history);
}

function registerChatParticipant(
  context: vscode.ExtensionContext,
  contextManager: ContextManager,
  editorManager: EditorManager,
  updateManager: UpdateManager,
  gitManager: GitManager,
  mcpManager: McpManager,
  skillManager: SkillManager,
  extensionVersion: string,
  outputChannel: ActivityLogger,
  telemetry: ModelBehaviorTelemetry,
  activityTracker: ActivityTracker,
) {
  const participant = vscode.chat.createChatParticipant('localllm.participant', async (request, chatContext, stream, token) => {
    outputChannel.appendLine(`[Chat] Request started; command=${request.command ?? 'none'}, prompt length=${request.prompt.length}.`);
    const resetConversation = isConversationResetRequest(request.prompt);
    if (resetConversation) {
      contextManager.clearCache();
      outputChannel.appendLine('[Chat] Explicit conversation reset requested; prior turns will be ignored.');
    }
    const conversationHistory = resetConversation ? [] : getConversationHistory(chatContext);
    outputChannel.appendLine(`[Chat] Conversation history prepared; messages=${conversationHistory.length}.`);
    const baseUrl = getSetting<string>('baseUrl', DEFAULT_BASE_URL);
    let defaultModel = getSetting<string>('defaultModel', DEFAULT_MODEL);
    const temperature = getSetting<number>('temperature', DEFAULT_TEMPERATURE);
    const maxToolCalls = Math.min(getSetting<number>('maxToolCalls', DEFAULT_MAX_TOOL_CALLS), MAX_ALLOWED_TOOL_CALLS);
    const client = new OllamaClient(baseUrl, outputChannel, telemetry, activityTracker);
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
          conversationHistory,
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

    // Direct Git command shortcuts (handled via VS Code request.command or typed slash command)
    const isGitCommand = request.command === 'git'
      || request.command?.startsWith('git-')
      || request.command === 'pull'
      || request.command === 'push'
      || request.command === 'status'
      || request.command === 'merge'
      || request.command === 'remote'
      || request.command === 'stash'
      || request.command === 'fetch';
    const directGitMatch = effectivePrompt.match(/^\/?(?:git[\s-])?(pull|push|status|diff|log|branch|checkout|add|commit|merge|remote|stash|fetch)(?:\s+(.*))?$/i);

    if (isGitCommand || directGitMatch) {
      let gitAction = 'status';
      let extraArgs = '';

      if (request.command?.startsWith('git-')) {
        gitAction = request.command.slice(4).toLowerCase();
        extraArgs = effectivePrompt.trim();
      } else if (
        request.command === 'pull' ||
        request.command === 'push' ||
        request.command === 'status' ||
        request.command === 'merge' ||
        request.command === 'remote' ||
        request.command === 'stash' ||
        request.command === 'fetch'
      ) {
        gitAction = request.command;
        extraArgs = effectivePrompt.trim();
      } else if (request.command === 'git') {
        const parts = effectivePrompt.trim().split(/\s+/).filter(Boolean);
        if (parts[0]?.toLowerCase() === 'git') {
          parts.shift();
        }
        gitAction = parts[0] ? parts[0].toLowerCase() : 'status';
        extraArgs = parts.slice(1).join(' ').trim();
      } else if (directGitMatch) {
        gitAction = directGitMatch[1].toLowerCase();
        extraArgs = (directGitMatch[2] || '').trim();
      }

      stream.progress(`Executing Git operation: ${gitAction}...`);
      outputChannel.appendLine(`[Git] Direct execution for ${gitAction} with args "${extraArgs}".`);

      let toolName = `git_${gitAction}`;
      let toolArgs: Record<string, unknown> = {};

      if (gitAction === 'pull' || gitAction === 'push') {
        const parts = extraArgs.split(/\s+/).filter(Boolean);
        const fillerWords = new Set([
          'latest', 'changes', 'new', 'recent', 'updates', 'update', 'code',
          'repo', 'repository', 'commits', 'commit', 'all', 'the', 'from',
          'to', 'in', 'my', 'please', 'now', 'local', 'workspace', 'branch', 'remote',
        ]);
        const cleanParts = parts.filter((p) => !fillerWords.has(p.toLowerCase()));
        if (cleanParts[0]) toolArgs.remote = cleanParts[0];
        if (cleanParts[1]) toolArgs.branch = cleanParts[1];
      } else if (gitAction === 'checkout' || gitAction === 'merge') {
        if (extraArgs) toolArgs.branch = extraArgs;
      } else if (gitAction === 'add') {
        if (extraArgs) toolArgs.paths = extraArgs.split(/\s+/).filter(Boolean);
      } else if (gitAction === 'commit') {
        if (extraArgs) toolArgs.message = extraArgs;
      } else if (gitAction === 'stash') {
        const parts = extraArgs.split(/\s+/).filter(Boolean);
        const subAction = parts[0]?.toLowerCase();
        if (['push', 'pop', 'apply', 'list', 'drop'].includes(subAction || '')) {
          toolArgs.action = subAction;
          toolArgs.message = parts.slice(1).join(' ').trim();
        } else {
          toolArgs.action = 'push';
          toolArgs.message = extraArgs;
        }
      } else if (gitAction === 'fetch') {
        const parts = extraArgs.split(/\s+/).filter(Boolean);
        if (parts[0] && !parts[0].startsWith('-')) {
          toolArgs.remote = parts[0];
        }
        if (parts.includes('--prune')) {
          toolArgs.prune = true;
        }
      }

      try {
        const rawResult = await gitManager.executeTool(toolName, toolArgs);
        let parsed: { error?: string; cancelled?: boolean; message?: string; report?: string } | null = null;
        try {
          parsed = JSON.parse(rawResult);
        } catch {}

        if (parsed?.error) {
          const report = parsed.report || `### ⚠️ Git ${gitAction.toUpperCase()} Encountered an Error\n\n${parsed.error}`;
          stream.markdown(`${report}\n\n<details><summary>Technical Error Log</summary>\n\n\`\`\`\n${parsed.error}\n\`\`\`\n</details>`);
        } else if (parsed?.cancelled) {
          stream.markdown(`*Git operation was cancelled by the user.*`);
        } else {
          stream.markdown(`### Git ${gitAction.toUpperCase()} Result\n\n\`\`\`\n${rawResult}\n\`\`\``);
        }
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stream.markdown(`Git execution error: ${msg}`);
        return;
      }
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
          conversationHistory,
          temperature,
          stream,
          token,
          maxToolCalls,
        });
        return;
      }

      const isGitRequest = promptIntent === 'gitTransaction';
      const activeTools = [...contextManager.getFileTools(), ...gitManager.getTools(), ...mcpManager.getActiveToolDefinitions()];
      const toolNames = new Set(activeTools.map((t) => t.name));
      const skillsSummary = skillManager.buildPromptInjection(
        effectivePrompt,
        mcpManager.getServerStates(),
        toolNames
      );
      if (skillsSummary.activeSkills.length > 0) {
        outputChannel.appendLine(`[Skills] Active skills applied: ${skillsSummary.activeSkills.map((s) => s.name).join(', ')}`);
      }
      if (skillsSummary.suppressedSkills && skillsSummary.suppressedSkills.length > 0) {
        outputChannel.appendLine(`[Skills] Suppressed ${skillsSummary.suppressedSkills.length} skill(s) due to token budget ceiling.`);
      }

      const response = await client.sendPromptWithTools(resolvedModel, effectivePrompt, temperature, {
        systemPrompt: [
          HUMAN_READABLE_SYSTEM_PROMPT,
          skillsSummary.injectionPromptSnippet,
          'You have bounded workspace and Git tools.',
          'IMPORTANT FOR GIT TRANSACTIONS: When the user asks you to perform Git actions (such as pull, push, status, diff, commit, checkout, stage, branch, merge, stash, fetch, or inspect remotes for GitHub/GitLab), DO NOT provide markdown tutorials, bash instructions, or tell the user to run commands manually in a terminal. You MUST call the corresponding git tool (such as git_pull, git_push, git_status, git_commit, git_diff, git_branch, git_checkout, git_merge, git_remote, git_stash, git_fetch) directly via tool call.',
          'AUTONOMOUS GIT DECISION-MAKING & RECOVERY: If any Git operation encounters an issue (e.g. push rejected due to remote commits, pull blocked by dirty files or merge conflicts), diagnostic intelligence with recommended steps and safety rules will be provided in the tool result. Carefully review the diagnosis. Never perform destructive actions like force-push or reset. If the user authorized conflict resolution or syncing, call the recommended recovery tool (such as git_stash or git_pull) immediately. Otherwise, explain the problem to the user in 1-2 friendly sentences, propose the safe remediation sequence, and ask if they would like you to proceed.',
          'Use list_workspace_files to discover candidates, search_workspace to find symbols or related code, and read_file to inspect relevant line ranges.',
          'Use Git tools for repository status, diffs, history, branches, checkout, staging, commits, pushes, and pulls. Never infer Git branches from workspace filenames or file contents; use git_branch. Use git_checkout to switch branches and wait for its confirmation result.',
          'Use multiple tool calls when needed. Do not claim to have inspected a file unless a tool result provided its content.',
          'Do not stop after describing what you plan to do. Complete the original request in this turn, then answer the user directly in concise markdown with the outcome. Do not return tool-call JSON in the final answer.',
          isGitRequest ? 'CRITICAL: The user has requested a Git transaction. Immediately execute the appropriate git tool.' : '',
        ].filter(Boolean).join(' '),
        conversationHistory,
        token,
        tools: activeTools,
        executeTool: async (name, arguments_) => {
          if (name.startsWith('git_')) {
            return gitManager.executeTool(name, arguments_);
          }
          if (mcpManager.findToolByExposedName(name)) {
            const result = await mcpManager.executeTool(name, arguments_, token);
            return result.output;
          }
          return contextManager.executeFileTool(name, arguments_);
        },
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
  const detailedLogUri = vscode.Uri.joinPath(logDirectory, 'detailed-activity.log');
  const summaryLogUri = vscode.Uri.joinPath(logDirectory, 'summary-activity.log');
  const activityLogger = new ActivityLogger(outputChannel, logDirectory, detailedLogUri, summaryLogUri);
  const telemetry = new ModelBehaviorTelemetry(context.globalState);
  activityLogger.appendLine(`[Lifecycle] Extension activated; version=${context.extension.packageJSON.version ?? 'unknown'}; summary=${activityLogger.summaryLogPath}; detailed=${activityLogger.detailedLogPath}.`);
  const activityTracker = new ActivityTracker();
  const contextManager = new ContextManager(activityLogger, activityTracker);
  const editorManager = new EditorManager(activityLogger, activityTracker);
  const updateManager = new UpdateManager(activityLogger, context.globalStorageUri);
  const gitManager = new GitManager(activityLogger, activityTracker);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const mcpManager = new McpManager(workspaceRoot, activityLogger, activityTracker);
  const mcpTreeProvider = new McpTreeDataProvider(mcpManager);
  const mcpView = vscode.window.registerTreeDataProvider('localOllama.mcpView', mcpTreeProvider);

  // Helper to load workspace .vscode/mcp.json
  const loadWorkspaceMcpConfig = async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;
    const mcpConfigUri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'mcp.json');
    try {
      const bytes = await vscode.workspace.fs.readFile(mcpConfigUri);
      const content = new TextDecoder('utf-8').decode(bytes);
      const parsed = JSON.parse(content) as McpConfigFile;
      await mcpManager.loadConfig(parsed);
    } catch {
      // mcp.json does not exist yet or is empty
    }
  };

  void loadWorkspaceMcpConfig();

  // Watch for .vscode/mcp.json changes
  const mcpWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/mcp.json');
  mcpWatcher.onDidChange(() => {
    activityLogger.appendLine('[MCP] Detected .vscode/mcp.json change; reloading servers...');
    void loadWorkspaceMcpConfig();
  });
  mcpWatcher.onDidCreate(() => {
    activityLogger.appendLine('[MCP] Detected .vscode/mcp.json creation; loading servers...');
    void loadWorkspaceMcpConfig();
  });
  mcpWatcher.onDidDelete(() => {
    activityLogger.appendLine('[MCP] Detected .vscode/mcp.json deletion; stopping servers...');
    void mcpManager.stopAll();
  });

  // Configure MCP command: opens or initializes .vscode/mcp.json
  const configureMcpCommand = vscode.commands.registerCommand('localOllama.configureMcp', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('Please open a workspace folder to configure MCP servers.');
      return;
    }

    const vscodeDirUri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
    const mcpConfigUri = vscode.Uri.joinPath(vscodeDirUri, 'mcp.json');

    try {
      await vscode.workspace.fs.stat(mcpConfigUri);
    } catch {
      // File doesn't exist, create default template
      const template = {
        mcpServers: {
          sqlite: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "./workspace.db"],
            timeoutMs: 30000,
            maxOutputLength: 8000
          }
        }
      };
      await vscode.workspace.fs.createDirectory(vscodeDirUri);
      await vscode.workspace.fs.writeFile(mcpConfigUri, new TextEncoder().encode(JSON.stringify(template, null, 2)));
    }

    const doc = await vscode.workspace.openTextDocument(mcpConfigUri);
    await vscode.window.showTextDocument(doc);
  });

  const restartMcpServersCommand = vscode.commands.registerCommand('localOllama.restartMcpServers', async () => {
    await loadWorkspaceMcpConfig();
    vscode.window.showInformationMessage('Local Ollama: MCP servers restarted.');
  });

  // Skills Manager & UI
  const skillManager = new SkillManager(workspaceRoot, activityLogger);
  const skillsTreeProvider = new SkillsTreeDataProvider(skillManager);
  const skillsView = vscode.window.registerTreeDataProvider('localOllama.skillsView', skillsTreeProvider);

  const loadWorkspaceSkills = async () => {
    const skillUris = await vscode.workspace.findFiles('**/*SKILL.md', '**/node_modules/**');
    for (const uri of skillUris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = new TextDecoder('utf-8').decode(bytes);
        skillManager.registerSkillFromContent(uri.fsPath, content);
      } catch (err) {
        activityLogger.appendLine(`[Skills] Failed reading ${uri.fsPath}: ${err}`);
      }
    }
  };

  void loadWorkspaceSkills();

  const skillWatcher = vscode.workspace.createFileSystemWatcher('**/*SKILL.md');
  skillWatcher.onDidChange(async (uri) => {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder('utf-8').decode(bytes);
      skillManager.registerSkillFromContent(uri.fsPath, content);
    } catch {
      // ignore
    }
  });
  skillWatcher.onDidCreate(async (uri) => {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder('utf-8').decode(bytes);
      skillManager.registerSkillFromContent(uri.fsPath, content);
    } catch {
      // ignore
    }
  });
  skillWatcher.onDidDelete((uri) => {
    const all = skillManager.getAllSkills();
    const found = all.find((s) => s.filePath === uri.fsPath);
    if (found) {
      skillManager.unregisterSkill(found.id);
    }
  });

  const createSkillCommand = vscode.commands.registerCommand('localOllama.createSkill', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('Please open a workspace folder to create a skill.');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Skill name (e.g. security-audit, api-design, tdd-workflow)',
      placeHolder: 'tdd-workflow',
    });
    if (!name) return;

    const desc = await vscode.window.showInputBox({
      prompt: 'Brief description of what this skill does',
      placeHolder: 'Enforces TDD and regression testing rules',
    });

    const safeName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const skillDirUri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'skills', safeName);
    const skillFileUri = vscode.Uri.joinPath(skillDirUri, 'SKILL.md');

    await vscode.workspace.fs.createDirectory(skillDirUri);
    const template = SkillManager.generateSkillTemplate(safeName, desc || '');
    await vscode.workspace.fs.writeFile(skillFileUri, new TextEncoder().encode(template));

    const doc = await vscode.workspace.openTextDocument(skillFileUri);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Created skill "${safeName}".`);
  });

  const refreshSkillsCommand = vscode.commands.registerCommand('localOllama.refreshSkills', async () => {
    await loadWorkspaceSkills();
    skillsTreeProvider.refresh();
    vscode.window.showInformationMessage('Local Ollama: Skills refreshed.');
  });

  // Configure ActivityTracker settings and persistence
  const retentionDays = getSetting<number>('activityRetentionDays', 7);
  const viewMode = getSetting<'summary' | 'both'>('activityViewMode', 'both');
  activityTracker.setRetentionDays(retentionDays);
  activityTracker.setViewMode(viewMode);

  const savedMetrics = context.globalState.get<string>('localOllama.activityMetricsState');
  if (savedMetrics) {
    activityTracker.importState(savedMetrics);
  }
  activityTracker.setStorageSaveHandler((serialized) => {
    void context.globalState.update('localOllama.activityMetricsState', serialized);
  });

  const summaryProvider = new SummaryMetricsTreeDataProvider(activityTracker);
  const pendingDiffsProvider = new PendingDiffsTreeDataProvider(activityTracker);
  const toolCallsProvider = new ToolCallsTreeDataProvider(activityTracker);
  const fileReadsProvider = new FileReadsTreeDataProvider(activityTracker);

  const summaryView = vscode.window.registerTreeDataProvider('localOllama.summaryView', summaryProvider);
  const pendingDiffsView = vscode.window.registerTreeDataProvider('localOllama.pendingDiffsView', pendingDiffsProvider);
  const toolCallsView = vscode.window.registerTreeDataProvider('localOllama.toolCallsView', toolCallsProvider);
  const fileReadsView = vscode.window.registerTreeDataProvider('localOllama.fileReadsView', fileReadsProvider);

  const clearActivityCommand = vscode.commands.registerCommand('localOllama.clearActivityHistory', () => {
    activityTracker.clearHistory();
    vscode.window.showInformationMessage('Local Ollama activity history cleared.');
  });

  const refreshActivityCommand = vscode.commands.registerCommand('localOllama.refreshActivity', () => {
    summaryProvider.refresh();
    pendingDiffsProvider.refresh();
    toolCallsProvider.refresh();
    fileReadsProvider.refresh();
  });

  const reviewPlanCommand = vscode.commands.registerCommand('localOllama.reviewPlan', () => {
    vscode.commands.executeCommand('workbench.view.extension.local-ollama-activity');
  });
  const extensionPackage = context.extension.packageJSON as { name?: string; publisher?: string; version?: string };
  const extensionId = extensionPackage.publisher && extensionPackage.name
    ? `${extensionPackage.publisher}.${extensionPackage.name}`
    : 'agovind.local-ollama';
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
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Executive Summary Log', description: 'High-level milestones, metrics & sessions', uri: summaryLogUri },
        { label: 'Detailed Steps Log', description: 'Raw tool calls, prompts, diffs & debug steps', uri: detailedLogUri },
      ],
      { placeHolder: 'Select Activity Log to Open (Rotated Weekly)' }
    );
    if (choice) {
      await vscode.window.showTextDocument(choice.uri, { preview: false });
    }
  });

  const openSummaryLogCommand = vscode.commands.registerCommand('localOllama.openSummaryLog', async () => {
    await vscode.window.showTextDocument(summaryLogUri, { preview: false });
  });

  const openDetailedLogCommand = vscode.commands.registerCommand('localOllama.openDetailedLog', async () => {
    await vscode.window.showTextDocument(detailedLogUri, { preview: false });
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
    openSummaryLogCommand,
    openDetailedLogCommand,
    summaryView,
    pendingDiffsView,
    toolCallsView,
    fileReadsView,
    mcpView,
    configureMcpCommand,
    restartMcpServersCommand,
    mcpWatcher,
    skillsView,
    createSkillCommand,
    refreshSkillsCommand,
    skillWatcher,
    clearActivityCommand,
    refreshActivityCommand,
    reviewPlanCommand,
  );
  registerChatParticipant(context, contextManager, editorManager, updateManager, gitManager, mcpManager, skillManager, extensionVersion, activityLogger, telemetry, activityTracker);
}

export function deactivate() {
  // no-op
}
