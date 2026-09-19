import React, { useState } from 'react';
import {
  Server,
  Wrench,
  AlertTriangle,
  Play,
  RotateCw,
  Plus,
  FileCode,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ShieldAlert,
  HelpCircle,
  Zap,
} from 'lucide-react';
import { McpServerState, McpDiscoveredTool, McpContextBudgetReport } from '../core/mcpTypes';

interface McpPanelProps {
  servers: McpServerState[];
  budgetReport?: McpContextBudgetReport;
  onToggleTool: (toolName: string, enabled: boolean) => void;
  onRestartServers: () => void;
  onOpenMcpConfig: () => void;
  onTestTool?: (tool: McpDiscoveredTool) => void;
}

export const McpPanel: React.FC<McpPanelProps> = ({
  servers,
  budgetReport,
  onToggleTool,
  onRestartServers,
  onOpenMcpConfig,
  onTestTool,
}) => {
  const [selectedServer, setSelectedServer] = useState<string | null>(
    servers.length > 0 ? servers[0].name : null
  );

  const activeServer = servers.find((s) => s.name === selectedServer) || servers[0];

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-[#cccccc] select-none text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#252526] bg-[#252526]">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-[#3794ff]" />
          <span className="font-semibold text-[11px] uppercase tracking-wider text-[#e0e0e0]">
            MCP SERVERS & TOOLS
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRestartServers}
            title="Restart all MCP servers"
            className="p-1 rounded hover:bg-[#37373d] text-[#cccccc] hover:text-white transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenMcpConfig}
            title="Open .vscode/mcp.json"
            className="p-1 rounded hover:bg-[#37373d] text-[#cccccc] hover:text-white transition-colors"
          >
            <FileCode className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Context Budget Indicator */}
      {budgetReport && (
        <div
          className={`px-3 py-2 border-b text-[11px] flex items-start gap-2 ${
            budgetReport.isOverBudget
              ? 'bg-[#3b2200] border-[#d7ba7d] text-[#e0a84f]'
              : 'bg-[#18231c] border-[#253e2b] text-[#73c991]'
          }`}
        >
          {budgetReport.isOverBudget ? (
            <ShieldAlert className="w-4 h-4 shrink-0 text-[#cca700] mt-0.5" />
          ) : (
            <Zap className="w-4 h-4 shrink-0 text-[#89d185] mt-0.5" />
          )}
          <div className="flex-1 leading-tight">
            <div className="font-medium">
              Context Budget: ~{budgetReport.totalEstimatedTokens} tokens ({budgetReport.toolCount} active tools)
            </div>
            {budgetReport.warningMessage ? (
              <div className="text-[10px] opacity-90 mt-0.5">{budgetReport.warningMessage}</div>
            ) : (
              <div className="text-[10px] opacity-75 mt-0.5">
                Within recommended tool token envelope (&lt;25% context).
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {servers.length === 0 ? (
          <div className="p-6 text-center text-[#888888] flex flex-col items-center justify-center h-full">
            <Server className="w-8 h-8 opacity-40 mb-3" />
            <p className="font-medium text-[#cccccc] mb-1">No MCP Servers Configured</p>
            <p className="text-[11px] mb-4 text-[#888888] max-w-xs">
              Model Context Protocol (MCP) gives local LLMs safe tools to query databases, web APIs, and specialized scripts.
            </p>
            <button
              onClick={onOpenMcpConfig}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#0e639c] hover:bg-[#1177bb] text-white font-medium shadow"
            >
              <Plus className="w-3.5 h-3.5" />
              Initialize .vscode/mcp.json
            </button>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Server Selector Tabs */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-[#252526] bg-[#1a1a1a] overflow-x-auto">
              {servers.map((s) => (
                <button
                  key={s.name}
                  onClick={() => setSelectedServer(s.name)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    activeServer?.name === s.name
                      ? 'bg-[#094771] text-white'
                      : 'hover:bg-[#2a2d2e] text-[#969696] hover:text-[#cccccc]'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      s.status === 'connected'
                        ? 'bg-[#89d185]'
                        : s.status === 'error'
                        ? 'bg-[#f14c4c]'
                        : 'bg-[#cca700] animate-pulse'
                    }`}
                  />
                  <span>{s.name}</span>
                  <span className="text-[9px] opacity-60">({s.tools.length})</span>
                </button>
              ))}
            </div>

            {/* Active Server Details */}
            {activeServer && (
              <div className="flex-1 flex flex-col p-3 overflow-y-auto">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#252526]">
                  <div>
                    <span className="font-semibold text-white text-sm">{activeServer.name}</span>
                    <span className="ml-2 uppercase tracking-wide text-[10px] px-1.5 py-0.5 rounded bg-[#2d2d2d] text-[#cccccc]">
                      {activeServer.transport}
                    </span>
                  </div>
                  <span
                    className={`text-[11px] font-medium px-2 py-0.5 rounded ${
                      activeServer.status === 'connected'
                        ? 'text-[#89d185] bg-[#1a2d1d]'
                        : activeServer.status === 'error'
                        ? 'text-[#f14c4c] bg-[#361c1c]'
                        : 'text-[#cca700] bg-[#332a18]'
                    }`}
                  >
                    {activeServer.status}
                  </span>
                </div>

                {activeServer.lastError && (
                  <div className="p-2 mb-3 rounded bg-[#331c1c] border border-[#5a1d1d] text-[#f48771] flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-[#f14c4c] mt-0.5" />
                    <div>
                      <div className="font-medium">Connection Failure:</div>
                      <div className="text-[10px] opacity-90 break-words">{activeServer.lastError}</div>
                    </div>
                  </div>
                )}

                {/* Discovered Tools List */}
                <div className="font-medium text-[#cccccc] mb-2 flex items-center justify-between">
                  <span>Available Tools ({activeServer.tools.length})</span>
                  <span className="text-[10px] text-[#888888]">Toggle to budget context</span>
                </div>

                {activeServer.tools.length === 0 ? (
                  <div className="p-4 text-center text-[#888888] bg-[#181818] rounded border border-[#252526]">
                    No tools published by this server yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeServer.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className={`p-2.5 rounded border transition-colors ${
                          tool.isEnabled
                            ? 'bg-[#252526] border-[#333333]'
                            : 'bg-[#181818] border-[#222222] opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Wrench className={`w-3.5 h-3.5 ${tool.isEnabled ? 'text-[#3794ff]' : 'text-[#666666]'}`} />
                            <span className="font-mono font-medium text-white text-[11px]">{tool.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-[#888888]">~{tool.estimatedTokens} tok</span>
                            <input
                              type="checkbox"
                              checked={tool.isEnabled}
                              onChange={(e) => onToggleTool(tool.name, e.target.checked)}
                              className="accent-[#0e639c] cursor-pointer"
                              title={tool.isEnabled ? 'Disable tool' : 'Enable tool'}
                            />
                          </div>
                        </div>
                        <p className="text-[11px] text-[#aaaaaa] leading-relaxed mb-2">{tool.description}</p>
                        
                        {/* Parameters Schema Preview */}
                        {tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length > 0 && (
                          <div className="bg-[#1b1b1b] p-1.5 rounded border border-[#2a2a2a] font-mono text-[10px] text-[#888888]">
                            <span className="text-[#569cd6]">args:</span>{' '}
                            {Object.entries(tool.inputSchema.properties)
                              .map(([k, prop]) => `${k}${tool.inputSchema.required?.includes(k) ? '*' : ''}: ${(prop as any).type}`)
                              .join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-2 border-t border-[#252526] bg-[#181818] flex items-center justify-between text-[10px] text-[#888888]">
        <span>Configured in .vscode/mcp.json</span>
        <button
          onClick={onOpenMcpConfig}
          className="text-[#3794ff] hover:underline flex items-center gap-1"
        >
          <span>Edit Config</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
};
