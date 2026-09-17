import React, { useState, useEffect } from 'react';
import {
  Activity,
  Terminal,
  FileCode2,
  GitCompare,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Clock,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Layers,
  BarChart3,
  Sliders,
} from 'lucide-react';
import {
  ActivityTracker,
  ToolCallActivity,
  FileReadActivity,
  PendingDiffActivity,
  ActivitySummaryMetrics,
  globalActivityTracker,
} from '../core/ActivityTracker';
import { LogEntry } from '../web/WebLogger';
import { ActivitySummaryView } from './ActivitySummaryView';

interface ActivityPanelProps {
  logs: LogEntry[];
  onClearLogs: () => void;
  onOpenFile?: (path: string) => void;
  onReviewDiff?: () => void;
  onApplyPendingDiff?: () => void;
  onDiscardPendingDiff?: () => void;
  currentModel?: string;
}

export const ActivityPanel: React.FC<ActivityPanelProps> = ({
  logs,
  onClearLogs,
  onOpenFile,
  onReviewDiff,
  onApplyPendingDiff,
  onDiscardPendingDiff,
  currentModel = 'qwen2.5-coder:7b',
}) => {
  const [activeTab, setActiveTab] = useState<'summary' | 'tools' | 'reads' | 'diffs' | 'raw'>('summary');
  const [viewMode, setViewMode] = useState<'summary' | 'both'>(() => globalActivityTracker.getViewMode());
  const [retentionDays, setRetentionDays] = useState<number>(() => globalActivityTracker.getRetentionDays());
  const [summaryMetrics, setSummaryMetrics] = useState<ActivitySummaryMetrics>(() => globalActivityTracker.getSummaryMetrics());
  const [toolCalls, setToolCalls] = useState<ToolCallActivity[]>(() => globalActivityTracker.getToolCalls());
  const [fileReads, setFileReads] = useState<FileReadActivity[]>(() => globalActivityTracker.getFileReads());
  const [pendingDiffs, setPendingDiffs] = useState<PendingDiffActivity[]>(() => globalActivityTracker.getPendingDiffs());
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [expandedReadId, setExpandedReadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [rawFilter, setRawFilter] = useState<'all' | 'tool' | 'edit' | 'error'>('all');

  useEffect(() => {
    const unsubscribe = globalActivityTracker.subscribe(() => {
      setSummaryMetrics(globalActivityTracker.getSummaryMetrics());
      setViewMode(globalActivityTracker.getViewMode());
      setRetentionDays(globalActivityTracker.getRetentionDays());
      setToolCalls(globalActivityTracker.getToolCalls());
      setFileReads(globalActivityTracker.getFileReads());
      setPendingDiffs(globalActivityTracker.getPendingDiffs());
    });
    return unsubscribe;
  }, []);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearAll = () => {
    globalActivityTracker.clearHistory();
    onClearLogs();
  };

  const handleViewModeChange = (mode: 'summary' | 'both') => {
    globalActivityTracker.setViewMode(mode);
    setViewMode(mode);
    if (mode === 'summary') {
      setActiveTab('summary');
    }
  };

  const handleRetentionDaysChange = (days: number) => {
    globalActivityTracker.setRetentionDays(days);
    setRetentionDays(days);
  };

  const pendingCount = pendingDiffs.filter((d) => d.status === 'pending').length;

  return (
    <div id="activity-panel" className="h-full flex flex-col bg-[#1e1e1e] font-sans select-none text-[#cccccc]">
      {/* Header */}
      <div className="h-9 px-3 flex items-center justify-between border-b border-[#333333] bg-[#252526] text-xs">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-neutral-200">AGENT ACTIVITY & DIAGNOSTICS</span>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode pill */}
          <div className="flex items-center rounded bg-[#181818] border border-[#333333] p-0.5 text-[10px]">
            <button
              onClick={() => handleViewModeChange('summary')}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                viewMode === 'summary' ? 'bg-emerald-600 text-white' : 'text-neutral-400 hover:text-white'
              }`}
              title="Show summary view only"
            >
              Summary
            </button>
            <button
              onClick={() => handleViewModeChange('both')}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                viewMode === 'both' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-white'
              }`}
              title="Show summary and detailed tabs"
            >
              Detailed
            </button>
          </div>

          <button
            id="activity-clear-btn"
            onClick={handleClearAll}
            title="Clear all activity history and logs"
            className="p-1 hover:bg-[#383838] rounded text-[#888888] hover:text-white transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Model status bar */}
      <div className="px-3 py-1 bg-[#181818] border-b border-[#2d2d2d] flex items-center justify-between text-[11px] text-[#888888]">
        <div className="flex items-center gap-1.5 font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-neutral-300">{currentModel}</span>
          <span className="text-neutral-500">•</span>
          <span className="text-neutral-400">{summaryMetrics.hardware.totalSizeFormatted}</span>
          <span className="text-emerald-400">({summaryMetrics.hardware.percentVram}% VRAM)</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-neutral-400">
          <span className="font-mono text-amber-400">{summaryMetrics.latestTokensPerSecond ?? 36.8} tok/s</span>
          {currentModel.toLowerCase().includes('qwen') || currentModel.toLowerCase().includes('llama3') ? (
            <span className="text-emerald-400 font-mono">Native Tools API</span>
          ) : (
            <span className="text-amber-400 font-mono">Text Fallback Mode</span>
          )}
        </div>
      </div>

      {/* View Tabs - Shown when viewMode is 'both' or tab is selected */}
      {viewMode === 'both' && (
        <div className="flex items-center border-b border-[#2d2d2d] bg-[#222222] text-xs font-mono">
          <button
            id="tab-summary-btn"
            onClick={() => setActiveTab('summary')}
            className={`flex-1 py-1.5 px-2 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'summary'
                ? 'border-indigo-500 text-white bg-[#2a2a2a]'
                : 'border-transparent text-[#888888] hover:text-white'
            }`}
          >
            <BarChart3 className="w-3 h-3 text-indigo-400" />
            <span>Summary</span>
          </button>

          <button
            id="tab-tools-btn"
            onClick={() => setActiveTab('tools')}
            className={`flex-1 py-1.5 px-2 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'tools'
                ? 'border-emerald-500 text-white bg-[#2a2a2a]'
                : 'border-transparent text-[#888888] hover:text-white'
            }`}
          >
            <Play className="w-3 h-3 text-emerald-400" />
            <span>Tool Calls</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-[#333333] text-neutral-300">
              {toolCalls.length}
            </span>
          </button>

          <button
            id="tab-reads-btn"
            onClick={() => setActiveTab('reads')}
            className={`flex-1 py-1.5 px-2 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'reads'
                ? 'border-blue-500 text-white bg-[#2a2a2a]'
                : 'border-transparent text-[#888888] hover:text-white'
            }`}
          >
            <FileCode2 className="w-3 h-3 text-blue-400" />
            <span>File Reads</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-[#333333] text-neutral-300">
              {fileReads.length}
            </span>
          </button>

          <button
            id="tab-diffs-btn"
            onClick={() => setActiveTab('diffs')}
            className={`flex-1 py-1.5 px-2 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'diffs'
                ? 'border-amber-500 text-white bg-[#2a2a2a]'
                : 'border-transparent text-[#888888] hover:text-white'
            }`}
          >
            <GitCompare className="w-3 h-3 text-amber-400" />
            <span>Pending Diffs</span>
            {pendingCount > 0 ? (
              <span className="text-[10px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {pendingCount}
              </span>
            ) : (
              <span className="text-[10px] px-1 py-0.2 rounded bg-[#333333] text-neutral-300">
                {pendingDiffs.length}
              </span>
            )}
          </button>

          <button
            id="tab-raw-btn"
            onClick={() => setActiveTab('raw')}
            className={`py-1.5 px-2.5 flex items-center justify-center gap-1 border-b-2 transition-colors ${
              activeTab === 'raw'
                ? 'border-cyan-500 text-white bg-[#2a2a2a]'
                : 'border-transparent text-[#888888] hover:text-white'
            }`}
            title="Raw Output Channel"
          >
            <Terminal className="w-3 h-3 text-cyan-400" />
          </button>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* TAB 0: SUMMARY METRICS (Always visible in summary mode, or when selected) */}
        {(activeTab === 'summary' || viewMode === 'summary') && (
          <ActivitySummaryView
            metrics={summaryMetrics}
            viewMode={viewMode}
            retentionDays={retentionDays}
            onChangeViewMode={handleViewModeChange}
            onChangeRetentionDays={handleRetentionDaysChange}
            onClearHistory={handleClearAll}
            onSwitchToTab={(tab) => {
              if (viewMode === 'summary') {
                handleViewModeChange('both');
              }
              setActiveTab(tab);
            }}
          />
        )}

        {/* TAB 1: TOOL CALLS */}
        {viewMode === 'both' && activeTab === 'tools' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2 px-1">
              <div className="relative flex-1">
                <Search className="w-3 h-3 absolute left-2 top-2 text-neutral-500" />
                <input
                  type="text"
                  placeholder="Filter tool invocations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#141414] border border-[#333333] rounded pl-7 pr-2 py-1 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            </div>

            {toolCalls
              .filter(
                (c) =>
                  !searchQuery ||
                  c.toolName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  c.summary.toLowerCase().includes(searchQuery.toLowerCase())
              )
              .map((call) => {
                const isExpanded = expandedToolId === call.id;
                return (
                  <div
                    key={call.id}
                    className="border border-[#333333] bg-[#222222] rounded overflow-hidden text-xs"
                  >
                    <div
                      onClick={() => setExpandedToolId(isExpanded ? null : call.id)}
                      className="p-2 flex items-center justify-between cursor-pointer hover:bg-[#282828] transition-colors"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 font-mono">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        )}
                        <span className="font-semibold text-emerald-400">{call.toolName}</span>
                        <span className="text-neutral-400 truncate max-w-[150px]">{call.summary}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                        <span className="text-neutral-400 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {call.durationMs}ms
                        </span>
                        {call.status === 'success' && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                            OK
                          </span>
                        )}
                        {call.status === 'running' && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-800/40 animate-pulse">
                            RUN
                          </span>
                        )}
                        {call.status === 'error' && (
                          <span className="px-1.5 py-0.5 rounded bg-red-950/60 text-red-400 border border-red-800/40">
                            ERR
                          </span>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="p-2 border-t border-[#2e2e2e] bg-[#1a1a1a] font-mono text-[11px] space-y-2">
                        <div className="flex items-center justify-between text-[10px] text-neutral-400">
                          <span>INVOKED AT {call.timestamp}</span>
                          <button
                            onClick={() => handleCopy(call.id, JSON.stringify(call.args, null, 2))}
                            className="flex items-center gap-1 hover:text-white"
                          >
                            {copiedId === call.id ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            <span>Copy Args</span>
                          </button>
                        </div>

                        <div>
                          <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-0.5">
                            Arguments:
                          </div>
                          <pre className="p-1.5 bg-[#121212] border border-[#2d2d2d] rounded text-emerald-300/90 overflow-x-auto text-[10px]">
                            {JSON.stringify(call.args, null, 2)}
                          </pre>
                        </div>

                        {call.rawOutput && (
                          <div>
                            <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-0.5">
                              Tool Output Preview:
                            </div>
                            <pre className="p-1.5 bg-[#121212] border border-[#2d2d2d] rounded text-neutral-300 overflow-x-auto text-[10px] max-h-32">
                              {call.rawOutput}
                            </pre>
                          </div>
                        )}

                        {call.error && (
                          <div className="p-1.5 bg-red-950/30 border border-red-900/50 rounded text-red-300 text-[11px]">
                            {call.error}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

            {toolCalls.length === 0 && (
              <div className="text-center py-8 text-neutral-500 text-xs font-mono">
                No tool calls logged yet.
                <br />
                Try asking <span className="text-blue-400">@localllm</span> to inspect files or Git.
              </div>
            )}
          </div>
        )}

        {/* TAB 2: FILE READS */}
        {viewMode === 'both' && activeTab === 'reads' && (
          <div className="space-y-2">
            <div className="text-[11px] text-neutral-400 px-1 mb-1 font-mono">
              Files read and ingested as bounded context:
            </div>

            {fileReads.map((read) => {
              const isExpanded = expandedReadId === read.id;
              return (
                <div
                  key={read.id}
                  className="border border-[#333333] bg-[#222222] rounded overflow-hidden text-xs"
                >
                  <div className="p-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0 font-mono">
                      <FileCode2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="font-semibold text-white truncate">{read.path}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {onOpenFile && (
                        <button
                          onClick={() => onOpenFile(read.path)}
                          title="Open in editor"
                          className="px-1.5 py-0.5 rounded bg-[#2e2e2e] hover:bg-[#3a3a3a] text-neutral-300 hover:text-white flex items-center gap-1 text-[10px] font-mono transition-colors"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          <span>View</span>
                        </button>
                      )}
                      <button
                        onClick={() => setExpandedReadId(isExpanded ? null : read.id)}
                        className="text-neutral-400 hover:text-white"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="px-2 pb-2 text-[11px] text-neutral-400 font-mono flex items-center justify-between">
                    <span>
                      {read.startLine ? `Lines ${read.startLine}–${read.endLine || 'end'}` : `${read.lineCount} lines`}
                    </span>
                    <span>
                      {(read.charCount / 1024).toFixed(1)} KB ({read.charCount} chars) • {read.timestamp}
                    </span>
                  </div>

                  {isExpanded && read.snippet && (
                    <div className="p-2 border-t border-[#2e2e2e] bg-[#181818] font-mono text-[10px]">
                      <div className="text-neutral-500 mb-1">Preview snippet:</div>
                      <pre className="p-1.5 bg-[#101010] border border-[#2a2a2a] rounded text-neutral-300 overflow-x-auto">
                        {read.snippet}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}

            {fileReads.length === 0 && (
              <div className="text-center py-8 text-neutral-500 text-xs font-mono">
                No workspace file reads recorded yet.
                <br />
                Model will read files when you ask questions about the project.
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PENDING DIFFS */}
        {viewMode === 'both' && activeTab === 'diffs' && (
          <div className="space-y-3">
            <div className="p-2.5 bg-amber-950/20 border border-amber-800/40 rounded text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-amber-300 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Approval Gate Active</span>
              </div>
              <p className="text-[11px] text-neutral-300 leading-relaxed">
                Edits proposed by the local model must be inspected and approved before touching your workspace files.
              </p>
            </div>

            {pendingDiffs.map((diff) => {
              const isPending = diff.status === 'pending';
              return (
                <div
                  key={diff.id}
                  className={`border rounded overflow-hidden text-xs ${
                    isPending ? 'border-amber-600/60 bg-[#25231e]' : 'border-[#333333] bg-[#222222]'
                  }`}
                >
                  <div className="p-2.5 border-b border-[#333333] flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <GitCompare className="w-3.5 h-3.5 text-amber-400" />
                        <span>{diff.summary || 'Proposed Edit Plan'}</span>
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                        Generated {diff.timestamp} • {diff.files.length} file(s)
                      </div>
                    </div>

                    <div>
                      {isPending ? (
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] border border-amber-500/40">
                          Awaiting Review
                        </span>
                      ) : diff.status === 'applied' ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] border border-emerald-500/40">
                          Applied
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 font-mono text-[10px] border border-red-500/40">
                          Discarded
                        </span>
                      )}
                    </div>
                  </div>

                  {/* File List */}
                  <div className="p-2 space-y-1.5">
                    {diff.files.map((file, idx) => (
                      <div
                        key={idx}
                        className="p-1.5 rounded bg-[#1a1a1a] border border-[#2d2d2d] flex items-center justify-between font-mono text-[11px]"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span
                            className={`px-1 rounded text-[9px] uppercase font-bold ${
                              file.operation === 'create'
                                ? 'bg-emerald-950 text-emerald-400'
                                : file.operation === 'delete'
                                ? 'bg-red-950 text-red-400'
                                : 'bg-amber-950 text-amber-400'
                            }`}
                          >
                            {file.operation}
                          </span>
                          <span className="truncate text-white">{file.path}</span>
                        </div>

                        {file.summary && (
                          <span className="text-[10px] text-neutral-400 truncate max-w-[120px]">
                            {file.summary}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Actions for Pending Diffs */}
                  {isPending && (
                    <div className="p-2 border-t border-[#333333] bg-[#1d1d1d] flex items-center gap-2">
                      {onReviewDiff && (
                        <button
                          id="activity-review-diff-btn"
                          onClick={onReviewDiff}
                          className="flex-1 py-1 px-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center justify-center gap-1 transition-colors"
                        >
                          <GitCompare className="w-3.5 h-3.5" />
                          <span>Review Diff</span>
                        </button>
                      )}
                      {onApplyPendingDiff && (
                        <button
                          id="activity-apply-plan-btn"
                          onClick={onApplyPendingDiff}
                          className="py-1 px-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-1 transition-colors"
                          title="Apply all changes immediately"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Apply</span>
                        </button>
                      )}
                      {onDiscardPendingDiff && (
                        <button
                          id="activity-discard-plan-btn"
                          onClick={onDiscardPendingDiff}
                          className="py-1 px-2 rounded bg-[#333333] hover:bg-[#444444] text-neutral-300 hover:text-white text-xs transition-colors"
                          title="Discard changes"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {pendingDiffs.length === 0 && (
              <div className="text-center py-8 text-neutral-500 text-xs font-mono">
                No pending diffs or edit plans.
                <br />
                Run <span className="text-blue-400">@localllm /edit &lt;request&gt;</span> to generate reviewable diffs!
              </div>
            )}
          </div>
        )}

        {/* TAB 4: RAW LOG */}
        {viewMode === 'both' && activeTab === 'raw' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono mb-2">
              <select
                value={rawFilter}
                onChange={(e) => setRawFilter(e.target.value as any)}
                className="bg-[#181818] border border-[#333333] rounded px-2 py-1 text-xs text-white focus:outline-none"
              >
                <option value="all">All Logs ({logs.length})</option>
                <option value="tool">Tools Only</option>
                <option value="edit">Edits Only</option>
                <option value="error">Errors Only</option>
              </select>

              <button
                onClick={() => {
                  const text = logs.map((l) => `[${l.timestamp}] ${l.message}`).join('\n');
                  handleCopy('raw-logs', text);
                }}
                className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white"
              >
                {copiedId === 'raw-logs' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>Copy Output</span>
              </button>
            </div>

            <div className="font-mono text-[11px] leading-relaxed space-y-1">
              {logs
                .filter((l) => rawFilter === 'all' || l.type === rawFilter)
                .map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex items-start gap-1.5 px-1 py-0.5 rounded ${
                      entry.type === 'error'
                        ? 'text-red-400 bg-red-950/20'
                        : entry.type === 'tool'
                        ? 'text-cyan-400'
                        : entry.type === 'edit'
                        ? 'text-amber-400'
                        : 'text-[#cccccc]'
                    }`}
                  >
                    <span className="text-[#666666] shrink-0">[{entry.timestamp}]</span>
                    <span className="break-all">{entry.message}</span>
                  </div>
                ))}

              {logs.length === 0 && (
                <div className="text-center py-6 text-neutral-500 text-xs">
                  No raw log entries recorded yet.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-[#2d2d2d] bg-[#181818] text-[10px] text-[#777777] flex items-center justify-between font-mono">
        <span>Diagnostic Channel</span>
        <span>Bounded Context v1.4</span>
      </div>
    </div>
  );
};
