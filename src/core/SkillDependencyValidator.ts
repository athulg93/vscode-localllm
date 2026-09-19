import { SkillDefinition } from './skillTypes';
import { McpDiscoveredTool, McpServerState } from './mcpTypes';

export interface SkillToolValidation {
  skillId: string;
  skillName: string;
  isReady: boolean;
  missingTools: string[];
  offlineServerTools: Array<{ toolName: string; serverName: string }>;
  availableTools: string[];
  warningMessage?: string;
}

export class SkillDependencyValidator {
  /**
   * Validates if all required tools for a skill are present and provided by connected MCP servers.
   */
  static validate(
    skill: SkillDefinition,
    servers: McpServerState[],
    availableToolNames: Set<string>
  ): SkillToolValidation {
    const missingTools: string[] = [];
    const offlineServerTools: Array<{ toolName: string; serverName: string }> = [];
    const availableTools: string[] = [];

    for (const reqTool of skill.requiresTools) {
      if (availableToolNames.has(reqTool)) {
        availableTools.push(reqTool);
        continue;
      }

      // Check if tool exists on an offline or errored server
      let foundInServer = false;
      for (const server of servers) {
        const hasTool = server.tools.some((t) => t.name === reqTool);
        if (hasTool) {
          foundInServer = true;
          if (server.status !== 'connected') {
            offlineServerTools.push({ toolName: reqTool, serverName: server.name });
          } else {
            // Tool is on connected server but may be disabled
            missingTools.push(reqTool);
          }
          break;
        }
      }

      if (!foundInServer) {
        missingTools.push(reqTool);
      }
    }

    const isReady = missingTools.length === 0 && offlineServerTools.length === 0;

    let warningMessage: string | undefined;
    if (!isReady) {
      const parts: string[] = [];
      if (offlineServerTools.length > 0) {
        parts.push(
          `Server offline for: ${offlineServerTools.map((o) => `${o.toolName} (${o.serverName})`).join(', ')}`
        );
      }
      if (missingTools.length > 0) {
        parts.push(`Missing tools: ${missingTools.join(', ')}`);
      }
      warningMessage = parts.join('; ');
    }

    return {
      skillId: skill.id,
      skillName: skill.name,
      isReady,
      missingTools,
      offlineServerTools,
      availableTools,
      warningMessage,
    };
  }

  /**
   * Generates a safety disclaimer for the LLM when a skill has missing or offline tools,
   * explicitly instructing the LLM NOT to hallucinate or invent the missing tool calls.
   */
  static buildSafetyPromptNotice(validation: SkillToolValidation): string {
    if (validation.isReady) return '';

    const missingList = [
      ...validation.missingTools,
      ...validation.offlineServerTools.map((o) => o.toolName),
    ].join(', ');

    return `\n[NOTE FOR SKILL ${validation.skillName}: Required tool(s) "${missingList}" are currently offline or unavailable. DO NOT attempt to call or simulate these tools. Rely on available workspace tools or explain the limitation to the user.]\n`;
  }
}
