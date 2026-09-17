import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  Wrench,
  Loader2,
  FileEdit,
  Code,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  Terminal,
  RotateCcw,
  GitPullRequest,
  GitBranch,
  GitCommit,
  Layers,
  Settings,
  RefreshCw,
} from 'lucide-react';
import { PromptIntent } from '../types';
import { classifyPromptIntent } from '../core/PromptIntentClassifier';

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  intent?: PromptIntent;
  statusText?: string;
  toolCalls?: Array<{ name: string; target?: string; status: string }>;
  editPlanSummary?: string;
  isStreaming?: boolean;
}

interface ChatPanelProps {
  messages: ChatMessageItem[];
  onSendMessage: (text: string) => void;
  isLoading: boolean;
  onCancelRequest: () => void;
  currentModel: string;
  onOpenEditPlan?: () => void;
  onClearChat?: () => void;
}

interface SlashCommandDef {
  name: string;
  description: string;
  category: 'Git' | 'Code' | 'Config' | 'System';
}

interface GitSubcommandDef {
  name: string;
  description: string;
  argsHint?: string;
}

const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: '/git', description: 'Run Git operations (interactive subcommands)', category: 'Git' },
  { name: '/git-status', description: 'Show Git status and current branch', category: 'Git' },
  { name: '/git-push', description: 'Push commits to GitLab or GitHub remote', category: 'Git' },
  { name: '/git-pull', description: 'Pull latest changes from GitLab or GitHub remote', category: 'Git' },
  { name: '/git-remote', description: 'Inspect remotes and detect GitLab / GitHub hosts', category: 'Git' },
  { name: '/git-merge', description: 'Merge a branch into the active branch', category: 'Git' },
  { name: '/git-diff', description: 'Show bounded working tree diff', category: 'Git' },
  { name: '/git-commit', description: 'Commit staged changes with message', category: 'Git' },
  { name: '/git-branch', description: 'Show local and remote branches', category: 'Git' },
  { name: '/git-checkout', description: 'Switch to an existing local branch', category: 'Git' },
  { name: '/git-add', description: 'Stage workspace files for commit', category: 'Git' },
  { name: '/git-log', description: 'Show recent commit log', category: 'Git' },
  { name: '/edit', description: 'Propose structured file edits with interactive review', category: 'Code' },
  { name: '/refactor', description: 'Propose multi-file project refactoring plan', category: 'Code' },
  { name: '/models', description: 'List available local Ollama models', category: 'Config' },
  { name: '/change-model', description: 'Change the active default model', category: 'Config' },
  { name: '/connect', description: 'Configure Ollama base URL and test connection', category: 'Config' },
  { name: '/clear', description: 'Reset conversation context and start fresh', category: 'System' },
  { name: '/update', description: 'Check extension updates (GitHub Releases)', category: 'System' },
];

const GIT_SUBCOMMANDS: GitSubcommandDef[] = [
  { name: 'status', description: 'Show working tree status and branch' },
  { name: 'diff', description: 'Show bounded working tree or staged diff', argsHint: '[--staged]' },
  { name: 'log', description: 'Show recent commit history' },
  { name: 'branch', description: 'Show repository branches' },
  { name: 'pull', description: 'Pull latest changes from GitLab or GitHub remote', argsHint: '[remote] [branch]' },
  { name: 'push', description: 'Push commits to GitLab or GitHub remote', argsHint: '[remote] [branch]' },
  { name: 'remote', description: 'Inspect remotes and detect GitLab / GitHub hosts' },
  { name: 'merge', description: 'Merge an existing branch into current branch', argsHint: '<branch>' },
  { name: 'checkout', description: 'Switch to an existing branch', argsHint: '<branch>' },
  { name: 'add', description: 'Stage specific workspace files for commit', argsHint: '<paths...>' },
  { name: 'commit', description: 'Commit staged changes with message', argsHint: '<message>' },
];

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  isLoading,
  onCancelRequest,
  currentModel,
  onOpenEditPlan,
  onClearChat,
}) => {
  const [inputText, setInputText] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Determine matching commands: either root slash commands or /git subcommands
  const isGitSubQuery = inputText.startsWith('/git ') && inputText.trim().split(/\s+/).length <= 2 && !inputText.endsWith('  ');
  const isRootSlashQuery = inputText.startsWith('/') && !inputText.includes(' ');

  const gitSubPrefix = isGitSubQuery ? inputText.slice(5).trim().toLowerCase() : '';
  const filteredGitSubcommands = isGitSubQuery
    ? GIT_SUBCOMMANDS.filter((sc) => sc.name.toLowerCase().startsWith(gitSubPrefix))
    : [];

  const slashPrefix = isRootSlashQuery ? inputText.toLowerCase() : '';
  const filteredSlashCommands = isRootSlashQuery
    ? SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(slashPrefix))
    : [];

  const activeMenuCount = isGitSubQuery ? filteredGitSubcommands.length : filteredSlashCommands.length;

  useEffect(() => {
    if (activeMenuCount > 0) {
      setShowSlashMenu(true);
      setSelectedSlashIndex(0);
    } else {
      setShowSlashMenu(false);
    }
  }, [isGitSubQuery, activeMenuCount]);

  const selectSlashCommand = (cmd: SlashCommandDef) => {
    if (cmd.name === '/git') {
      setInputText('/git ');
    } else {
      setInputText(`${cmd.name} `);
    }
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  };

  const selectGitSubcommand = (sc: GitSubcommandDef) => {
    const trailingSpace = sc.argsHint ? ' ' : '';
    setInputText(`/git ${sc.name}${trailingSpace}`);
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    setShowSlashMenu(false);
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && activeMenuCount > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev + 1) % activeMenuCount);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev - 1 + activeMenuCount) % activeMenuCount);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        if (isGitSubQuery) {
          const chosenSub = filteredGitSubcommands[selectedSlashIndex];
          if (chosenSub) selectGitSubcommand(chosenSub);
        } else {
          const chosen = filteredSlashCommands[selectedSlashIndex];
          if (chosen) selectSlashCommand(chosen);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const samplePrompts = [
    { label: '/git status', text: '@localllm /git status' },
    { label: '/git diff', text: '@localllm /git diff' },
    { label: '/git pull', text: '@localllm /git pull' },
    { label: '/git push', text: '@localllm /git push' },
    { label: '/edit Input Validation', text: '@localllm /edit Add password length validation and account lockout to AuthService' },
    { label: '/refactor Health Check', text: '@localllm /refactor Add health check endpoint and error wrapper in routes.ts' },
    { label: '/models', text: '@localllm /models' },
  ];

  return (
    <div id="chat-sidebar-panel" className="h-full flex flex-col bg-[#252526] select-none">
      {/* Header */}
      <div className="h-9 px-4 flex items-center justify-between border-b border-[#333333] text-[11px] font-bold uppercase tracking-wider text-[#bbbbbb]">
        <div className="flex items-center gap-1.5">
          <Bot className="w-4 h-4 text-blue-400" />
          <span>Chat: @localllm</span>
        </div>
        <div className="flex items-center gap-2">
          {onClearChat && (
            <button
              id="btn-new-conversation"
              onClick={onClearChat}
              title="Start a fresh new conversation (/clear)"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-neutral-400 hover:text-white hover:bg-[#333333] transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="font-normal capitalize">New</span>
            </button>
          )}
          <span className="font-mono text-[10px] text-[#858585] lowercase">
            @{currentModel}
          </span>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex flex-col gap-1 text-xs ${
                isUser ? 'items-end' : 'items-start'
              }`}
            >
              {/* Message Header / Role Tag */}
              <div className="flex items-center gap-1.5 text-[10px] text-[#858585] px-1">
                {isUser ? (
                  <>
                    <span>You</span>
                    <User className="w-3 h-3 text-neutral-400" />
                  </>
                ) : (
                  <>
                    <Bot className="w-3 h-3 text-blue-400" />
                    <span className="text-blue-400 font-semibold">@localllm</span>
                    {msg.intent && (
                      <span className="bg-[#1e1e1e] border border-[#3c3c3c] text-neutral-300 px-1.5 py-0.5 rounded text-[9px] font-mono">
                        {msg.intent}
                      </span>
                    )}
                  </>
                )}
                <span>{msg.timestamp}</span>
              </div>

              {/* Message Bubble */}
              <div
                className={`rounded-lg p-3 max-w-[95%] text-xs leading-relaxed whitespace-pre-wrap select-text ${
                  isUser
                    ? 'bg-[#0e639c] text-white'
                    : 'bg-[#1e1e1e] border border-[#3c3c3c] text-[#cccccc] shadow-sm'
                }`}
              >
                {/* Tool status during processing */}
                {msg.statusText && (
                  <div className="mb-2 flex items-center gap-2 p-1.5 rounded bg-[#252526] text-blue-300 text-[11px] font-mono border border-blue-900/40">
                    <Loader2 className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
                    <span>{msg.statusText}</span>
                  </div>
                )}

                {/* Tool calls breakdown */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mb-2.5 p-2 rounded bg-[#181818] border border-[#333333] text-[11px]">
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-neutral-400 mb-1.5">
                      <Wrench className="w-3 h-3 text-amber-400" />
                      <span>Bounded Workspace Exploration ({msg.toolCalls.length}):</span>
                    </div>
                    <div className="space-y-1 font-mono text-[10px]">
                      {msg.toolCalls.map((tc, idx) => (
                        <div key={idx} className="flex items-center gap-1 text-neutral-300">
                          <span className="text-[#858585]">{idx + 1}.</span>
                          <span className="text-blue-400 font-semibold">{tc.name}</span>
                          {tc.target && <span className="text-neutral-400">({tc.target})</span>}
                          <span className="text-emerald-400 ml-auto text-[9px]">✓ done</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Edit Plan Summary Alert */}
                {msg.editPlanSummary && (
                  <div className="mb-2 p-2 rounded bg-amber-950/30 border border-amber-600/40 text-amber-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-300">
                        <FileEdit className="w-3.5 h-3.5 text-amber-400" />
                        <span>Structured Edit Plan Prepared</span>
                      </div>
                      {onOpenEditPlan && (
                        <button
                          onClick={onOpenEditPlan}
                          className="bg-amber-600 hover:bg-amber-500 text-black px-2 py-0.5 rounded text-[10px] font-bold"
                        >
                          Review Diff
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-amber-100/90">{msg.editPlanSummary}</p>
                  </div>
                )}

                {/* Main Content */}
                <div>{msg.content}</div>

                {msg.isStreaming && (
                  <span className="inline-block w-1.5 h-3.5 bg-blue-400 ml-1 animate-pulse" />
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested chips */}
      <div className="px-3 pt-2 pb-1 border-t border-[#333333] bg-[#1e1e1e]/60">
        <div className="text-[10px] text-[#858585] mb-1 font-medium">Quick Prompts:</div>
        <div className="flex flex-wrap gap-1">
          {samplePrompts.map((sp, idx) => (
            <button
              key={idx}
              id={`quick-prompt-btn-${idx}`}
              onClick={() => onSendMessage(sp.text)}
              disabled={isLoading}
              className="text-[10px] bg-[#2d2d2d] hover:bg-[#383838] border border-[#3c3c3c] text-[#bbbbbb] hover:text-white px-2 py-1 rounded transition-colors disabled:opacity-50 text-left"
            >
              {sp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Box */}
      <form onSubmit={handleSubmit} className="relative p-3 bg-[#1e1e1e] border-t border-[#333333]">
        {/* Slash Command / Git Subcommand Autocomplete Popover */}
        {showSlashMenu && activeMenuCount > 0 && (
          <div
            id="slash-commands-popover"
            className="absolute left-3 right-3 bottom-[calc(100%+4px)] max-h-60 overflow-y-auto bg-[#252526] border border-[#454545] rounded-md shadow-2xl z-50 text-xs py-1"
          >
            <div className="px-2.5 py-1 text-[10px] font-semibold text-[#858585] uppercase tracking-wider border-b border-[#333333] flex items-center justify-between">
              <span>
                {isGitSubQuery ? `Git Subcommands (${filteredGitSubcommands.length})` : `Slash Commands (${filteredSlashCommands.length})`}
              </span>
              <span className="text-[9px] font-normal lowercase text-[#666666]">↑↓ to navigate • Tab/Enter to choose</span>
            </div>

            {isGitSubQuery ? (
              filteredGitSubcommands.map((sub, idx) => {
                const isSelected = idx === selectedSlashIndex;
                return (
                  <button
                    key={sub.name}
                    type="button"
                    id={`git-subcmd-${sub.name}`}
                    onClick={() => selectGitSubcommand(sub)}
                    className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 transition-colors ${
                      isSelected ? 'bg-[#094771] text-white' : 'hover:bg-[#2a2d2e] text-[#cccccc]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-semibold text-emerald-400">/git {sub.name}</span>
                      {sub.argsHint && <span className="font-mono text-[10px] text-[#777777]">{sub.argsHint}</span>}
                      <span className="truncate text-[11px] text-[#999999]">{sub.description}</span>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                      Git
                    </span>
                  </button>
                );
              })
            ) : (
              filteredSlashCommands.map((cmd, idx) => {
                const isSelected = idx === selectedSlashIndex;
                return (
                  <button
                    key={cmd.name}
                    type="button"
                    id={`slash-cmd-${cmd.name.replace('/', '')}`}
                    onClick={() => selectSlashCommand(cmd)}
                    className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 transition-colors ${
                      isSelected ? 'bg-[#094771] text-white' : 'hover:bg-[#2a2d2e] text-[#cccccc]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-semibold text-blue-300">{cmd.name}</span>
                      <span className="truncate text-[11px] text-[#999999]">{cmd.description}</span>
                    </div>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase ${
                        cmd.category === 'Git'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                          : cmd.category === 'Code'
                          ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                          : 'bg-neutral-800 text-neutral-400'
                      }`}
                    >
                      {cmd.category}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 bg-[#252526] border border-[#3c3c3c] rounded-lg p-2 focus-within:border-blue-500 transition-colors">
          <textarea
            ref={textareaRef}
            id="chat-user-input"
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type / for Git & code commands, or ask @localllm..."
            className="w-full bg-transparent text-xs text-white placeholder-[#777777] focus:outline-none resize-none"
          />

          <div className="flex items-center justify-between pt-1 border-t border-[#333333] text-[10px] text-[#858585]">
            <div className="flex items-center gap-1 font-mono">
              <span className="text-blue-400">@localllm</span>
              <span>•</span>
              <span>Type / for commands</span>
            </div>

            {isLoading ? (
              <button
                type="button"
                id="cancel-chat-request-btn"
                onClick={onCancelRequest}
                className="flex items-center gap-1 bg-red-800 hover:bg-red-700 text-white px-2 py-1 rounded font-medium transition-colors"
              >
                <AlertTriangle className="w-3 h-3" />
                <span>Cancel</span>
              </button>
            ) : (
              <button
                type="submit"
                id="send-chat-request-btn"
                disabled={!inputText.trim()}
                className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-2.5 py-1 rounded font-medium transition-colors"
              >
                <span>Send</span>
                <Send className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
