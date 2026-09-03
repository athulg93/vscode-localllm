export const DEFAULT_BASE_URL = 'http://localhost:11434';
export const DEFAULT_MODEL = 'llama3.1';
export const DEFAULT_TEMPERATURE = 0.7;

export const MAX_FILE_CHARS = 12_000;
export const MAX_PROJECT_FILES = 25;
export const MAX_PROJECT_TOTAL_CHARS = 100_000;
export const MAX_CONTEXT_CANDIDATE_FILES = 150;
export const MAX_TARGETED_CONTEXT_FILES = 12;
export const MAX_EDIT_FILES = 10;
export const MAX_APPLY_FILE_CHARS = 40_000;
export const CONTEXT_CACHE_TTL_MS = 60_000;

export const PROJECT_EXCLUDE_GLOB = '**/{node_modules,.git,dist,out,build,.next,.turbo,.cache}/**';

export const TEXT_FILE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.yml', '.yaml',
  '.py', '.java', '.go', '.rs', '.cs', '.cpp', '.c', '.h', '.hpp', '.css', '.scss', '.html', '.xml', '.sh'
]);

export const HUMAN_READABLE_SYSTEM_PROMPT = [
  'You are a senior coding assistant operating inside VS Code.',
  'Always respond in clear, human-readable markdown.',
  'Prefer concise structure with short headings and practical steps.',
  'If asked to analyze code, explain what it does, risks, and next improvements.',
  'Do not return raw JSON unless explicitly asked.'
].join(' ');

export const EDIT_PLAN_SYSTEM_PROMPT = [
  'You are a coding assistant that proposes concrete file edits.',
  'Return ONLY valid JSON, no markdown fences, no prose.',
  'JSON schema:',
  '{"summary":"short summary","edits":[{"operation":"create|update|delete|rename","path":"relative/path","newPath":"relative/path for rename","content":"full file content for create/update","summary":"why"}]}.',
  'Prefer editing files provided in context. You may propose new files when the user explicitly asks to create them.',
  'Use operation=create for new files, update for modifying file contents, delete for removal, and rename for path moves.',
  'For delete, omit content. For rename, provide newPath and omit content unless the user asked for both rename and content changes.',
  'Any new file path must be workspace-relative and must not use .. segments.',
  'Preserve existing style and indentation.',
  `Return at most ${MAX_EDIT_FILES} edits.`
].join(' ');

export const CONTEXT_SELECTION_SYSTEM_PROMPT = [
  'You decide what local VS Code context is minimally required to answer a user request.',
  'Return ONLY valid JSON, no markdown fences, no prose.',
  'JSON schema:',
  '{"scope":"none|activeFile|project|paths","paths":["relative/path"],"reason":"short reason"}.',
  'Prefer "paths" over "project" when a small set of files is enough.',
  'Only choose paths from the supplied candidate file list.',
  'If the request references the current file implicitly, choose "activeFile".'
].join(' ');

export const PROTECTED_PATH_SEGMENTS = new Set([
  '.git', '.github', '.vscode', '.idea', 'node_modules', 'dist', 'build', 'out'
]);

export const PROTECTED_FILE_NAMES = new Set([
  '.env', '.env.local', '.env.development', '.env.production', '.env.test',
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'
]);