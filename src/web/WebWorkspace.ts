import {
  MAX_TOOL_RESULTS,
  MAX_TOOL_SEARCH_MATCHES,
  PROTECTED_FILE_NAMES,
  PROTECTED_PATH_SEGMENTS,
  TEXT_FILE_EXTENSIONS,
} from '../constants';
import { ToolDefinition } from '../core/contracts';
import { INITIAL_WORKSPACE_FILES } from './sampleWorkspace';
import { globalActivityTracker } from '../core/ActivityTracker';

export interface WorkspaceFileEntry {
  path: string;
  content: string;
}

export class WebWorkspace {
  private files: Map<string, string>;

  constructor(initialFiles: Record<string, string> = INITIAL_WORKSPACE_FILES) {
    this.files = new Map();
    for (const [path, content] of Object.entries(initialFiles)) {
      this.files.set(this.normalizePath(path), content);
    }
  }

  normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  }

  getAllFiles(): WorkspaceFileEntry[] {
    return Array.from(this.files.entries())
      .map(([path, content]) => ({ path, content }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getFile(path: string): string | undefined {
    return this.files.get(this.normalizePath(path));
  }

  hasFile(path: string): boolean {
    return this.files.has(this.normalizePath(path));
  }

  setFile(path: string, content: string): void {
    this.files.set(this.normalizePath(path), content);
  }

  deleteFile(path: string): boolean {
    return this.files.delete(this.normalizePath(path));
  }

  renameFile(oldPath: string, newPath: string): boolean {
    const normOld = this.normalizePath(oldPath);
    const normNew = this.normalizePath(newPath);
    const content = this.files.get(normOld);
    if (content === undefined || this.files.has(normNew)) {
      return false;
    }
    this.files.delete(normOld);
    this.files.set(normNew, content);
    return true;
  }

  reset(): void {
    this.files.clear();
    for (const [path, content] of Object.entries(INITIAL_WORKSPACE_FILES)) {
      this.files.set(this.normalizePath(path), content);
    }
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'list_workspace_files',
        description: 'List bounded workspace-relative text-file paths. Use this to discover likely files before reading them.',
        parameters: {
          type: 'object',
          properties: {
            pathPrefix: { type: 'string', description: 'Optional workspace-relative folder or path prefix.' },
            maxResults: { type: 'integer', minimum: 1, maximum: 40, description: 'Maximum paths to return.' },
          },
        },
      },
      {
        name: 'search_workspace',
        description: 'Search bounded text files for a literal string and return matching paths and line numbers. Use this to find symbols, errors, or related code.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Literal text to search for.' },
            pathPrefix: { type: 'string', description: 'Optional workspace-relative folder or path prefix.' },
            maxResults: { type: 'integer', minimum: 1, maximum: 40, description: 'Maximum matches to return.' },
          },
          required: ['query'],
        },
      },
      {
        name: 'read_file',
        description: 'Read a bounded line range from a text file in the current workspace. Use this before proposing updates to an existing file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative file path.' },
            startLine: { type: 'integer', minimum: 1, description: 'First line to read, inclusive.' },
            endLine: { type: 'integer', minimum: 1, description: 'Last line to read, inclusive. Maximum 240 lines.' },
          },
          required: ['path'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const startTime = Date.now();
    let result: string;
    if (name === 'list_workspace_files') {
      result = this.listWorkspaceFiles(args);
    } else if (name === 'search_workspace') {
      result = this.searchWorkspace(args);
    } else if (name === 'read_file') {
      result = this.readFile(args);
    } else {
      result = JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    const hasError = result.includes('"error":');
    globalActivityTracker.recordDirectToolCall(
      name,
      args,
      durationMs,
      hasError ? 'error' : 'success'
    );

    if (name === 'read_file' && !hasError) {
      try {
        const parsed = JSON.parse(result);
        const lines = (parsed.content || '').split('\n');
        globalActivityTracker.recordFileRead({
          path: parsed.path,
          startLine: parsed.startLine,
          endLine: parsed.endLine,
          lineCount: lines.length,
          charCount: (parsed.content || '').length,
          snippet: lines.slice(0, 3).join('\n'),
        });
      } catch {
        // ignore parse error
      }
    }

    return result;
  }

  private listWorkspaceFiles(args: Record<string, unknown>): string {
    const rawPrefix = typeof args.pathPrefix === 'string' ? args.pathPrefix : '';
    const prefix = this.normalizePath(rawPrefix);
    const maxResults = typeof args.maxResults === 'number' ? Math.min(args.maxResults, MAX_TOOL_RESULTS) : MAX_TOOL_RESULTS;

    const allPaths = Array.from(this.files.keys());
    const matched = allPaths.filter((p) => {
      if (!this.isSafePath(p)) return false;
      if (!prefix) return true;
      return p === prefix || p.startsWith(prefix + '/');
    }).slice(0, maxResults);

    return JSON.stringify({ pathPrefix: prefix || undefined, paths: matched });
  }

  private searchWorkspace(args: Record<string, unknown>): string {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return JSON.stringify({ error: 'Search query is required.' });
    }

    const rawPrefix = typeof args.pathPrefix === 'string' ? args.pathPrefix : '';
    const prefix = this.normalizePath(rawPrefix);
    const maxResults = typeof args.maxResults === 'number' ? Math.min(args.maxResults, MAX_TOOL_SEARCH_MATCHES) : MAX_TOOL_SEARCH_MATCHES;

    const matches: Array<{ path: string; line: number; text: string }> = [];

    for (const [path, content] of this.files.entries()) {
      if (!this.isSafePath(path)) continue;
      if (prefix && path !== prefix && !path.startsWith(prefix + '/')) continue;

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(query.toLowerCase())) {
          matches.push({
            path,
            line: i + 1,
            text: lines[i].trim().slice(0, 240),
          });
          if (matches.length >= maxResults) {
            return JSON.stringify({ query, matches });
          }
        }
      }
    }

    return JSON.stringify({ query, matches });
  }

  private readFile(args: Record<string, unknown>): string {
    const path = typeof args.path === 'string' ? this.normalizePath(args.path) : '';
    if (!path || !this.isSafePath(path)) {
      return JSON.stringify({ error: 'Path is not allowed or outside workspace bounds.' });
    }

    const content = this.files.get(path);
    if (content === undefined) {
      return JSON.stringify({ error: `File not found: ${path}` });
    }

    const lines = content.split(/\r?\n/);
    const startLine = typeof args.startLine === 'number' && args.startLine > 0 ? args.startLine : 1;
    const maxLines = 240;
    const requestedEnd = typeof args.endLine === 'number' && args.endLine >= startLine ? args.endLine : startLine + maxLines - 1;
    const endLine = Math.min(requestedEnd, startLine + maxLines - 1, lines.length);

    const slice = lines.slice(startLine - 1, endLine).join('\n');
    return JSON.stringify({ path, startLine, endLine, content: slice });
  }

  isSafePath(path: string): boolean {
    const normalized = this.normalizePath(path);
    const segments = normalized.split('/');
    if (segments.includes('..') || normalized.startsWith('/') || /[*?[\]{}]/.test(normalized)) {
      return false;
    }
    const fileName = segments[segments.length - 1];
    if (PROTECTED_FILE_NAMES.has(fileName) || fileName.startsWith('.')) {
      return false;
    }
    if (segments.some((seg) => PROTECTED_PATH_SEGMENTS.has(seg))) {
      return false;
    }
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop()?.toLowerCase() : '';
    return ext === '' || TEXT_FILE_EXTENSIONS.has(ext);
  }
}
