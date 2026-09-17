import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyPromptIntent } from './PromptIntentClassifier';
import { PromptIntent } from '../types';

test('classifies edit requests scoped to the current file', () => {
  assert.equal(classifyPromptIntent('edit this file to add logging'), PromptIntent.EditFile);
  assert.equal(classifyPromptIntent('fix the current file'), PromptIntent.EditFile);
});

test('classifies edit/create requests scoped to the whole project', () => {
  assert.equal(classifyPromptIntent('refactor this project to simplify validation'), PromptIntent.EditProject);
  assert.equal(classifyPromptIntent('create a new file called utils.ts'), PromptIntent.EditProject);
});

test('classifies analysis requests scoped to the current file', () => {
  assert.equal(classifyPromptIntent('explain this file'), PromptIntent.AnalyzeFile);
  assert.equal(classifyPromptIntent('review file for bugs'), PromptIntent.AnalyzeFile);
});

test('classifies analysis requests scoped to the whole project', () => {
  assert.equal(classifyPromptIntent('summarize this project'), PromptIntent.AnalyzeProject);
});

test('classifies git transaction requests', () => {
  assert.equal(classifyPromptIntent('pull latest changes from origin'), PromptIntent.GitTransaction);
  assert.equal(classifyPromptIntent('push this branch to github'), PromptIntent.GitTransaction);
  assert.equal(classifyPromptIntent('push this branch to gitlab'), PromptIntent.GitTransaction);
  assert.equal(classifyPromptIntent('sync latest changes from gitlab'), PromptIntent.GitTransaction);
  assert.equal(classifyPromptIntent('/git-push origin main'), PromptIntent.GitTransaction);
  assert.equal(classifyPromptIntent('/git-merge feature-branch'), PromptIntent.GitTransaction);
  assert.equal(classifyPromptIntent('/git-remote'), PromptIntent.GitTransaction);
  assert.equal(classifyPromptIntent('git status'), PromptIntent.GitTransaction);
  assert.equal(classifyPromptIntent('check git diff'), PromptIntent.GitTransaction);
  assert.equal(classifyPromptIntent('commit changes with message "fix bug"'), PromptIntent.GitTransaction);
});

test('falls back to general intent when no pattern matches', () => {
  assert.equal(classifyPromptIntent('what is the capital of France?'), PromptIntent.General);
  assert.equal(classifyPromptIntent('hey how are you'), PromptIntent.General);
  assert.equal(classifyPromptIntent('hello'), PromptIntent.General);
});
