import React, { useState } from 'react';
import { Terminal, Trash2, Filter, Copy, Check } from 'lucide-react';
import { LogEntry } from '../web/WebLogger';

interface LogsPanelProps {
  logs: LogEntry[];
  onClearLogs: () => void;
}

export const LogsPanel: React.FC<LogsPanelProps> = ({ logs, onClearLogs }) => {
  const [filter, setFilter] = useState<'all' | 'tool' | 'edit' | 'error'>('all');
  const [copied, setCopied] = useState(false);

  const filteredLogs = logs.filter((l) => {
    if (filter === 'all') return true;
    return l.type === filter;
  });

  const handleCopy = () => {
    const text = filteredLogs.map((l) => `[${l.timestamp}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getTypeStyle = (type: LogEntry['type']) => {
    switch (type) {
      case 'error':
        return 'text-red-400 bg-red-950/20';
      case 'tool':
        return 'text-cyan-400';
      case 'edit':
        return 'text-amber-400';
      case 'warn':
        return 'text-yellow-400';
      default:
        return 'text-[#cccccc]';
    }
  };

  return (
    <div id="logs-sidebar-panel" className="h-full flex flex-col bg-[#1e1e1e] font-mono select-none">
      {/* Header */}
      <div className="h-9 px-3 flex items-center justify-between border-b border-[#333333] bg-[#252526] text-xs">
        <div className="flex items-center gap-1.5 text-neutral-300 font-sans font-semibold">
          <Terminal className="w-4 h-4 text-blue-400" />
          <span>OUTPUT: Local Ollama</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Filter dropdown */}
          <select
            id="logs-filter-dropdown"
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="bg-[#1e1e1e] text-[#cccccc] text-[10px] border border-[#3c3c3c] rounded px-1.5 py-0.5 focus:outline-none"
          >
            <option value="all">All Logs ({logs.length})</option>
            <option value="tool">Tools Only</option>
            <option value="edit">Edits Only</option>
            <option value="error">Errors Only</option>
          </select>

          {/* Copy button */}
          <button
            id="logs-copy-btn"
            onClick={handleCopy}
            title="Copy Logs to Clipboard"
            className="p-1 hover:bg-[#383838] rounded text-[#cccccc] hover:text-white"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Clear button */}
          <button
            id="logs-clear-btn"
            onClick={onClearLogs}
            title="Clear Output"
            className="p-1 hover:bg-[#383838] rounded text-[#cccccc] hover:text-white"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Log items container */}
      <div className="flex-1 overflow-y-auto p-2 text-[11px] leading-relaxed space-y-1 select-text">
        {filteredLogs.map((entry) => (
          <div key={entry.id} className={`flex items-start gap-2 px-1 py-0.5 rounded ${getTypeStyle(entry.type)}`}>
            <span className="text-[#666666] shrink-0">[{entry.timestamp}]</span>
            <span className="break-all">{entry.message}</span>
          </div>
        ))}

        {filteredLogs.length === 0 && (
          <div className="text-[#666666] text-center py-6 font-sans text-xs">
            No activity log entries yet. Send a chat request to inspect real-time execution!
          </div>
        )}
      </div>

      {/* Footer metadata */}
      <div className="px-3 py-1.5 border-t border-[#2d2d2d] bg-[#181818] text-[10px] text-[#777777] flex items-center justify-between">
        <span>Channel: Local Ollama Extension</span>
        <span>Storage: memory/activity.log</span>
      </div>
    </div>
  );
};
