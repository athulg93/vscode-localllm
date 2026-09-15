export type ToolProtocol = 'native' | 'json' | 'xml' | 'none';

export type ModelBehaviorProfile = {
  family: 'qwen' | 'gemma' | 'llama' | 'deepseek' | 'generic';
  toolProtocol: ToolProtocol;
  toolResultRole: 'tool' | 'user';
  supportsTools: boolean;
};

export type ProfileDefinition = Omit<ModelBehaviorProfile, 'supportsTools'> & {
  pattern: RegExp;
};

const PROFILE_DEFINITIONS: ProfileDefinition[] = [
  { family: 'deepseek', pattern: /deepseek/i, toolProtocol: 'none', toolResultRole: 'user' },
  { family: 'qwen', pattern: /qwen/i, toolProtocol: 'native', toolResultRole: 'tool' },
  { family: 'gemma', pattern: /gemma/i, toolProtocol: 'native', toolResultRole: 'tool' },
  { family: 'llama', pattern: /llama/i, toolProtocol: 'native', toolResultRole: 'tool' },
  { family: 'generic', pattern: /(?:mistral|command-r|starcoder|codellama)/i, toolProtocol: 'native', toolResultRole: 'tool' },
];

export function registerModelProfile(profile: ProfileDefinition): void {
  PROFILE_DEFINITIONS.unshift(profile);
}

export function resolveModelProfile(model: string, advertisedCapabilities?: string[]): ModelBehaviorProfile {
  const definition = PROFILE_DEFINITIONS.find((candidate) => candidate.pattern.test(model));
  const advertisedTools = advertisedCapabilities?.includes('tools') === true;
  const family = definition?.family ?? 'generic';

  // If the model explicitly disallows tools
  if (definition?.toolProtocol === 'none') {
    return {
      family,
      toolProtocol: 'none',
      toolResultRole: 'user',
      supportsTools: false,
    };
  }

  // If advertised capabilities exist and include 'tools', use native protocol
  if (advertisedTools) {
    return {
      family,
      toolProtocol: definition?.toolProtocol ?? 'native',
      toolResultRole: definition?.toolResultRole ?? 'tool',
      supportsTools: true,
    };
  }

  // If capabilities were not reported by Ollama /show (common in older Ollama releases or custom modelfiles),
  // but the model family is known to support tools natively (qwen, llama, gemma, mistral, etc.), enable native tools.
  if (definition) {
    return {
      family,
      toolProtocol: definition.toolProtocol,
      toolResultRole: definition.toolResultRole,
      supportsTools: true,
    };
  }

  // Fallback for unlisted models without explicit tool advertising: allow JSON text tool calling
  return {
    family,
    toolProtocol: 'json',
    toolResultRole: 'user',
    supportsTools: true,
  };
}

export function modelProfileLabel(profile: ModelBehaviorProfile): string {
  return profile.supportsTools ? `Tools: ${profile.toolProtocol}` : 'Tools: unavailable';
}
