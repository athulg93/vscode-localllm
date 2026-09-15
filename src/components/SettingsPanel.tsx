import React from 'react';
import { Settings, Save, CheckCircle, RefreshCw, Sliders } from 'lucide-react';

export interface ExtensionSettings {
  baseUrl: string;
  defaultModel: string;
  temperature: number;
  autoCreateDirectories: boolean;
  maxToolCalls: number;
}

interface SettingsPanelProps {
  settings: ExtensionSettings;
  onUpdateSettings: (newSettings: ExtensionSettings) => void;
  onTestConnection: () => void;
  isTesting: boolean;
  models: string[];
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onUpdateSettings,
  onTestConnection,
  isTesting,
  models,
}) => {
  const handleChange = <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  return (
    <div id="settings-sidebar-panel" className="h-full flex flex-col bg-[#252526] select-none text-xs text-[#cccccc]">
      {/* Header */}
      <div className="h-9 px-4 flex items-center justify-between border-b border-[#333333] text-[11px] font-bold uppercase tracking-wider text-[#bbbbbb]">
        <div className="flex items-center gap-1.5">
          <Sliders className="w-4 h-4 text-blue-400" />
          <span>Settings: Local Ollama</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Base URL */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-white">
            localOllama.baseUrl
          </label>
          <p className="text-[11px] text-[#858585]">
            Base URL for your local Ollama instance (default: http://localhost:11434).
          </p>
          <div className="flex gap-2">
            <input
              id="settings-base-url-input"
              type="text"
              value={settings.baseUrl}
              onChange={(e) => handleChange('baseUrl', e.target.value)}
              className="flex-1 bg-[#1e1e1e] border border-[#3c3c3c] focus:border-blue-500 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none"
            />
            <button
              id="settings-test-connection-btn"
              onClick={onTestConnection}
              disabled={isTesting}
              className="bg-[#3c3c3c] hover:bg-[#484848] text-white px-2.5 py-1.5 rounded flex items-center gap-1 text-xs shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
              <span>Test</span>
            </button>
          </div>
        </div>

        {/* Default Model */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-white">
            localOllama.defaultModel
          </label>
          <p className="text-[11px] text-[#858585]">
            Default local model to use for chat prompts and edit generation.
          </p>
          <select
            id="settings-default-model-select"
            value={settings.defaultModel}
            onChange={(e) => handleChange('defaultModel', e.target.value)}
            className="w-full bg-[#1e1e1e] border border-[#3c3c3c] focus:border-blue-500 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none font-mono"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Temperature */}
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <label className="text-xs font-semibold text-white">
              localOllama.temperature
            </label>
            <span className="font-mono text-blue-400">{settings.temperature}</span>
          </div>
          <p className="text-[11px] text-[#858585]">
            Temperature passed to Ollama generation requests (0 = deterministic, 1 = creative).
          </p>
          <input
            id="settings-temperature-range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.temperature}
            onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
            className="w-full accent-blue-500 cursor-pointer"
          />
        </div>

        {/* Max Tool Calls */}
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <label className="text-xs font-semibold text-white">
              localOllama.maxToolCalls
            </label>
            <span className="font-mono text-blue-400">{settings.maxToolCalls}</span>
          </div>
          <p className="text-[11px] text-[#858585]">
            Maximum workspace exploration operations allowed for one chat request (4–40).
          </p>
          <input
            id="settings-max-tools-range"
            type="range"
            min={4}
            max={40}
            step={1}
            value={settings.maxToolCalls}
            onChange={(e) => handleChange('maxToolCalls', parseInt(e.target.value, 10))}
            className="w-full accent-blue-500 cursor-pointer"
          />
        </div>

        {/* Auto Create Directories */}
        <div className="flex items-start gap-2 pt-2 border-t border-[#333333]">
          <input
            id="settings-auto-create-dirs"
            type="checkbox"
            checked={settings.autoCreateDirectories}
            onChange={(e) => handleChange('autoCreateDirectories', e.target.checked)}
            className="mt-0.5 accent-blue-500 rounded cursor-pointer"
          />
          <div>
            <label htmlFor="settings-auto-create-dirs" className="font-semibold text-white cursor-pointer">
              localOllama.autoCreateDirectories
            </label>
            <p className="text-[11px] text-[#858585] mt-0.5">
              Automatically create missing folders for AI-proposed create/rename operations inside the workspace.
            </p>
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-[#333333] bg-[#1e1e1e] flex items-center justify-between text-[11px]">
        <span className="text-emerald-400 flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5" />
          <span>Config synchronized</span>
        </span>
      </div>
    </div>
  );
};
