import React from 'react';
import { Sparkles, Terminal, Shield, Check, Cpu } from 'lucide-react';

interface StatusBarProps {
  model: string;
  isSimulated: boolean;
  activeFilePath: string;
  fileCount: number;
  maxToolCalls: number;
  onOpenLogs: () => void;
  onSelectModel: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  model,
  isSimulated,
  activeFilePath,
  fileCount,
  maxToolCalls,
  onOpenLogs,
  onSelectModel,
}) => {
  return (
    <footer
      id="vscode-statusbar"
      className="h-6 bg-[#007acc] text-white flex items-center justify-between px-3 text-[11px] select-none shrink-0 z-20"
    >
      <div className="flex items-center gap-3">
        {/* Ollama badge */}
        <button
          id="statusbar-model-button"
          onClick={onSelectModel}
          className="flex items-center gap-1.5 hover:bg-black/20 px-1.5 py-0.5 rounded transition-colors font-medium"
        >
          <Sparkles className="w-3 h-3 text-amber-300" />
          <span>Ollama: {model}</span>
        </button>

        <span className="opacity-60">|</span>

        {/* Mode badge */}
        <span className="flex items-center gap-1 opacity-90">
          <Cpu className="w-3 h-3" />
          <span>{isSimulated ? 'Simulator Mode' : 'Connected'}</span>
        </span>

        <span className="opacity-60">|</span>

        {/* Workspace info */}
        <span className="hidden sm:inline opacity-90">
          Workspace: {fileCount} files
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Max tool call budget */}
        <span className="hidden md:inline opacity-80" title="Workspace exploration budget">
          Tool Budget: {maxToolCalls} ops
        </span>

        {/* Output Channel link */}
        <button
          id="statusbar-logs-button"
          onClick={onOpenLogs}
          className="flex items-center gap-1 hover:bg-black/20 px-1.5 py-0.5 rounded transition-colors"
        >
          <Terminal className="w-3 h-3" />
          <span>Output</span>
        </button>

        {/* Active file encoding / type */}
        <span className="font-mono text-[10px] bg-black/20 px-1.5 py-0.5 rounded">
          {activeFilePath.split('.').pop()?.toUpperCase() || 'TXT'}
        </span>
      </div>
    </footer>
  );
};
