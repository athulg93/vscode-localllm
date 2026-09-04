import { PromptIntent } from '../types';

const INTENT_PATTERNS: Array<{ intent: PromptIntent; patterns: RegExp[] }> = [
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
  for (const rule of INTENT_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(prompt))) {
      return rule.intent;
    }
  }

  return PromptIntent.General;
}
