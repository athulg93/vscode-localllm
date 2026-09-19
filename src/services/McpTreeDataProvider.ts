import * as vscode from 'vscode';
import { McpManager } from './McpManager';
import { McpServerState, McpDiscoveredTool } from '../core/mcpTypes';

export class McpTreeDataProvider implements vscode.TreeDataProvider<McpTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<McpTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly mcpManager: McpManager) {
    this.mcpManager.subscribe(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: McpTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: McpTreeItem): Thenable<McpTreeItem[]> {
    if (!element) {
      // Root level: show server states or placeholder
      const states = this.mcpManager.getServerStates();
      if (states.length === 0) {
        return Promise.resolve([
          new McpTreeItem(
            'No MCP Servers Configured',
            'Click to create or open .vscode/mcp.json',
            'info',
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            {
              command: 'localOllama.configureMcp',
              title: 'Configure MCP Servers',
            }
          ),
        ]);
      }

      return Promise.resolve(
        states.map((state) => {
          const statusIcon =
            state.status === 'connected'
              ? 'check'
              : state.status === 'connecting' || state.status === 'reconnecting'
              ? 'sync~spin'
              : 'error';

          const color =
            state.status === 'connected'
              ? new vscode.ThemeColor('charts.green')
              : state.status === 'error'
              ? new vscode.ThemeColor('charts.red')
              : new vscode.ThemeColor('charts.yellow');

          const desc = `${state.transport.toUpperCase()} • ${state.tools.length} tool(s)`;
          return new McpTreeItem(
            state.name,
            desc,
            statusIcon,
            vscode.TreeItemCollapsibleState.Collapsed,
            color,
            state
          );
        })
      );
    }

    // Children of a server: list its discovered tools
    if (element.serverState) {
      const state = element.serverState;
      if (state.lastError) {
        return Promise.resolve([
          new McpTreeItem(
            'Error',
            state.lastError,
            'warning',
            vscode.TreeItemCollapsibleState.None,
            new vscode.ThemeColor('charts.red')
          ),
        ]);
      }

      if (state.tools.length === 0) {
        return Promise.resolve([
          new McpTreeItem(
            'No tools discovered',
            'Check server initialization',
            'circle-slash',
            vscode.TreeItemCollapsibleState.None
          ),
        ]);
      }

      return Promise.resolve(
        state.tools.map((tool) => {
          const icon = tool.isEnabled ? 'wrench' : 'circle-slash';
          const color = tool.isEnabled
            ? new vscode.ThemeColor('charts.blue')
            : new vscode.ThemeColor('charts.gray');

          return new McpTreeItem(
            tool.name,
            tool.description,
            icon,
            vscode.TreeItemCollapsibleState.None,
            color,
            undefined,
            undefined,
            tool
          );
        })
      );
    }

    return Promise.resolve([]);
  }
}

export class McpTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    color?: vscode.ThemeColor,
    public readonly serverState?: McpServerState,
    command?: vscode.Command,
    public readonly tool?: McpDiscoveredTool
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon, color);
    this.tooltip = `${label}\n${description}`;
    if (command) {
      this.command = command;
    }
  }
}
