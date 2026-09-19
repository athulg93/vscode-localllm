import React, { useState } from 'react';
import {
  Sparkles,
  BookOpen,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  XCircle,
  Code2,
  FileText,
  Tag,
  Wrench,
  Search,
  AlertTriangle,
  Play,
  Check,
  HelpCircle,
  Zap,
} from 'lucide-react';
import { SkillDefinition } from '../core/skillTypes';
import { McpServerState } from '../core/mcpTypes';
import { SkillDependencyValidator } from '../core/SkillDependencyValidator';

interface SkillsPanelProps {
  skills: SkillDefinition[];
  mcpServers?: McpServerState[];
  onToggleSkill: (id: string, enabled: boolean) => void;
  onSelectSkill: (skill: SkillDefinition) => void;
  onCreateSkill: () => void;
  onDeleteSkill: (id: string) => void;
  onStartMcpServer?: (serverName: string) => void;
}

export const SkillsPanel: React.FC<SkillsPanelProps> = ({
  skills,
  mcpServers = [],
  onToggleSkill,
  onSelectSkill,
  onCreateSkill,
  onDeleteSkill,
  onStartMcpServer,
}) => {
  const [filterText, setFilterText] = useState('');
  const [testPrompt, setTestPrompt] = useState('');
  const [activeTab, setActiveTab] = useState<'catalog' | 'simulator'>('catalog');

  const availableToolNames = new Set<string>();
  for (const s of mcpServers) {
    if (s.status === 'connected') {
      for (const t of s.tools) {
        availableToolNames.add(t.name);
      }
    }
  }

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(filterText.toLowerCase()) ||
      s.description.toLowerCase().includes(filterText.toLowerCase()) ||
      s.triggers.some((t) => t.toLowerCase().includes(filterText.toLowerCase()))
  );

  // Simulated trigger evaluation
  const simulatedMatches = skills
    .map((skill) => {
      let score = 0;
      const lower = testPrompt.toLowerCase().trim();
      if (!lower) return { skill, score: 0 };

      if (
        lower.includes(`@${skill.id}`) ||
        lower.includes(`@${skill.name.toLowerCase()}`) ||
        lower.includes(`skill ${skill.id}`)
      ) {
        score = 100;
      } else if (skill.autoTrigger && skill.triggers.length > 0) {
        for (const trigger of skill.triggers) {
          const t = trigger.toLowerCase();
          const wordRegex = new RegExp(`\\b${t}\\b`, 'i');
          if (wordRegex.test(lower)) {
            score = Math.max(score, 50);
          } else if (lower.includes(t)) {
            score = Math.max(score, 20);
          }
        }
      }
      return { skill, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-[#cccccc] select-none text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#252526] bg-[#252526]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#dcdcaa]" />
          <span className="font-semibold text-[11px] uppercase tracking-wider text-[#e0e0e0]">
            PROCEDURAL SKILLS
          </span>
        </div>
        <button
          onClick={onCreateSkill}
          title="Create New Skill (.vscode/skills/...)"
          className="flex items-center gap-1 px-2 py-1 rounded bg-[#0e639c] hover:bg-[#1177bb] text-white transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="text-[11px]">New Skill</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#252526] bg-[#1e1e1e]">
        <button
          onClick={() => setActiveTab('catalog')}
          className={`flex-1 py-1.5 text-center font-medium border-b-2 text-[11px] ${
            activeTab === 'catalog'
              ? 'border-[#007acc] text-[#ffffff] bg-[#252526]'
              : 'border-transparent text-[#888888] hover:text-[#cccccc]'
          }`}
        >
          Skill Library ({skills.length})
        </button>
        <button
          onClick={() => setActiveTab('simulator')}
          className={`flex-1 py-1.5 text-center font-medium border-b-2 text-[11px] flex items-center justify-center gap-1.5 ${
            activeTab === 'simulator'
              ? 'border-[#007acc] text-[#ffffff] bg-[#252526]'
              : 'border-transparent text-[#888888] hover:text-[#cccccc]'
          }`}
        >
          <Zap className="w-3 h-3 text-[#e5c07b]" />
          <span>Trigger Simulator</span>
        </button>
      </div>

      {activeTab === 'simulator' ? (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          <div className="bg-[#252526] p-3 rounded border border-[#333333]">
            <label className="text-[11px] font-semibold text-[#e0e0e0] block mb-1">
              Test Natural Language Prompt:
            </label>
            <p className="text-[10px] text-[#888888] mb-2">
              Type a hypothetical user question to test how local LLM triggers and dependency guards will activate.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                placeholder="e.g. Please refactor the authentication tests and query the database..."
                className="flex-1 bg-[#181818] border border-[#3c3c3c] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#007acc]"
              />
              {testPrompt && (
                <button
                  onClick={() => setTestPrompt('')}
                  className="px-2 py-1 text-[10px] text-[#888888] hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#888888] block mb-2">
              Simulation Results ({simulatedMatches.length} Matches)
            </span>

            {simulatedMatches.length === 0 ? (
              <div className="text-center py-6 text-[#777777] bg-[#252526]/50 rounded border border-[#2a2a2a]">
                {testPrompt ? 'No skills matched this prompt.' : 'Enter a prompt above to test trigger matching.'}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {simulatedMatches.map(({ skill, score }) => {
                  const validation = SkillDependencyValidator.validate(skill, mcpServers, availableToolNames);
                  return (
                    <div
                      key={skill.id}
                      className="p-3 rounded bg-[#252526] border border-[#333333] flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{skill.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              score >= 100
                                ? 'bg-purple-900/60 text-purple-200 border border-purple-700'
                                : score >= 50
                                ? 'bg-emerald-900/60 text-emerald-200 border border-emerald-700'
                                : 'bg-blue-900/60 text-blue-200 border border-blue-700'
                            }`}
                          >
                            Score {score} ({score >= 100 ? '@mention' : score >= 50 ? 'Exact' : 'Fuzzy'})
                          </span>
                          <span className="text-[10px] text-[#888888]">~{skill.estimatedTokens} tok</span>
                        </div>
                      </div>

                      <p className="text-[11px] text-[#aaaaaa]">{skill.description}</p>

                      {/* Tool Dependency Status */}
                      {skill.requiresTools.length > 0 && (
                        <div className="pt-2 mt-1 border-t border-[#333333] flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            {validation.isReady ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                            )}
                            <span
                              className={`text-[10px] ${
                                validation.isReady ? 'text-emerald-400' : 'text-amber-400 font-medium'
                              }`}
                            >
                              {validation.isReady
                                ? 'All MCP Tools Ready'
                                : validation.warningMessage || 'Missing MCP Tools'}
                            </span>
                          </div>

                          {!validation.isReady && validation.offlineServerTools.length > 0 && onStartMcpServer && (
                            <button
                              onClick={() => onStartMcpServer(validation.offlineServerTools[0].serverName)}
                              className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-black font-semibold text-[10px]"
                            >
                              Start {validation.offlineServerTools[0].serverName}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Search bar */}
          <div className="p-2 border-b border-[#252526]">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-[#181818] border border-[#3c3c3c] rounded text-[#cccccc] focus-within:border-[#007acc]">
              <Search className="w-3.5 h-3.5 text-[#888888]" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Search skills, triggers, or playbooks..."
                className="w-full bg-transparent outline-none text-xs placeholder-[#666666]"
              />
            </div>
          </div>

          {/* Skill List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {filteredSkills.length === 0 ? (
              <div className="text-center py-8 text-[#777777]">
                <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No procedural skills found.</p>
                <p className="text-[10px] mt-1 text-[#555555]">
                  Create a skill file in <code className="text-[#888888]">.vscode/skills/&lt;name&gt;/SKILL.md</code>
                </p>
              </div>
            ) : (
              filteredSkills.map((skill) => {
                const validation = SkillDependencyValidator.validate(skill, mcpServers, availableToolNames);
                return (
                  <div
                    key={skill.id}
                    className={`group relative flex flex-col p-3 rounded border transition-all ${
                      skill.isEnabled
                        ? 'bg-[#252526] border-[#333333] hover:border-[#444444]'
                        : 'bg-[#1c1c1c] border-[#252526] opacity-60'
                    }`}
                  >
                    {/* Top Row: Name and actions */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <BookOpen
                          className={`w-3.5 h-3.5 shrink-0 ${
                            skill.isEnabled ? 'text-[#dcdcaa]' : 'text-[#666666]'
                          }`}
                        />
                        <span
                          className="font-medium text-white truncate cursor-pointer hover:underline"
                          title={skill.name}
                          onClick={() => onSelectSkill(skill)}
                        >
                          {skill.name}
                        </span>
                        <span className="text-[10px] text-[#777777] shrink-0">
                          ~{skill.estimatedTokens} tok
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {/* Enabled Toggle */}
                        <button
                          onClick={() => onToggleSkill(skill.id, !skill.isEnabled)}
                          title={skill.isEnabled ? 'Disable Skill' : 'Enable Skill'}
                          className={`p-1 rounded hover:bg-[#333333] ${
                            skill.isEnabled ? 'text-[#4ec9b0]' : 'text-[#777777]'
                          }`}
                        >
                          {skill.isEnabled ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {/* Delete Skill */}
                        <button
                          onClick={() => onDeleteSkill(skill.id)}
                          title="Delete Skill"
                          className="p-1 rounded hover:bg-[#333333] text-[#777777] hover:text-[#f14c4c]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Parse Error Warning */}
                    {skill.parseError && (
                      <div className="mb-2 p-1.5 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300 text-[10px] flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>{skill.parseError}</span>
                      </div>
                    )}

                    {/* Description */}
                    <p className="text-[#aaaaaa] text-[11px] mb-2 leading-relaxed line-clamp-2">
                      {skill.description}
                    </p>

                    {/* Triggers chips */}
                    {skill.triggers.length > 0 && (
                      <div className="flex items-center flex-wrap gap-1 mb-2">
                        <span className="text-[9px] text-[#777777] uppercase tracking-wider mr-1">Triggers:</span>
                        {skill.triggers.map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 rounded bg-[#1e2e38] text-[#4fc1ff] text-[10px] border border-[#2b4c61]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Required MCP tools if any */}
                    {skill.requiresTools && skill.requiresTools.length > 0 && (
                      <div className="flex items-center flex-wrap gap-1 mb-2">
                        <span className="text-[9px] text-[#777777] uppercase tracking-wider mr-1 flex items-center gap-0.5">
                          <Wrench className="w-2.5 h-2.5" /> Tools:
                        </span>
                        {skill.requiresTools.map((tool) => {
                          const isAvailable = availableToolNames.has(tool);
                          return (
                            <span
                              key={tool}
                              className={`px-1.5 py-0.5 rounded text-[10px] border flex items-center gap-1 ${
                                isAvailable
                                  ? 'bg-[#2e2618] text-[#dcdcaa] border-[#524427]'
                                  : 'bg-red-950/40 text-red-300 border-red-800/50'
                              }`}
                            >
                              <span>{tool}</span>
                              {!isAvailable && <span className="text-[9px] text-red-400 font-bold">!</span>}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Offline Tool Remediation Action */}
                    {!validation.isReady && validation.offlineServerTools.length > 0 && onStartMcpServer && (
                      <div className="mb-2 p-1.5 rounded bg-amber-900/30 border border-amber-700/50 flex items-center justify-between">
                        <span className="text-[10px] text-amber-300">
                          Server "{validation.offlineServerTools[0].serverName}" is offline
                        </span>
                        <button
                          onClick={() => onStartMcpServer(validation.offlineServerTools[0].serverName)}
                          className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-black font-semibold text-[10px]"
                        >
                          Start Server
                        </button>
                      </div>
                    )}

                    {/* Edit button */}
                    <div className="flex justify-end pt-1 border-t border-[#2d2d2d]">
                      <button
                        onClick={() => onSelectSkill(skill)}
                        className="flex items-center gap-1 text-[10px] text-[#3794ff] hover:underline"
                      >
                        <Edit3 className="w-2.5 h-2.5" />
                        <span>View / Edit SKILL.md</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-2 border-t border-[#252526] bg-[#181818] flex items-center justify-between text-[10px] text-[#888888]">
            <span>Stored in .vscode/skills/&lt;name&gt;/SKILL.md</span>
            <span>{skills.filter((s) => s.isEnabled).length} active</span>
          </div>
        </>
      )}
    </div>
  );
};
