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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const samplePrompts = [
    { label: '/git pull', text: '@local-ollama /git pull' },
    { label: '/git push', text: '@local-ollama /git push' },
    { label: 'git status', text: '@local-ollama check git status' },
    { label: '/edit Input Validation', text: '@local-ollama /edit Add password length validation and account lockout to AuthService' },
    { label: '/refactor Health Check', text: '@local-ollama /refactor Add health check endpoint and error wrapper in routes.ts' },
    { label: '/models', text: '@local-ollama /models' },
  ];

  return (
    <div id="chat-sidebar-panel" className="h-full flex flex-col bg-[#252526] select-none">
      {/* Header */}
      <div className="h-9 px-4 flex items-center justify-between border-b border-[#333333] text-[11px] font-bold uppercase tracking-wider text-[#bbbbbb]">
        <div className="flex items-center gap-1.5">
          <Bot className="w-4 h-4 text-blue-400" />
          <span>Chat: @local-ollama</span>
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
                    <span className="text-blue-400 font-semibold">@local-ollama</span>
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
      <form onSubmit={handleSubmit} className="p-3 bg-[#1e1e1e] border-t border-[#333333]">
        <div className="flex flex-col gap-2 bg-[#252526] border border-[#3c3c3c] rounded-lg p-2 focus-within:border-blue-500 transition-colors">
          <textarea
            id="chat-user-input"
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Ask @local-ollama, /pull, /push, /git, /edit, /refactor..."
            className="w-full bg-transparent text-xs text-white placeholder-[#777777] focus:outline-none resize-none"
          />

          <div className="flex items-center justify-between pt-1 border-t border-[#333333] text-[10px] text-[#858585]">
            <div className="flex items-center gap-1 font-mono">
              <span className="text-blue-400">@local-ollama</span>
              <span>•</span>
              <span>Enter to send</span>
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
