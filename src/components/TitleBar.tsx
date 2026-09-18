import React from 'react';
import {
  Terminal,
  RefreshCw,
  Server,
  Zap,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Download
} from 'lucide-react';

interface TitleBarProps {
  model: string;
  models: string[];
  onSelectModel: (model: string) => void;
  isSimulated: boolean;
  onToggleSimulated: () => void;
  onRefreshConnection: () => void;
  isCheckingConnection: boolean;
  connectionError?: string;
  onResetWorkspace: () => void;
  onOpenLogs: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  model,
  models,
  onSelectModel,
  isSimulated,
  onToggleSimulated,
  onRefreshConnection,
  isCheckingConnection,
  connectionError,
  onResetWorkspace,
  onOpenLogs,
}) => {
  return (
    <header
      id="vscode-titlebar"
      className="h-10 bg-[#323233] border-b border-[#252526] flex items-center justify-between px-3 text-xs text-[#cccccc] select-none z-20 shrink-0"
    >
      <div className="flex items-center gap-2">
        <span className="text-base" role="img" aria-label="llama">🦙</span>
        <span className="font-semibold text-white tracking-wide">Local Ollama Chat</span>
        <span className="text-[11px] text-[#858585] hidden sm:inline">| VS Code Extension Studio</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Model Selector */}
        <div className="flex items-center gap-1.5 bg-[#252526] px-2.5 py-1 rounded border border-[#3c3c3c]">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[#999999] text-[11px]">Model:</span>
          <select
            id="model-selector-dropdown"
            value={model}
            onChange={(e) => onSelectModel(e.target.value)}
            className="bg-transparent text-white font-mono text-[11px] focus:outline-none cursor-pointer"
          >
            {models.map((m) => (
              <option key={m} value={m} className="bg-[#252526] text-white">
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Connection status badge */}
        <button
          id="toggle-sim-button"
          onClick={onToggleSimulated}
          title={isSimulated ? "Using built-in Ollama simulator (ideal for sandbox/offline)" : "Connected to live Ollama server"}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] transition-colors ${
            isSimulated
              ? 'bg-amber-950/40 border-amber-600/50 text-amber-300 hover:bg-amber-900/50'
              : 'bg-emerald-950/40 border-emerald-600/50 text-emerald-300 hover:bg-emerald-900/50'
          }`}
        >
          {isSimulated ? (
            <>
              <Zap className="w-3 h-3 text-amber-400" />
              <span>Simulator Mode</span>
            </>
          ) : (
            <>
              <Server className="w-3 h-3 text-emerald-400" />
              <span>Live Ollama</span>
            </>
          )}
        </button>

        {/* Refresh probe button */}
        <button
          id="refresh-connection-button"
          onClick={onRefreshConnection}
          disabled={isCheckingConnection}
          title="Probe Ollama connection (default: http://localhost:11434)"
          className="p-1 hover:bg-[#3c3c3c] text-[#cccccc] hover:text-white rounded transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isCheckingConnection ? 'animate-spin text-blue-400' : ''}`} />
        </button>

        <div className="h-4 w-px bg-[#3c3c3c]" />

        {/* Activity log toggle */}
        <button
          id="titlebar-open-logs-btn"
          onClick={onOpenLogs}
          title="Open Activity Log (Output Channel)"
          className="flex items-center gap-1 hover:bg-[#3c3c3c] px-2 py-1 rounded text-[#cccccc] hover:text-white transition-colors"
        >
          <Terminal className="w-3.5 h-3.5 text-blue-400" />
          <span className="hidden md:inline">Output</span>
        </button>

        {/* Reset workspace button */}
        <button
          id="titlebar-reset-workspace-btn"
          onClick={onResetWorkspace}
          title="Reset workspace files to initial sample state"
          className="flex items-center gap-1 hover:bg-[#3c3c3c] px-2 py-1 rounded text-[#a0a0a0] hover:text-white transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5 text-neutral-400" />
          <span className="hidden md:inline">Reset Code</span>
        </button>

        {/* Download VSIX button */}
        <a
          id="titlebar-download-vsix-btn"
          href="/local-ollama-1.4.0.vsix"
          download="local-ollama-1.4.0.vsix"
          title="Download Local Ollama v1.4.0 VS Code extension package (.vsix)"
          className="flex items-center gap-1.5 bg-[#007acc] hover:bg-[#0062a3] text-white px-2.5 py-1 rounded text-xs font-medium transition-colors shadow-sm ml-1"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download .VSIX v1.4.0</span>
        </a>
      </div>
    </header>
  );
};
