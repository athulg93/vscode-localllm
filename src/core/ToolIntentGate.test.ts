import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldUseWorkspaceTools } from './ToolIntentGate';

test('does not use workspace tools for greetings or empty prompts', () => {
  assert.equal(shouldUseWorkspaceTools('hey wassup'), false);
  assert.equal(shouldUseWorkspaceTools(''), false);
});

test('uses workspace tools for code and workspace requests', () => {
  assert.equal(shouldUseWorkspaceTools('explain this function'), true);
  assert.equal(shouldUseWorkspaceTools('find the authentication implementation'), true);
  assert.equal(shouldUseWorkspaceTools('fix the current file'), true);
});
