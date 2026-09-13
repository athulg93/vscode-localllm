const WORKSPACE_INTENT = /\b(this|current|active|workspace|project|repository|repo|folder|file|code|function|class|module|component|error|bug|issue|implementation|implement|analy[sz]e|review|explain|summari[sz]e|edit|fix|refactor|rewrite|change|update|create|add|delete|rename|move)\b/i;
const NON_WORKSPACE_INTENT = /^(?:hi|hello|hey|yo|how are you|what'?s up|good morning|good afternoon|good evening|thanks|thank you|who are you)[.!?\s]*$/i;

export function shouldUseWorkspaceTools(prompt: string): boolean {
  const normalized = prompt.trim();
  if (!normalized || NON_WORKSPACE_INTENT.test(normalized)) {
    return false;
  }

  return WORKSPACE_INTENT.test(normalized);
}
