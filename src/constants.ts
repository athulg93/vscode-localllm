export const DEFAULT_BASE_URL = 'http://localhost:11434';
export const DEFAULT_MODEL = 'qwen2.5-coder:7b';
export const DEFAULT_TEMPERATURE = 0.7;

export const MAX_FILE_CHARS = 12_000;
export const MAX_PROJECT_FILES = 25;
export const MAX_PROJECT_TOTAL_CHARS = 100_000;
export const MAX_EDIT_CONTEXT_CHARS = 32_000;
export const OLLAMA_REQUEST_TIMEOUT_MS = 300_000;
export const MAX_CONTEXT_CANDIDATE_FILES = 150;
export const MAX_TARGETED_CONTEXT_FILES = 12;
export const MAX_EDIT_FILES = 10;
export const MAX_APPLY_FILE_CHARS = 40_000;
export const CONTEXT_CACHE_TTL_MS = 60_000;
export const MAX_TOOL_RESULTS = 40;
export const MAX_TOOL_SEARCH_MATCHES = 40;
export const MAX_TOOL_SEARCH_FILE_CHARS = 20_000;
export const DEFAULT_MAX_TOOL_CALLS = 16;
export const MAX_ALLOWED_TOOL_CALLS = 40;
export const GITHUB_RELEASES_API = 'https://api.github.com/repos/athulg93/vscode-localllm/releases/latest';

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

export const EDIT_PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['create', 'update', 'delete', 'rename'] },
          path: { type: 'string' },
          newPath: { type: 'string' },
          content: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['operation', 'path'],
      },
    },
  },
  required: ['edits'],
};

export const CONTEXT_SELECTION_SYSTEM_PROMPT = [
  'You decide what local VS Code context is minimally required to answer a user request.',
  'Return ONLY valid JSON, no markdown fences, no prose.',
  'JSON schema:',
  '{"scope":"none|activeFile|project|paths","paths":["relative/path"],"reason":"short reason"}.',
  'Prefer "paths" over "project" when a small set of files is enough.',
  'Only choose paths from the supplied candidate file list.',
  'If the request references the current file implicitly, choose "activeFile".'
].join(' ');

export const CONTEXT_SELECTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    scope: { type: 'string', enum: ['none', 'activeFile', 'project', 'paths'] },
    paths: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['scope'],
};

export const PROTECTED_PATH_SEGMENTS = new Set([
  '.git', '.github', '.vscode', '.idea', 'node_modules', 'dist', 'build', 'out'
]);

export const PROTECTED_FILE_NAMES = new Set([
  '.env', '.env.local', '.env.development', '.env.production', '.env.test',
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'
]);