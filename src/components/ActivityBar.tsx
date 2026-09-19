import React from 'react';
import {
  Files,
  MessageSquareCode,
  Terminal,
  Settings,
  ArrowUpCircle,
  FolderGit2,
  Activity,
  Server,
  Sparkles,
} from 'lucide-react';

export type ActiveSidebarTab = 'explorer' | 'chat' | 'logs' | 'mcp' | 'skills' | 'settings' | 'updates';

interface ActivityBarProps {
  activeTab: ActiveSidebarTab;
  onSelectTab: (tab: ActiveSidebarTab) => void;
  unreadLogsCount?: number;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activeTab,
  onSelectTab,
  unreadLogsCount = 0,
}) => {
  const items: Array<{
    id: ActiveSidebarTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: 'chat',
      label: 'Local Ollama (@localllm)',
      icon: <MessageSquareCode className="w-5 h-5" />,
    },
    {
      id: 'explorer',
      label: 'Workspace Explorer',
      icon: <Files className="w-5 h-5" />,
    },
    {
      id: 'mcp',
      label: 'Model Context Protocol (MCP Servers)',
      icon: <Server className="w-5 h-5" />,
    },
    {
      id: 'skills',
      label: 'Procedural Skills (Playbooks)',
      icon: <Sparkles className="w-5 h-5" />,
    },
    {
      id: 'logs',
      label: 'Agent Activity & Diffs',
      icon: <Activity className="w-5 h-5" />,
      badge: unreadLogsCount > 0 ? unreadLogsCount : undefined,
    },
    {
      id: 'settings',
      label: 'Settings (Local Ollama)',
      icon: <Settings className="w-5 h-5" />,
    },
    {
      id: 'updates',
      label: 'Check for Updates (GitHub Releases)',
      icon: <ArrowUpCircle className="w-5 h-5" />,
    },
  ];

  return (
    <aside
      id="vscode-activity-bar"
      className="w-12 bg-[#333333] border-r border-[#252526] flex flex-col items-center py-2 shrink-0 select-none z-10 justify-between"
    >
      <div className="flex flex-col items-center gap-1 w-full">
        {items.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              id={`activity-tab-${item.id}`}
              onClick={() => onSelectTab(item.id)}
              title={item.label}
              className={`relative w-full h-11 flex items-center justify-center transition-colors ${
                isActive
                  ? 'text-white border-l-2 border-blue-500 bg-[#252526]'
                  : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2a2a]'
              }`}
            >
              {item.icon}
              {item.badge && item.badge > 0 && (
                <span className="absolute top-1.5 right-1.5 bg-blue-600 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-2 pb-2">
        <div
          title="Repository: athulg93/vscode-localllm (v1.2.0)"
          className="text-[#858585] hover:text-white p-2 rounded cursor-pointer"
        >
          <FolderGit2 className="w-5 h-5" />
        </div>
      </div>
    </aside>
  );
};
