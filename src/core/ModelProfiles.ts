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
];

export function registerModelProfile(profile: ProfileDefinition): void {
  PROFILE_DEFINITIONS.unshift(profile);
}

export function resolveModelProfile(model: string, advertisedCapabilities?: string[]): ModelBehaviorProfile {
  const definition = PROFILE_DEFINITIONS.find((candidate) => candidate.pattern.test(model));
  const advertisedTools = advertisedCapabilities?.includes('tools') === true;
  const family = definition?.family ?? 'generic';

  if (!advertisedTools) {
    return {
      family,
      toolProtocol: 'none',
      toolResultRole: 'user',
      supportsTools: false,
    };
  }

  if (definition?.toolProtocol === 'none') {
    return {
      family,
      toolProtocol: 'none',
      toolResultRole: 'user',
      supportsTools: false,
    };
  }

  return {
    family,
    toolProtocol: definition?.toolProtocol ?? 'native',
    toolResultRole: definition?.toolResultRole ?? 'tool',
    supportsTools: true,
  };
}

export function modelProfileLabel(profile: ModelBehaviorProfile): string {
  return profile.supportsTools ? `Tools: ${profile.toolProtocol}` : 'Tools: unavailable';
}
