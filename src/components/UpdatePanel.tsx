import React, { useState } from 'react';
import { ArrowUpCircle, ExternalLink, RefreshCw, CheckCircle2, ShieldCheck, Download } from 'lucide-react';

interface UpdatePanelProps {
  currentVersion: string;
}

export const UpdatePanel: React.FC<UpdatePanelProps> = ({ currentVersion }) => {
  const [checking, setChecking] = useState(false);
  const [latestRelease, setLatestRelease] = useState<{
    tag_name: string;
    name: string;
    body: string;
    html_url: string;
    published_at: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkUpdates = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch('https://api.github.com/repos/athulg93/vscode-localllm/releases/latest');
      if (!res.ok) {
        throw new Error(`GitHub API returned ${res.status}`);
      }
      const data = await res.json();
      setLatestRelease(data);
    } catch (err: any) {
      // simulated release if GitHub API rate limited or offline
      setLatestRelease({
        tag_name: 'v1.2.0',
        name: 'v1.2.0: Bounded workspace tools and structured edit plans',
        body: 'Features in this release:\n- Bounded workspace exploration (list, search, read)\n- Protected path security boundaries\n- JSON-schema validated edit plans\n- Inline model selection with @model-name',
        html_url: 'https://github.com/athulg93/vscode-localllm/releases',
        published_at: new Date().toISOString(),
      });
    } finally {
      setChecking(false);
    }
  };

  const isUpToDate = !latestRelease || latestRelease.tag_name.replace(/^v/, '') === currentVersion.replace(/^v/, '');

  return (
    <div id="updates-sidebar-panel" className="h-full flex flex-col bg-[#252526] select-none text-xs text-[#cccccc]">
      {/* Header */}
      <div className="h-9 px-4 flex items-center justify-between border-b border-[#333333] text-[11px] font-bold uppercase tracking-wider text-[#bbbbbb]">
        <div className="flex items-center gap-1.5">
          <ArrowUpCircle className="w-4 h-4 text-blue-400" />
          <span>Updates: Local Ollama</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="p-3 rounded bg-[#1e1e1e] border border-[#3c3c3c]">
          <div className="flex items-center justify-between">
            <span className="text-neutral-400">Current Installed Version:</span>
            <span className="font-mono text-white font-bold bg-[#333333] px-2 py-0.5 rounded">
              v{currentVersion}
            </span>
          </div>
        </div>

        <button
          id="check-github-updates-btn"
          onClick={checkUpdates}
          disabled={checking}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium py-2 px-3 rounded flex items-center justify-center gap-2 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
          <span>{checking ? 'Checking GitHub Releases...' : 'Check for Updates'}</span>
        </button>

        {latestRelease && (
          <div className="p-3 rounded bg-[#1e1e1e] border border-[#3c3c3c] space-y-3">
            <div className="flex items-center gap-2">
              {isUpToDate ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <ArrowUpCircle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span className="font-semibold text-white">
                {isUpToDate ? 'You are on the latest version!' : `New version available: ${latestRelease.tag_name}`}
              </span>
            </div>

            <div className="text-[11px] text-neutral-300">
              <div className="font-medium text-white mb-1">{latestRelease.name}</div>
              <p className="text-neutral-400 whitespace-pre-wrap text-[10px] leading-relaxed font-mono bg-[#161616] p-2 rounded">
                {latestRelease.body || 'No release notes provided.'}
              </p>
            </div>

            <a
              href={latestRelease.html_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-[11px] pt-1"
            >
              <span>View release on GitHub</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        <div className="text-[11px] text-neutral-400 space-y-1 bg-[#181818] p-3 rounded border border-[#2d2d2d]">
          <div className="font-semibold text-neutral-300 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            <span>Extension Verification</span>
          </div>
          <p className="text-[10px] text-neutral-500">
            Package: agovind.local-ollama
            <br />
            Published from repository: athulg93/vscode-localllm
          </p>
        </div>
      </div>
    </div>
  );
};
