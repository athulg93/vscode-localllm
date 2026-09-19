import * as vscode from 'vscode';
import { SkillManager } from './SkillManager';
import { SkillDefinition } from '../core/skillTypes';

export class SkillsTreeDataProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SkillTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly skillManager: SkillManager) {
    this.skillManager.subscribe(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SkillTreeItem): Thenable<SkillTreeItem[]> {
    if (!element) {
      const skills = this.skillManager.getAllSkills();
      if (skills.length === 0) {
        return Promise.resolve([
          new SkillTreeItem(
            'No Skills Found',
            'Click to create your first .vscode/skills/.../SKILL.md',
            'sparkle',
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            {
              command: 'localOllama.createSkill',
              title: 'Create Skill',
            }
          ),
        ]);
      }

      return Promise.resolve(
        skills.map((skill) => {
          const icon = skill.isEnabled ? 'book' : 'circle-slash';
          const color = skill.isEnabled
            ? new vscode.ThemeColor('charts.green')
            : new vscode.ThemeColor('charts.gray');

          const triggers = skill.triggers.length > 0 ? ` [${skill.triggers.join(', ')}]` : '';
          const desc = `~${skill.estimatedTokens} tok${triggers}`;

          return new SkillTreeItem(
            skill.name,
            desc,
            icon,
            vscode.TreeItemCollapsibleState.Collapsed,
            color,
            skill
          );
        })
      );
    }

    if (element.skill) {
      const skill = element.skill;
      const items: SkillTreeItem[] = [
        new SkillTreeItem(
          'Open SKILL.md',
          skill.filePath,
          'file-code',
          vscode.TreeItemCollapsibleState.None,
          undefined,
          skill,
          {
            command: 'vscode.open',
            title: 'Open SKILL.md',
            arguments: [vscode.Uri.file(skill.filePath)],
          }
        ),
        new SkillTreeItem(
          'Description',
          skill.description,
          'info',
          vscode.TreeItemCollapsibleState.None
        ),
      ];

      if (skill.requiresTools.length > 0) {
        items.push(
          new SkillTreeItem(
            'Required Tools',
            skill.requiresTools.join(', '),
            'wrench',
            vscode.TreeItemCollapsibleState.None
          )
        );
      }

      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }
}

export class SkillTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    color?: vscode.ThemeColor,
    public readonly skill?: SkillDefinition,
    command?: vscode.Command
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
