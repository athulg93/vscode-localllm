import { PromptIntent } from '../types';

const CONVERSATIONAL_OR_CASUAL_INTENT = /^(?:hi|hello|hey|yo|how are you|what'?s up|good morning|good afternoon|good evening|thanks|thank you|who are you|help|ok|okay)[.!?\s]*$/i;

const INTENT_PATTERNS: Array<{ intent: PromptIntent; patterns: RegExp[] }> = [
  {
    intent: PromptIntent.GitTransaction,
    patterns: [
      /^\/?(?:git[\s-])?(pull|push|status|diff|commit|add|checkout|branch|remote|merge|log|stash|fetch)\b/i,
      /\b(git[\s-]+(pull|push|commit|status|diff|add|checkout|branch|remote|merge|log|stash|fetch))\b/i,
      /\b(pull|push|sync)\b[\s\S]*\b(repo|repository|remote|branch|origin|upstream|github|gitlab)\b/i,
      /\b(pull|push|sync)\s+(from|to)\s+\w+/i,
      /\b(merge|rebase)\b[\s\S]*\b(branch|mr|pr|pull request|merge request)\b/i,
      /\b(commit|stage)\b[\s\S]*\b(changes|files?|work)\b/i,
      /\b(check|show|list)\s+(git\s+)?(status|diff|branch|branches|log|commits|remotes?)\b/i,
      /\b(gitlab|github)\s+(repo|repository|remote|branch|commit|pull|push)\b/i,
    ],
  },
  {
    intent: PromptIntent.EditProject,
    patterns: [
      /\b(edit|fix|update|refactor|rewrite|improve|change)\b[\s\S]*\b(this|current)\s+project\b/i,
      /\b(refactor|improve|update)\s+project\b/i,
      /\b(create|add|generate|write)\b[\s\S]*\b(new\s+)?(file|files|folder|folders|directory|directories|readme|documentation|instructions?)\b/i,
    ],
  },
  {
    intent: PromptIntent.EditFile,
    patterns: [
      /\b(edit|fix|update|refactor|rewrite|improve|change)\b[\s\S]*\b(this|current|active)\s+file\b/i,
      /\b(edit|fix|update|refactor|rewrite)\s+file\b/i,
      /\b(create|add|write)\b[\s\S]*\b(this|current|active)\s+file\b/i,
    ],
  },
  {
    intent: PromptIntent.AnalyzeProject,
    patterns: [
      /\b(analy[sz]e|review|summari[sz]e|explain)\b[\s\S]*\b(this|current)\s+project\b/i,
      /\b(analy[sz]e|review|summari[sz]e|explain)\s+project\b/i,
    ],
  },
  {
    intent: PromptIntent.AnalyzeFile,
    patterns: [
      /\b(analy[sz]e|review|explain)\b[\s\S]*\b(this|current|active)\s+file\b/i,
      /\b(analy[sz]e|review|explain)\s+file\b/i,
    ],
  },
];

export function classifyPromptIntent(prompt: string): PromptIntent {
  const normalized = prompt.trim();
  if (CONVERSATIONAL_OR_CASUAL_INTENT.test(normalized)) {
    return PromptIntent.General;
  }

  for (const rule of INTENT_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.intent;
    }
  }

  return PromptIntent.General;
}
