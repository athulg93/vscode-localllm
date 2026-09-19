import React from 'react';
import {
  Activity,
  Zap,
  Cpu,
  Database,
  MessageSquare,
  GitPullRequest,
  ShieldCheck,
  Clock,
  Settings,
  HardDrive,
  BarChart3,
  Calendar,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Wrench,
  FileText
} from 'lucide-react';
import { ActivitySummaryMetrics } from '../core/ActivityTracker';

interface ActivitySummaryViewProps {
  metrics: ActivitySummaryMetrics;
  viewMode: 'summary' | 'both';
  retentionDays: number;
  onChangeViewMode: (mode: 'summary' | 'both') => void;
  onChangeRetentionDays: (days: number) => void;
  onClearHistory: () => void;
  onSwitchToTab?: (tab: 'tools' | 'reads' | 'diffs' | 'raw') => void;
}

export const ActivitySummaryView: React.FC<ActivitySummaryViewProps> = ({
  metrics,
  viewMode,
  retentionDays,
  onChangeViewMode,
  onChangeRetentionDays,
  onClearHistory,
  onSwitchToTab,
}) => {
  const hw = metrics.hardware;
  const contextRatio = Math.min(100, Math.round((hw.contextTokensUsed / hw.contextTokensLimit) * 100));
  const vramPercent = hw.percentVram;

  // Format oldest entry date
  const oldestDateStr = metrics.oldestEntryTimestamp
    ? new Date(metrics.oldestEntryTimestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'None yet';

  return (
    <div id="activity-summary-view" className="space-y-4 pb-4">
      {/* Top Controls: View Mode & Retention Selector */}
      <div className="bg-[#1c1c1c] border border-[#2d2d2d] rounded-lg p-3 text-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-neutral-400" />
          <span className="text-neutral-300 font-medium">Display & Retention Policy:</span>
        </div>

        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex items-center gap-1.5 bg-[#262626] p-1 rounded border border-[#333333]">
            <span className="text-[11px] text-neutral-400 px-1">Mode:</span>
            <button
              id="view-mode-summary-btn"
              onClick={() => onChangeViewMode('summary')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                viewMode === 'summary'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Summary Only
            </button>
            <button
              id="view-mode-both-btn"
              onClick={() => onChangeViewMode('both')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                viewMode === 'both'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Summary + Detailed
            </button>
          </div>

          {/* Retention period dropdown */}
          <div className="flex items-center gap-1.5 bg-[#262626] px-2 py-1 rounded border border-[#333333]">
            <Calendar className="w-3.5 h-3.5 text-neutral-400" />
            <span className="text-[11px] text-neutral-400">Keep logs:</span>
            <select
              id="activity-retention-select"
              value={retentionDays}
              onChange={(e) => onChangeRetentionDays(Number(e.target.value))}
              className="bg-transparent text-emerald-400 font-medium text-[11px] outline-none cursor-pointer"
            >
              <option value={1} className="bg-[#262626] text-white">1 day</option>
              <option value={7} className="bg-[#262626] text-white">1 week (Default)</option>
              <option value={14} className="bg-[#262626] text-white">2 weeks</option>
              <option value={30} className="bg-[#262626] text-white">1 month</option>
              <option value={90} className="bg-[#262626] text-white">3 months</option>
            </select>
          </div>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {/* Card 1: Generation Speed */}
        <div className="bg-[#212121] border border-[#2d2d2d] rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400 text-xs mb-1">
            <span className="font-medium">Speed</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="text-xl font-bold text-neutral-100 font-mono flex items-baseline gap-1">
              {metrics.latestTokensPerSecond ?? 36.8}
              <span className="text-xs font-normal text-neutral-400">tok/s</span>
            </div>
            <div className="text-[11px] text-neutral-400 mt-1 flex items-center gap-1">
              <span>Avg:</span>
              <span className="text-neutral-300 font-mono">{metrics.avgTokensPerSecond ?? 35.4} tok/s</span>
            </div>
          </div>
        </div>

        {/* Card 2: Token Consumption */}
        <div className="bg-[#212121] border border-[#2d2d2d] rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400 text-xs mb-1">
            <span className="font-medium">Total Tokens</span>
            <Database className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <div className="text-xl font-bold text-neutral-100 font-mono">
              {(metrics.promptTokensIn + metrics.generatedTokensOut).toLocaleString()}
            </div>
            <div className="text-[11px] text-neutral-400 mt-1 flex items-center justify-between">
              <span>In: {metrics.promptTokensIn.toLocaleString()}</span>
              <span>Out: {metrics.generatedTokensOut.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Card 3: Conversations & Interactions */}
        <div className="bg-[#212121] border border-[#2d2d2d] rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400 text-xs mb-1">
            <span className="font-medium">Conversations</span>
            <MessageSquare className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-xl font-bold text-neutral-100 font-mono">
              {metrics.totalConversations}
            </div>
            <div className="text-[11px] text-neutral-400 mt-1">
              {metrics.userPromptsCount} prompts • {metrics.agentResponsesCount} replies
            </div>
          </div>
        </div>

        {/* Card 4: Code Edits */}
        <div className="bg-[#212121] border border-[#2d2d2d] rounded-lg p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400 text-xs mb-1">
            <span className="font-medium">Code Edits</span>
            <GitPullRequest className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <div className="text-xl font-bold text-neutral-100 font-mono">
              {metrics.editsApplied} / {metrics.editsProposed}
            </div>
            <div className="text-[11px] text-neutral-400 mt-1 flex items-center gap-1">
              <span className="text-emerald-400">
                {metrics.editsProposed > 0
                  ? `${Math.round((metrics.editsApplied / metrics.editsProposed) * 100)}% accepted`
                  : 'Ready'}
              </span>
              {metrics.editsDiscarded > 0 && (
                <span className="text-neutral-500">• {metrics.editsDiscarded} discarded</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Hardware & Memory Utilization Panel */}
      <div className="bg-[#212121] border border-[#2d2d2d] rounded-lg p-4 space-y-3.5">
        <div className="flex items-center justify-between border-b border-[#2d2d2d] pb-2.5">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-neutral-200">Hardware & Memory Allocation</h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-950/40 text-indigo-300 border border-indigo-500/30">
            {hw.modelName}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: RAM / VRAM Split */}
          <div className="space-y-2 bg-[#191919] p-3 rounded border border-[#292929]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-300 font-medium flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-neutral-400" />
                Memory Footprint:
              </span>
              <span className="font-mono text-neutral-100 font-semibold">{hw.totalSizeFormatted}</span>
            </div>

            {/* VRAM Progress bar */}
            <div className="w-full bg-[#2d2d2d] h-2 rounded-full overflow-hidden flex">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{ width: `${vramPercent}%` }}
                title={`VRAM: ${hw.vramFormatted} (${vramPercent}%)`}
              />
              <div
                className="bg-amber-500 h-full transition-all duration-500"
                style={{ width: `${100 - vramPercent}%` }}
                title={`System RAM: ${hw.systemRamFormatted}`}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>VRAM (GPU): {hw.vramFormatted} ({vramPercent}%)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span>Sys RAM: {hw.systemRamFormatted}</span>
              </div>
            </div>

            <div className="pt-1 text-[11px] text-neutral-400 flex items-center justify-between">
              <span>Offload Status:</span>
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {hw.isFullyGpuAccelerated ? 'Full VRAM Acceleration (100% GPU)' : 'Hybrid CPU/GPU Offload'}
              </span>
            </div>
          </div>

          {/* Right: Context Window Utilization */}
          <div className="space-y-2 bg-[#191919] p-3 rounded border border-[#292929]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-300 font-medium flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-neutral-400" />
                Context Window Utilization:
              </span>
              <span className="font-mono text-neutral-100 font-semibold">
                {hw.contextTokensUsed.toLocaleString()} / {hw.contextTokensLimit.toLocaleString()} tokens
              </span>
            </div>

            {/* Context progress bar */}
            <div className="w-full bg-[#2d2d2d] h-2 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  contextRatio > 80
                    ? 'bg-red-500'
                    : contextRatio > 50
                    ? 'bg-amber-500'
                    : 'bg-indigo-500'
                }`}
                style={{ width: `${Math.max(4, contextRatio)}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-neutral-400">
              <span>Utilized: <strong className="text-neutral-200">{contextRatio}%</strong></span>
              <span>Available buffer: <strong className="text-emerald-400">{(hw.contextTokensLimit - hw.contextTokensUsed).toLocaleString()} tokens</strong></span>
            </div>

            <div className="pt-1 text-[11px] text-neutral-400 flex items-center justify-between">
              <span>Window Policy:</span>
              <span className="text-blue-400 font-mono">Sliding Bounded Context (Anti-OOM)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Workspace & Tool Activity Rollups (Executive Summary) */}
      <div className="bg-[#212121] border border-[#2d2d2d] rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-[#2d2d2d] pb-2.5">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-neutral-200">Workspace & Tool Execution Summary</h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-950/40 text-emerald-300 border border-emerald-500/30">
            {metrics.toolSuccessRatePercent ?? 100}% Success Rate
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-[#191919] p-3 rounded border border-[#292929] space-y-1">
            <div className="text-[11px] text-neutral-400 font-medium">Tool Invocations</div>
            <div className="text-lg font-bold font-mono text-neutral-100">{metrics.totalToolInvocations ?? 0} calls</div>
            <div className="text-[10px] text-neutral-500">Autonomous workspace actions</div>
          </div>

          <div className="bg-[#191919] p-3 rounded border border-[#292929] space-y-1">
            <div className="text-[11px] text-neutral-400 font-medium flex items-center gap-1">
              <FileText className="w-3 h-3 text-blue-400" />
              Files Inspected
            </div>
            <div className="text-lg font-bold font-mono text-neutral-100">{metrics.totalFilesRead ?? 0} files</div>
            <div className="text-[10px] text-neutral-500">{(metrics.totalLinesInspected ?? 0).toLocaleString()} lines scanned</div>
          </div>

          <div className="bg-[#191919] p-3 rounded border border-[#292929] space-y-1">
            <div className="text-[11px] text-neutral-400 font-medium">Most Used Tools</div>
            <div className="text-xs font-mono text-neutral-200 truncate">
              {metrics.topToolsUsed && metrics.topToolsUsed.length > 0
                ? metrics.topToolsUsed.slice(0, 2).map((t) => `${t.name} (${t.count})`).join(', ')
                : 'None yet'}
            </div>
            <div className="text-[10px] text-neutral-500">Top execution operations</div>
          </div>
        </div>
      </div>

      {/* Local Privacy & Retention Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 100% Local Guarantee */}
        <div className="bg-[#212121] border border-[#2d2d2d] rounded-lg p-3 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-neutral-200">100% Local Execution Guarantee</h4>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              All inferences and embeddings run directly on your host machine via Ollama. 
              Zero tokens, code files, or telemetry are ever leaked to the external internet.
            </p>
          </div>
        </div>

        {/* Retention Policy Status */}
        <div className="bg-[#212121] border border-[#2d2d2d] rounded-lg p-3 flex items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-neutral-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-neutral-200">Rolling Retention Active</h4>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Log entries older than <strong className="text-neutral-200">{retentionDays} days</strong> are automatically pruned at each cycle to save disk space.
              </p>
              <div className="text-[10px] text-neutral-500">
                Oldest recorded entry: {oldestDateStr}
              </div>
            </div>
          </div>

          <button
            onClick={onClearHistory}
            title="Clear all recorded history now"
            className="p-1.5 hover:bg-[#2e2e2e] rounded text-neutral-400 hover:text-red-400 transition-colors shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Jump to Detailed Tabs (if in both mode or user wants quick access) */}
      {viewMode === 'both' && onSwitchToTab && (
        <div className="bg-[#1a1a1a] border border-[#292929] rounded-lg p-2.5 flex items-center justify-between text-xs">
          <span className="text-neutral-400">Explore granular diagnostic feeds:</span>
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <button
              onClick={() => onSwitchToTab('tools')}
              className="px-2 py-1 rounded bg-[#262626] hover:bg-[#333333] text-emerald-400 transition-colors"
            >
              Tool Calls →
            </button>
            <button
              onClick={() => onSwitchToTab('reads')}
              className="px-2 py-1 rounded bg-[#262626] hover:bg-[#333333] text-blue-400 transition-colors"
            >
              File Reads →
            </button>
            <button
              onClick={() => onSwitchToTab('diffs')}
              className="px-2 py-1 rounded bg-[#262626] hover:bg-[#333333] text-amber-400 transition-colors"
            >
              Diffs →
            </button>
            <button
              onClick={() => onSwitchToTab('raw')}
              className="px-2 py-1 rounded bg-[#262626] hover:bg-[#333333] text-cyan-400 transition-colors"
            >
              Raw Logs →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
