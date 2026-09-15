import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveModelProfile } from './ModelProfiles';

test('uses no-tool strategy for deepseek without tool capability', () => {
  const profile = resolveModelProfile('deepseek-v2:16b', ['completion']);
  assert.equal(profile.family, 'deepseek');
  assert.equal(profile.toolProtocol, 'none');
  assert.equal(profile.supportsTools, false);
});

test('uses native strategy for supported qwen, gemma, and llama models', () => {
  for (const model of ['qwen2.5-coder:7b', 'gemma3:4b', 'llama3.1:8b']) {
    const profile = resolveModelProfile(model, ['completion', 'tools']);
    assert.equal(profile.toolProtocol, 'native');
    assert.equal(profile.supportsTools, true);
  }
});

test('defaults unknown tool-capable models to the Ollama native protocol', () => {
  const profile = resolveModelProfile('custom-model:latest', ['tools']);
  assert.equal(profile.family, 'generic');
  assert.equal(profile.toolProtocol, 'native');
});
