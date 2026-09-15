import React, { useState, useEffect } from 'react';
import { FileCode, Save, Sparkles, X, Check } from 'lucide-react';

interface EditorAreaProps {
  activeFilePath: string;
  fileContent: string;
  openTabs: string[];
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSaveFile: (path: string, content: string) => void;
  onAskAboutFile: (path: string) => void;
}

export const EditorArea: React.FC<EditorAreaProps> = ({
  activeFilePath,
  fileContent,
  openTabs,
  onSelectTab,
  onCloseTab,
  onSaveFile,
  onAskAboutFile,
}) => {
  const [currentText, setCurrentText] = useState(fileContent);
  const [isDirty, setIsDirty] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    setCurrentText(fileContent);
    setIsDirty(false);
  }, [fileContent, activeFilePath]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentText(e.target.value);
    setIsDirty(e.target.value !== fileContent);
  };

  const handleSave = () => {
    onSaveFile(activeFilePath, currentText);
    setIsDirty(false);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 1500);
  };

  const lines = currentText.split('\n');

  return (
    <div id="editor-area" className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden select-none">
      {/* Tabs bar */}
      <div className="h-9 bg-[#252526] flex items-center overflow-x-auto border-b border-[#1e1e1e] scrollbar-none">
        {openTabs.map((tab) => {
          const isActive = tab === activeFilePath;
          const fileName = tab.split('/').pop() || tab;
          return (
            <div
              key={tab}
              id={`tab-${tab.replace(/[/.]/g, '-')}`}
              onClick={() => onSelectTab(tab)}
              className={`group h-full flex items-center gap-2 px-3 border-r border-[#1e1e1e] cursor-pointer text-xs transition-colors shrink-0 ${
                isActive
                  ? 'bg-[#1e1e1e] text-white border-t-2 border-t-blue-500 font-medium'
                  : 'bg-[#2d2d2d] text-[#999999] hover:bg-[#333333] hover:text-[#cccccc]'
              }`}
            >
              <FileCode className={`w-3.5 h-3.5 ${isActive ? 'text-blue-400' : 'text-neutral-500'}`} />
              <span className="truncate max-w-[140px]">{fileName}</span>
              {isActive && isDirty && (
                <span className="w-2 h-2 rounded-full bg-white ml-0.5 shrink-0" title="Unsaved changes" />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab);
                }}
                className="p-0.5 hover:bg-[#444444] rounded text-neutral-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Editor sub-header / breadcrumb */}
      <div className="h-7 px-4 flex items-center justify-between bg-[#1e1e1e] border-b border-[#2d2d2d] text-[11px] text-[#858585]">
        <div className="flex items-center gap-1">
          <span>workspace</span>
          <span>&gt;</span>
          <span className="text-white font-mono">{activeFilePath}</span>
          {isDirty && <span className="text-amber-400 ml-2 font-sans font-medium">(unsaved)</span>}
        </div>

        <div className="flex items-center gap-2">
          <button
            id="editor-ask-ollama-btn"
            onClick={() => onAskAboutFile(activeFilePath)}
            title="Prompt Ollama to explain or refactor this file"
            className="flex items-center gap-1 hover:bg-[#2d2d2d] text-blue-400 hover:text-blue-300 px-2 py-0.5 rounded transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            <span>Ask @local-ollama</span>
          </button>

          <button
            id="editor-save-btn"
            onClick={handleSave}
            disabled={!isDirty}
            className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-xs transition-colors ${
              savedSuccess
                ? 'bg-emerald-700 text-white'
                : isDirty
                ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                : 'bg-transparent text-[#555555] cursor-default'
            }`}
          >
            {savedSuccess ? (
              <>
                <Check className="w-3 h-3" />
                <span>Saved</span>
              </>
            ) : (
              <>
                <Save className="w-3 h-3" />
                <span>Save</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Textarea with line numbers */}
      <div className="flex-1 flex overflow-hidden font-mono text-xs">
        {/* Line numbers gutter */}
        <div className="w-12 bg-[#1e1e1e] text-[#555555] py-2 px-2 text-right select-none border-r border-[#282828] shrink-0 overflow-hidden">
          {lines.map((_, i) => (
            <div key={i} className="leading-5 h-5 text-[11px]">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Editable code text area */}
        <textarea
          id="editor-code-textarea"
          value={currentText}
          onChange={handleTextChange}
          spellCheck={false}
          className="flex-1 bg-[#1e1e1e] text-[#d4d4d4] p-2 leading-5 focus:outline-none resize-none select-text whitespace-pre overflow-auto font-mono text-xs"
        />
      </div>
    </div>
  );
};
