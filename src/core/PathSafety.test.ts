import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getFileExtension,
  isProtectedPath,
  isSafeToolReadPath,
  isSafeWorkspacePath,
  isTextSourceExtension,
  normalizeRelativePathPrefix,
} from './PathSafety';

test('isSafeWorkspacePath rejects absolute paths, traversal, and glob characters', () => {
  assert.equal(isSafeWorkspacePath('src/index.ts'), true);
  assert.equal(isSafeWorkspacePath('/etc/passwd'), false);
  assert.equal(isSafeWorkspacePath('../secrets.env'), false);
  assert.equal(isSafeWorkspacePath('src/../../etc/passwd'), false);
  assert.equal(isSafeWorkspacePath('src/*.ts'), false);
});

test('isProtectedPath blocks dotfiles, known lockfiles, and protected directories', () => {
  assert.equal(isProtectedPath('.env'), true);
  assert.equal(isProtectedPath('.env.production'), true);
  assert.equal(isProtectedPath('package-lock.json'), true);
  assert.equal(isProtectedPath('.git/config'), true);
  assert.equal(isProtectedPath('node_modules/foo/index.js'), true);
  assert.equal(isProtectedPath('src/index.ts'), false);
});

test('getFileExtension returns a lowercased extension including the dot', () => {
  assert.equal(getFileExtension('README.MD'), '.md');
  assert.equal(getFileExtension('Makefile'), '');
});

test('isTextSourceExtension recognizes known text/source extensions only', () => {
  assert.equal(isTextSourceExtension('src/index.ts'), true);
  assert.equal(isTextSourceExtension('image.png'), false);
});

test('isSafeToolReadPath requires a safe, non-protected, text-source path', () => {
  assert.equal(isSafeToolReadPath('src/index.ts'), true);
  assert.equal(isSafeToolReadPath('/etc/passwd'), false);
  assert.equal(isSafeToolReadPath('../secrets.ts'), false);
  assert.equal(isSafeToolReadPath('node_modules/foo/index.ts'), false);
  assert.equal(isSafeToolReadPath('src/image.png'), false);
});

test('normalizeRelativePathPrefix passes through a clean relative prefix', () => {
  assert.equal(normalizeRelativePathPrefix('src/services'), 'src/services');
  assert.equal(normalizeRelativePathPrefix('./src/services/'), 'src/services');
});

test('normalizeRelativePathPrefix defaults to empty string when omitted', () => {
  assert.equal(normalizeRelativePathPrefix(undefined), '');
});

test('normalizeRelativePathPrefix rejects unsafe or protected prefixes', () => {
  assert.equal(normalizeRelativePathPrefix('/etc'), undefined);
  assert.equal(normalizeRelativePathPrefix('../secrets'), undefined);
  assert.equal(normalizeRelativePathPrefix('node_modules'), undefined);
  assert.equal(normalizeRelativePathPrefix(42), undefined);
});
