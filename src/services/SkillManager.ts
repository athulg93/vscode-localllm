import { SkillDefinition, SkillCatalogSummary } from '../core/skillTypes';
import { SkillParser } from '../core/SkillParser';
import { Logger } from '../core/contracts';
import { SkillDependencyValidator, SkillToolValidation } from '../core/SkillDependencyValidator';
import { McpServerState } from '../core/mcpTypes';

export const DEFAULT_MAX_SKILL_INJECTION_TOKENS = 1500;

export class SkillManager {
  private skills: Map<string, SkillDefinition> = new Map();
  private listeners: Set<() => void> = new Set();
  private maxSkillTokens: number = DEFAULT_MAX_SKILL_INJECTION_TOKENS;

  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: Logger,
  ) {}

  setMaxSkillTokens(tokens: number): void {
    this.maxSkillTokens = Math.max(500, tokens);
  }

  getMaxSkillTokens(): number {
    return this.maxSkillTokens;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('Error in SkillManager listener:', err);
      }
    }
  }

  getAllSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  getSkill(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  registerSkillFromContent(filePath: string, content: string): SkillDefinition {
    const skill = SkillParser.parse(content, filePath);
    this.skills.set(skill.id, skill);
    this.logger.appendLine(`[Skills] Loaded skill "${skill.name}" from ${filePath} (~${skill.estimatedTokens} tokens).`);
    this.notify();
    return skill;
  }

  unregisterSkill(id: string): void {
    if (this.skills.delete(id)) {
      this.notify();
    }
  }

  setSkillEnabled(id: string, enabled: boolean): void {
    const skill = this.skills.get(id);
    if (skill) {
      skill.isEnabled = enabled;
      this.notify();
    }
  }

  /**
   * Evaluates a user prompt against available skills with priority scoring:
   * Direct @mention or explicit name = 100 points
   * Exact trigger word boundary match = 50 points
   * Substring trigger match = 20 points
   * Returns skills ranked by score descending.
   */
  resolveActiveSkillsForPrompt(userPrompt: string): SkillDefinition[] {
    const normalizedPrompt = userPrompt.toLowerCase();
    const scored: Array<{ skill: SkillDefinition; score: number }> = [];

    for (const skill of this.skills.values()) {
      if (!skill.isEnabled) continue;

      let score = 0;

      // 1. Explicit mention: @skill-name or "skill <name>"
      if (
        normalizedPrompt.includes(`@${skill.id}`) ||
        normalizedPrompt.includes(`@${skill.name.toLowerCase()}`) ||
        normalizedPrompt.includes(`skill ${skill.id}`) ||
        normalizedPrompt.includes(`skill ${skill.name.toLowerCase()}`)
      ) {
        score = Math.max(score, 100);
      }

      // 2. Trigger matching if autoTrigger is enabled
      if (skill.autoTrigger && skill.triggers.length > 0) {
        for (const trigger of skill.triggers) {
          const t = trigger.toLowerCase().trim();
          if (!t) continue;

          // Word boundary match check
          const wordRegex = new RegExp(`\\b${t}\\b`, 'i');
          if (wordRegex.test(normalizedPrompt)) {
            score = Math.max(score, 50);
          } else if (normalizedPrompt.includes(t)) {
            score = Math.max(score, 20);
          }
        }
      }

      skill.matchScore = score;
      skill.isAutoActivated = score > 0;
      if (score > 0) {
        scored.push({ skill, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.skill);
  }

  /**
   * Assembles the prompt injection payload with:
   * 1. Token Budget Ceiling (default 1500 tokens) to protect 7B/8B local models
   * 2. Downgrades lower-priority matching skills to catalog summaries if budget is exceeded
   * 3. Pre-flight MCP Tool Dependency Notices when required tools are missing or servers offline
   */
  buildPromptInjection(
    userPrompt?: string,
    mcpServers: McpServerState[] = [],
    availableToolNames: Set<string> = new Set()
  ): SkillCatalogSummary {
    const all = this.getAllSkills();
    const candidateActive = userPrompt
      ? this.resolveActiveSkillsForPrompt(userPrompt)
      : all.filter((s) => s.isEnabled);

    const activeSkills: SkillDefinition[] = [];
    const suppressedSkills: SkillDefinition[] = [];
    let currentTokens = 0;

    for (const skill of candidateActive) {
      if (currentTokens + skill.estimatedTokens <= this.maxSkillTokens || activeSkills.length === 0) {
        activeSkills.push(skill);
        currentTokens += skill.estimatedTokens;
      } else {
        suppressedSkills.push(skill);
      }
    }

    let snippet = '';

    if (activeSkills.length > 0) {
      snippet += `\n\n# ACTIVE PROCEDURAL SKILLS\nThe user's request matches the following activated playbooks. You MUST adhere to their procedural rules:\n`;
      for (const skill of activeSkills) {
        snippet += `\n--- START SKILL: ${skill.name} ---\n`;

        // Pre-flight MCP dependency safety check
        if (skill.requiresTools.length > 0 && availableToolNames.size > 0) {
          const validation = SkillDependencyValidator.validate(skill, mcpServers, availableToolNames);
          const safetyNotice = SkillDependencyValidator.buildSafetyPromptNotice(validation);
          if (safetyNotice) {
            snippet += `${safetyNotice}\n`;
          }
        }

        snippet += `${skill.instructions}\n`;
        snippet += `--- END SKILL: ${skill.name} ---\n`;
      }
    }

    const inactiveOrSuppressed = [
      ...suppressedSkills,
      ...all.filter((s) => !activeSkills.includes(s) && !suppressedSkills.includes(s) && s.isEnabled),
    ];

    if (inactiveOrSuppressed.length > 0) {
      snippet += `\n\n# AVAILABLE WORKSPACE SKILLS (Reference Only)\n`;
      for (const s of inactiveOrSuppressed) {
        const isSuppressed = suppressedSkills.includes(s);
        const reason = isSuppressed ? ' [token budget capped]' : '';
        snippet += `- ${s.name}: ${s.description} (triggers: ${s.triggers.join(', ') || 'none'})${reason}\n`;
      }
    }

    return {
      activeSkills,
      suppressedSkills,
      totalSkillsCount: all.length,
      totalTokens: currentTokens,
      injectionPromptSnippet: snippet,
    };
  }

  /**
   * Generates boilerplate markdown for a new skill file.
   */
  static generateSkillTemplate(name: string, description: string): string {
    const safeName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    return `---
name: ${safeName}
description: ${description || 'Guidelines and best practices for specific tasks'}
triggers: ["${safeName}"]
autoTrigger: true
requiresTools: []
---

# ${name} Playbook

## Objectives
- Briefly describe the standard or quality benchmark this skill enforces.

## Execution Rules
1. Step 1: Analyze context and verify preconditions.
2. Step 2: Implement changes adhering to the design patterns above.
3. Step 3: Run validation or verify edge cases before finalizing.
`;
  }
}
