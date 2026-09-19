import { SkillDefinition, SkillFrontmatter } from './skillTypes';

export class SkillParser {
  /**
   * Parses raw Markdown content containing optional YAML frontmatter into a structured SkillDefinition.
   */
  static parse(rawContent: string, filePath: string): SkillDefinition {
    const trimmed = rawContent.trim();
    let frontmatter: SkillFrontmatter = {
      name: filePath.split('/').filter(Boolean).slice(-2, -1)[0] || 'custom-skill',
      description: 'Custom procedural skill',
      triggers: [],
      autoTrigger: true,
      requiresTools: [],
    };
    let instructions = trimmed;

    let parseError: string | undefined;

    // Check for standard YAML frontmatter block (--- ... ---)
    if (trimmed.startsWith('---')) {
      const closingIndex = trimmed.indexOf('---', 3);
      if (closingIndex !== -1) {
        const yamlBlock = trimmed.slice(3, closingIndex).trim();
        instructions = trimmed.slice(closingIndex + 3).trim();

        try {
          const parsedFm = this.parseSimpleYaml(yamlBlock);
          frontmatter = {
            name: parsedFm.name || frontmatter.name,
            description: parsedFm.description || frontmatter.description,
            triggers: parsedFm.triggers || [],
            autoTrigger: parsedFm.autoTrigger !== undefined ? parsedFm.autoTrigger : true,
            requiresTools: parsedFm.requiresTools || [],
            author: parsedFm.author,
            version: parsedFm.version,
          };
        } catch (err: any) {
          parseError = `YAML frontmatter parsing warning: ${err.message || String(err)}`;
        }
      } else {
        parseError = 'Malformed frontmatter: Missing closing "---" delimiter.';
      }
    }

    const estimatedTokens = Math.round((instructions.length + JSON.stringify(frontmatter).length) / 3.8);

    return {
      id: frontmatter.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
      name: frontmatter.name,
      description: frontmatter.description,
      filePath,
      triggers: frontmatter.triggers || [],
      autoTrigger: frontmatter.autoTrigger ?? true,
      requiresTools: frontmatter.requiresTools || [],
      instructions,
      rawMarkdown: rawContent,
      isEnabled: true,
      parseError,
      estimatedTokens,
    };
  }

  private static parseSimpleYaml(yamlStr: string): Partial<SkillFrontmatter> {
    const result: any = {};
    const lines = yamlStr.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      let value = trimmed.slice(colonIdx + 1).trim();

      // Remove outer quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1).trim();
      }

      // Check for array format: ["a", "b"] or [a, b]
      if (value.startsWith('[') && value.endsWith(']')) {
        const rawItems = value.slice(1, -1).split(',');
        result[key] = rawItems
          .map((i) => i.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      } else if (value.toLowerCase() === 'true') {
        result[key] = true;
      } else if (value.toLowerCase() === 'false') {
        result[key] = false;
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}
