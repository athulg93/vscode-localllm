import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TitleBar } from './components/TitleBar';
import { ActivityBar, ActiveSidebarTab } from './components/ActivityBar';
import { ExplorerPanel } from './components/ExplorerPanel';
import { ChatPanel, ChatMessageItem } from './components/ChatPanel';
import { LogsPanel } from './components/LogsPanel';
import { SettingsPanel, ExtensionSettings } from './components/SettingsPanel';
import { UpdatePanel } from './components/UpdatePanel';
import { EditorArea } from './components/EditorArea';
import { EditPlanModal } from './components/EditPlanModal';
import { StatusBar } from './components/StatusBar';

import { WebWorkspace } from './web/WebWorkspace';
import { WebLogger, LogEntry } from './web/WebLogger';
import { WebOllamaProvider, SIMULATED_MODELS } from './web/WebOllamaProvider';
import { classifyPromptIntent } from './core/PromptIntentClassifier';
import { parseEditPlan } from './core/EditPlanParser';
import { EditPlan, EditPlanItem, PromptIntent } from './types';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOOL_CALLS,
  HUMAN_READABLE_SYSTEM_PROMPT,
} from './constants';

export function App() {
  // Initialize services
  const logger = useMemo(() => new WebLogger(), []);
  const workspace = useMemo(() => new WebWorkspace(), []);
  const provider = useMemo(() => new WebOllamaProvider(DEFAULT_BASE_URL, logger), [logger]);

  // State
  const [activeTab, setActiveTab] = useState<ActiveSidebarTab>('chat');
  const [files, setFiles] = useState(() => workspace.getAllFiles());
  const [activeFile, setActiveFile] = useState<string>('src/auth/AuthService.ts');
  const [openTabs, setOpenTabs] = useState<string[]>([
    'src/auth/AuthService.ts',
    'src/api/routes.ts',
  ]);

  const [settings, setSettings] = useState<ExtensionSettings>({
    baseUrl: DEFAULT_BASE_URL,
    defaultModel: DEFAULT_MODEL,
    temperature: DEFAULT_TEMPERATURE,
    autoCreateDirectories: true,
    maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
  });

  const [models, setModels] = useState<string[]>(SIMULATED_MODELS);
  const [isSimulated, setIsSimulated] = useState<boolean>(true);
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | undefined>(undefined);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const cancellationRef = useRef<AbortController | null>(null);

  const [pendingEditPlan, setPendingEditPlan] = useState<EditPlan | null>(null);
  const [originalContentsForPlan, setOriginalContentsForPlan] = useState<Record<string, string>>({});

  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Welcome to **Local Ollama** (@localllm)!

I bring local AI assistance to your workspace with bounded tool execution and structured edit plans.

**Quick Commands:**
- \`/models\` — List installed or simulated local models
- \`/edit <request>\` — Generate structured diffs and edits for your workspace
- \`/refactor <request>\` — Propose project-wide architectural refactoring
- \`/connect\` — Test or configure your Ollama server connection
- \`/update\` — Check GitHub Releases for newer extension versions
- \`/pull\`, \`/push\`, \`/status\`, \`/diff\` — Local Git operations

Try one of the quick prompt buttons below, or ask a question about \`AuthService.ts\`!`,
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);

  // Subscribe to log updates
  useEffect(() => {
    logger.appendLine(`[Lifecycle] Local Ollama Extension initialized. Default model: ${settings.defaultModel}`);
    const unsubscribe = logger.subscribe((entry) => {
      setLogs((prev) => [...prev, entry]);
    });
    return unsubscribe;
  }, [logger, settings.defaultModel]);

  // Initial connection test
  const handleCheckConnection = async () => {
    setIsTestingConnection(true);
    setConnectionError(undefined);
    try {
      const result = await provider.testConnection();
      if (result.ok) {
        setModels(result.models);
        setIsSimulated(false);
        setConnectionError(undefined);
      } else {
        setModels(SIMULATED_MODELS);
        setIsSimulated(true);
        setConnectionError(result.error);
      }
    } finally {
      setIsTestingConnection(false);
    }
  };

  useEffect(() => {
    handleCheckConnection();
  }, [provider]);

  // File Operations
  const handleSelectFile = (path: string) => {
    setActiveFile(path);
    if (!openTabs.includes(path)) {
      setOpenTabs((prev) => [...prev, path]);
    }
  };

  const handleCloseTab = (path: string) => {
    const nextTabs = openTabs.filter((t) => t !== path);
    setOpenTabs(nextTabs);
    if (activeFile === path) {
      if (nextTabs.length > 0) {
        setActiveFile(nextTabs[nextTabs.length - 1]);
      } else {
        setActiveFile('');
      }
    }
  };

  const handleSaveFile = (path: string, content: string) => {
    workspace.setFile(path, content);
    setFiles(workspace.getAllFiles());
    logger.appendLine(`[Editor] Saved changes to ${path} (${content.length} chars)`);
  };

  const handleCreateFile = (path: string, content = '') => {
    workspace.setFile(path, content);
    setFiles(workspace.getAllFiles());
    handleSelectFile(path);
    logger.appendLine(`[Workspace] Created file ${path}`);
  };

  const handleDeleteFile = (path: string) => {
    workspace.deleteFile(path);
    setFiles(workspace.getAllFiles());
    handleCloseTab(path);
    logger.appendLine(`[Workspace] Deleted file ${path}`);
  };

  const handleResetWorkspace = () => {
    workspace.reset();
    setFiles(workspace.getAllFiles());
    setActiveFile('src/auth/AuthService.ts');
    setOpenTabs(['src/auth/AuthService.ts', 'src/api/routes.ts']);
    logger.appendLine('[Workspace] Reset all files to default sample state.');
  };

  // Chat Execution
  const handleSendMessage = async (rawInput: string) => {
    if (isLoading) return;

    let text = rawInput.trim();
    if (text.startsWith('@localllm')) {
      text = text.replace(/^@localllm\s*/, '');
    } else if (text.startsWith('@local-ollama')) {
      text = text.replace(/^@local-ollama\s*/, '');
    }

    // Handle inline model directive (@model <prompt>)
    let modelToUse = settings.defaultModel;
    if (text.startsWith('@')) {
      const match = text.match(/^@([^\s]+)\s*(.*)$/s);
      if (match) {
        const requested = match[1];
        const remaining = match[2]?.trim() || '';
        if (requested.toLowerCase() === 'models') {
          text = '/models';
        } else {
          modelToUse = requested;
          text = remaining;
          logger.appendLine(`[Chat] Inline model override: ${modelToUse}`);
          if (!text) {
            setSettings((s) => ({ ...s, defaultModel: modelToUse }));
            setMessages((prev) => [
              ...prev,
              {
                id: Math.random().toString(36),
                role: 'assistant',
                content: `Switched default model to **${modelToUse}**. Send your next message to continue.`,
                timestamp: new Date().toLocaleTimeString(),
              },
            ]);
            return;
          }
        }
      }
    }

    // Add user message
    const userMsgId = Math.random().toString(36).substring(2, 9);
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        content: rawInput,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    // Handle slash commands immediately
    if (text.toLowerCase() === '/models') {
      const summary = models.map((m) => `- **${m}**`).join('\n');
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36),
          role: 'assistant',
          content: `Available local Ollama models:\n\n${summary}\n\nUse \`@<model-name>\` in chat to select a model.`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      return;
    }

    if (text.toLowerCase() === '/connect') {
      setActiveTab('settings');
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36),
          role: 'assistant',
          content: `Opened the Settings panel to configure your Ollama server URL and default model.`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      return;
    }

    if (text.toLowerCase() === '/update') {
      setActiveTab('updates');
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36),
          role: 'assistant',
          content: `Opened the Updates panel to check GitHub Releases for newer extension versions.`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      return;
    }

    if (text.toLowerCase() === '/clear' || text.toLowerCase() === '/reset') {
      handleClearChat();
      return;
    }

    // Direct Git command shortcuts in interactive preview
    const directGitMatch = text.match(/^\/?(?:git\s+)?(pull|push|status|diff|log|branch)(?:\s+(.*))?$/i);
    if (directGitMatch) {
      const gitAction = directGitMatch[1].toLowerCase();
      const extraArgs = (directGitMatch[2] || '').trim();
      logger.appendLine(`[Git] Executing Git ${gitAction} command directly: "${text}"`);
      
      let gitOutput = '';
      if (gitAction === 'status') {
        gitOutput = `On branch main\nYour branch is up to date with 'origin/main'.\n\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n\tnominal modifications in src/auth/AuthService.ts\n\nno changes added to commit (use "git add")`;
      } else if (gitAction === 'pull') {
        gitOutput = `Updating 4a19c3b..8f2b10e\nFast-forward\n src/auth/AuthService.ts | 12 +++++++++++-\n 1 file changed, 11 insertions(+), 1 deletion(-)\nSuccessfully pulled latest changes from origin/main.`;
      } else if (gitAction === 'push') {
        gitOutput = `Enumerating objects: 7, done.\nCounting objects: 100% (7/7), done.\nWriting objects: 100% (4/4), 842 bytes | 842.00 KiB/s, done.\nTotal 4 (delta 2), reused 0 (delta 0)\nTo https://github.com/athulg93/vscode-localllm.git\n   8f2b10e..9c34a1b  main -> main\nBranch 'main' set up to track remote branch 'main' from 'origin'.`;
      } else if (gitAction === 'diff') {
        gitOutput = `diff --git a/src/auth/AuthService.ts b/src/auth/AuthService.ts\nindex 8f2b10e..9c34a1b 100644\n--- a/src/auth/AuthService.ts\n+++ b/src/auth/AuthService.ts\n@@ -12,3 +12,6 @@\n+    // Rate limit check\n+    if (this.failedAttempts >= 5) throw new Error('Locked');`;
      } else if (gitAction === 'branch') {
        gitOutput = `* main\n  feature/auth-hardening\n  dev`;
      } else {
        gitOutput = `commit 9c34a1b7e9231f82c4\nAuthor: Local Developer <dev@local.workspace>\nDate:   ${new Date().toLocaleString()}\n\n    feat: git transaction tooling and direct execution`;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36),
          role: 'assistant',
          content: `### Git ${gitAction.toUpperCase()} Result\n\n\`\`\`bash\n${gitOutput}\n\`\`\`\n\n*Git operation completed successfully.*`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      return;
    }

    // Classify Prompt Intent
    const intent = classifyPromptIntent(text);
    logger.appendLine(`[Chat] Request started with prompt: "${text.slice(0, 60)}..." (Intent: ${intent})`);

    const assistantMsgId = Math.random().toString(36).substring(2, 9);
    const initialAssistantMsg: ChatMessageItem = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString(),
      intent,
      statusText: `Connecting to ${modelToUse}...`,
      toolCalls: [],
      isStreaming: true,
    };

    setMessages((prev) => [...prev, initialAssistantMsg]);
    setIsLoading(true);

    const abortController = new AbortController();
    cancellationRef.current = abortController;

    const token = {
      get isCancellationRequested() {
        return abortController.signal.aborted;
      },
      onCancellationRequested: (listener: () => void) => {
        abortController.signal.addEventListener('abort', listener);
        return { dispose: () => abortController.signal.removeEventListener('abort', listener) };
      },
    };

    try {
      const response = await provider.sendPromptWithTools(
        modelToUse,
        text,
        settings.temperature,
        {
          systemPrompt: HUMAN_READABLE_SYSTEM_PROMPT,
          token,
          tools: workspace.getTools(),
          executeTool: async (name, args) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      statusText: `Running ${name}...`,
                      toolCalls: [
                        ...(m.toolCalls || []),
                        {
                          name,
                          target: (args.path as string) || (args.query as string) || undefined,
                          status: 'executing',
                        },
                      ],
                    }
                  : m
              )
            );
            return workspace.executeTool(name, args);
          },
          maxToolCalls: settings.maxToolCalls,
          onStatus: (status) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, statusText: status } : m))
            );
          },
        }
      );

      // Check if response contains an EditPlan
      const parsedPlan = parseEditPlan(response);
      if (parsedPlan && parsedPlan.edits && parsedPlan.edits.length > 0) {
        const editsList = parsedPlan.edits;
        const editCount = editsList.length;
        // Collect original contents for diffing
        const originals: Record<string, string> = {};
        for (const edit of editsList) {
          originals[edit.path] = workspace.getFile(edit.path) || '';
        }
        setOriginalContentsForPlan(originals);
        setPendingEditPlan(parsedPlan);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: `Proposed **${editCount}** code modification(s) across the workspace.\n\nPlease review the diff preview to keep or discard each change before applying.`,
                  statusText: undefined,
                  isStreaming: false,
                  editPlanSummary: parsedPlan.summary,
                }
              : m
          )
        );
      } else {
        // Normal text response
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: response,
                  statusText: undefined,
                  isStreaming: false,
                }
              : m
          )
        );
      }
    } catch (err: any) {
      const errMsg = err.message || 'Error executing request';
      logger.appendLine(`[Chat] Error: ${errMsg}`);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: `I encountered a problem contacting Local Ollama:\n\n\`${errMsg}\`\n\nEnsure your Ollama server is running with \`ollama serve\` or switch to Simulator Mode in the titlebar.`,
                statusText: undefined,
                isStreaming: false,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      cancellationRef.current = null;
    }
  };

  const handleCancelRequest = () => {
    if (cancellationRef.current) {
      cancellationRef.current.abort();
      logger.appendLine('[Chat] Request cancelled by user.');
    }
  };

  // Applying Edit Plan
  const handleApplyEditPlan = (selectedEdits: EditPlanItem[]) => {
    if (!pendingEditPlan) return;

    logger.appendLine(`[EditPlan] Applying ${selectedEdits.length} approved edits.`);
    for (const edit of selectedEdits) {
      if (edit.operation === 'delete') {
        workspace.deleteFile(edit.path);
        logger.appendLine(`[EditPlan] Deleted file ${edit.path}`);
      } else if (edit.operation === 'rename' && edit.newPath) {
        workspace.renameFile(edit.path, edit.newPath);
        if (edit.content !== undefined) {
          workspace.setFile(edit.newPath, edit.content);
        }
        logger.appendLine(`[EditPlan] Renamed file ${edit.path} -> ${edit.newPath}`);
      } else {
        // create or update
        workspace.setFile(edit.path, edit.content || '');
        logger.appendLine(`[EditPlan] Updated file ${edit.path}`);
      }
    }

    setFiles(workspace.getAllFiles());
    setPendingEditPlan(null);

    // Open first edited file in editor
    if (selectedEdits[0]?.path) {
      handleSelectFile(selectedEdits[0].path);
    }

    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36),
        role: 'assistant',
        content: `Applied **${selectedEdits.length}** approved edit(s) to the workspace successfully!`,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  };

  const handleDiscardEditPlan = () => {
    logger.appendLine('[EditPlan] Discarded proposed edit plan.');
    setPendingEditPlan(null);
  };

  const handleClearChat = () => {
    if (isLoading) {
      handleCancelRequest();
    }
    setPendingEditPlan(null);
    setMessages([
      {
        id: 'welcome-' + Date.now(),
        role: 'assistant',
        content: `Started a fresh new conversation! Context and previous failed edits have been cleared.

**Quick Commands:**
- \`/models\` — List installed or simulated local models
- \`/edit <request>\` — Generate structured diffs and edits for your workspace
- \`/refactor <request>\` — Propose project-wide architectural refactoring
- \`/clear\` — Reset the chat session anytime`,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
    logger.appendLine('[Chat] Conversation reset: started a fresh new session.');
  };

  return (
    <div id="vscode-app-container" className="h-screen w-screen flex flex-col bg-[#1e1e1e] text-[#cccccc] overflow-hidden">
      {/* Title Bar */}
      <TitleBar
        model={settings.defaultModel}
        models={models}
        onSelectModel={(m) => setSettings((s) => ({ ...s, defaultModel: m }))}
        isSimulated={isSimulated}
        onToggleSimulated={() => {
          provider.isSimulationMode = !isSimulated;
          setIsSimulated(!isSimulated);
          logger.appendLine(`[Config] Switched to ${!isSimulated ? 'Simulator Mode' : 'Live Mode'}`);
        }}
        onRefreshConnection={handleCheckConnection}
        isCheckingConnection={isTestingConnection}
        connectionError={connectionError}
        onResetWorkspace={handleResetWorkspace}
        onOpenLogs={() => setActiveTab('logs')}
      />

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* VS Code Activity Bar */}
        <ActivityBar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          unreadLogsCount={logs.length}
        />

        {/* Primary Sidebar (Explorer, Chat, Logs, Settings, Updates) */}
        <div className="w-80 md:w-96 flex flex-col border-r border-[#252526] shrink-0 overflow-hidden bg-[#252526]">
          {activeTab === 'chat' && (
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
              onCancelRequest={handleCancelRequest}
              currentModel={settings.defaultModel}
              onOpenEditPlan={() => pendingEditPlan && setPendingEditPlan(pendingEditPlan)}
              onClearChat={handleClearChat}
            />
          )}

          {activeTab === 'explorer' && (
            <ExplorerPanel
              files={files}
              activeFile={activeFile}
              onSelectFile={handleSelectFile}
              onCreateFile={handleCreateFile}
              onDeleteFile={handleDeleteFile}
            />
          )}

          {activeTab === 'logs' && (
            <LogsPanel
              logs={logs}
              onClearLogs={() => {
                logger.clear();
                setLogs([]);
              }}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsPanel
              settings={settings}
              onUpdateSettings={setSettings}
              onTestConnection={handleCheckConnection}
              isTesting={isTestingConnection}
              models={models}
            />
          )}

          {activeTab === 'updates' && (
            <UpdatePanel currentVersion="1.3.1" />
          )}
        </div>

        {/* Main Editor Area */}
        <EditorArea
          activeFilePath={activeFile}
          fileContent={workspace.getFile(activeFile) || ''}
          openTabs={openTabs}
          onSelectTab={handleSelectFile}
          onCloseTab={handleCloseTab}
          onSaveFile={handleSaveFile}
          onAskAboutFile={(path) => {
            setActiveTab('chat');
            handleSendMessage(`@localllm Explain what ${path} does and suggest improvements.`);
          }}
        />
      </div>

      {/* Status Bar */}
      <StatusBar
        model={settings.defaultModel}
        isSimulated={isSimulated}
        activeFilePath={activeFile}
        fileCount={files.length}
        maxToolCalls={settings.maxToolCalls}
        onOpenLogs={() => setActiveTab('logs')}
        onSelectModel={() => setActiveTab('settings')}
      />

      {/* Edit Plan Modal (Diff & Review) */}
      <EditPlanModal
        plan={pendingEditPlan}
        originalContents={originalContentsForPlan}
        onApply={handleApplyEditPlan}
        onDiscard={handleDiscardEditPlan}
      />
    </div>
  );
}

export default App;
