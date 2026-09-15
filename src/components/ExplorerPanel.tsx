import React, { useState } from 'react';
import {
  FileCode,
  FileText,
  FileJson,
  Folder,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Search,
  Check
} from 'lucide-react';
import { WorkspaceFileEntry } from '../web/WebWorkspace';

interface ExplorerPanelProps {
  files: WorkspaceFileEntry[];
  activeFile: string;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string, content?: string) => void;
  onDeleteFile: (path: string) => void;
}

export const ExplorerPanel: React.FC<ExplorerPanelProps> = ({
  files,
  activeFile,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
}) => {
  const [filter, setFilter] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');

  const getFileIcon = (path: string) => {
    if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js')) {
      return <FileCode className="w-4 h-4 text-blue-400 shrink-0" />;
    }
    if (path.endsWith('.json')) {
      return <FileJson className="w-4 h-4 text-amber-400 shrink-0" />;
    }
    if (path.endsWith('.md')) {
      return <FileText className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    return <FileText className="w-4 h-4 text-neutral-400 shrink-0" />;
  };

  const filteredFiles = files.filter((f) =>
    f.path.toLowerCase().includes(filter.toLowerCase())
  );

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFilePath.trim()) {
      onCreateFile(newFilePath.trim(), '// New file created in workspace\n');
      setNewFilePath('');
      setIsCreating(false);
    }
  };

  return (
    <div id="explorer-sidebar-panel" className="h-full flex flex-col bg-[#252526] select-none">
      {/* Header */}
      <div className="h-9 px-4 flex items-center justify-between border-b border-[#333333] text-[11px] font-bold uppercase tracking-wider text-[#bbbbbb]">
        <span>Explorer: Workspace</span>
        <button
          id="explorer-new-file-btn"
          onClick={() => setIsCreating(true)}
          title="New File"
          className="p-1 hover:bg-[#383838] rounded text-[#cccccc] hover:text-white"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter search bar */}
      <div className="p-2 border-b border-[#333333]">
        <div className="relative flex items-center bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2 py-1 text-xs">
          <Search className="w-3.5 h-3.5 text-[#858585] mr-1.5 shrink-0" />
          <input
            id="explorer-filter-input"
            type="text"
            placeholder="Filter files..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-transparent text-[#cccccc] placeholder-[#666666] focus:outline-none text-xs"
          />
        </div>
      </div>

      {/* New file inline form */}
      {isCreating && (
        <form onSubmit={handleCreateSubmit} className="p-2 border-b border-[#333333] bg-[#2d2d2d]">
          <div className="flex items-center gap-1">
            <input
              id="explorer-new-file-input"
              type="text"
              autoFocus
              placeholder="e.g. src/services/Logger.ts"
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              className="flex-1 bg-[#1e1e1e] border border-blue-500 rounded px-2 py-1 text-xs text-white focus:outline-none"
            />
            <button
              type="submit"
              className="p-1 bg-blue-600 hover:bg-blue-500 text-white rounded"
              title="Confirm"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="p-1 bg-[#3c3c3c] hover:bg-[#4a4a4a] text-neutral-300 rounded text-[10px]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* File Tree List */}
      <div className="flex-1 overflow-y-auto py-1">
        <div className="px-3 py-1 flex items-center gap-1 text-[11px] font-semibold text-[#858585]">
          <ChevronDown className="w-3.5 h-3.5" />
          <span>PROJECT ROOT ({filteredFiles.length})</span>
        </div>

        <div className="flex flex-col">
          {filteredFiles.map((file) => {
            const isSelected = file.path === activeFile;
            return (
              <div
                key={file.path}
                id={`file-item-${file.path.replace(/[/.]/g, '-')}`}
                onClick={() => onSelectFile(file.path)}
                className={`group flex items-center justify-between px-4 py-1.5 cursor-pointer text-xs transition-colors ${
                  isSelected
                    ? 'bg-[#37373d] text-white font-medium'
                    : 'text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2 truncate pr-1">
                  {getFileIcon(file.path)}
                  <span className="truncate">{file.path}</span>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete ${file.path}?`)) {
                      onDeleteFile(file.path);
                    }
                  }}
                  title="Delete file"
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-neutral-400 rounded transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {filteredFiles.length === 0 && (
            <div className="px-4 py-3 text-xs text-[#858585] text-center">
              No files match "{filter}"
            </div>
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="p-2 border-t border-[#333333] text-[10px] text-[#858585] bg-[#1e1e1e]/40">
        Bounded workspace tools examine these files in real-time.
      </div>
    </div>
  );
};
