export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
  autoTrigger?: boolean;
  requiresTools?: string[];
  author?: string;
  version?: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  filePath: string;
  triggers: string[];
  autoTrigger: boolean;
  requiresTools: string[];
  instructions: string;
  rawMarkdown: string;
  isEnabled: boolean;
  isAutoActivated?: boolean;
  matchScore?: number;
  parseError?: string;
  estimatedTokens: number;
}

export interface SkillCatalogSummary {
  activeSkills: SkillDefinition[];
  suppressedSkills?: SkillDefinition[];
  totalSkillsCount: number;
  totalTokens: number;
  injectionPromptSnippet: string;
}
