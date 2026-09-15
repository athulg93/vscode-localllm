import { PROTECTED_FILE_NAMES, PROTECTED_PATH_SEGMENTS, TEXT_FILE_EXTENSIONS } from '../constants';

/**
 * Path-safety checks used by the file-editing and workspace-exploration workflows.
 * These are pure string checks with no VS Code or Node dependency so they can be
 * unit tested directly.
 *
 * Note: `isSafeWorkspacePath` and `isSafeToolReadPath` intentionally use slightly
 * different traversal checks (substring vs. path-segment) and disallowed-character
 * sets, mirroring the pre-existing behavior of the callers they were extracted
 * from (EditorManager and ContextManager, respectively). Harmonizing them is a
 * follow-up, not a behavior change made here.
 */

/** Used by EditorManager to validate proposed create/update/delete/rename paths. */
export function isSafeWorkspacePath(pathLike: string): boolean {
  return !pathLike.startsWith('/')
    && !pathLike.includes('..')
    && !/[*?[\]{}!]/.test(pathLike);
}

/** Used by EditorManager to block edits to sensitive files and directories. */
export function isProtectedPath(pathLike: string): boolean {
  const segments = pathLike.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? '';

  if (fileName.startsWith('.')) {
    return true;
  }

  if (PROTECTED_FILE_NAMES.has(fileName)) {
    return true;
  }

  if (/^\.env(\..+)?$/.test(fileName)) {
    return true;
  }

  return segments.some((segment) => segment.startsWith('.') || PROTECTED_PATH_SEGMENTS.has(segment));
}

export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

export function isTextSourceExtension(fileName: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(getFileExtension(fileName));
}

/** Used by ContextManager's read_file tool to validate a model-supplied path. */
export function isSafeToolReadPath(pathLike: string): boolean {
  const segments = pathLike.split('/');
  return !pathLike.startsWith('/')
    && !segments.includes('..')
    && !segments.some((segment) => PROTECTED_PATH_SEGMENTS.has(segment))
    && !/[*?[\]{}]/.test(pathLike)
    && isTextSourceExtension(pathLike);
}

/** Used by ContextManager's list/search tools to validate a model-supplied folder prefix. */
export function normalizeRelativePathPrefix(value: unknown): string | undefined {
  if (value === undefined) {
    return '';
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('/') || normalized.split('/').includes('..') || /[*?[\]{}!]/.test(normalized)) {
    return undefined;
  }

  const segments = normalized.split('/');
  return segments.some((segment) => PROTECTED_PATH_SEGMENTS.has(segment)) ? undefined : normalized;
}
