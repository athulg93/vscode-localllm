import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boundConversationHistory, isConversationResetRequest } from './ConversationHistory';

test('recognizes explicit requests to start without prior conversation context', () => {
  assert.equal(isConversationResetRequest('start a new convo'), true);
  assert.equal(isConversationResetRequest('please clean the cache and start fresh'), true);
  assert.equal(isConversationResetRequest('help me review the git changes'), false);
});

test('keeps the newest messages when the history exceeds the message limit', () => {
  const result = boundConversationHistory([
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' },
    { role: 'user', content: 'three' },
  ], { maxMessages: 2 });

  assert.deepEqual(result, [
    { role: 'assistant', content: '[Earlier conversation was omitted because the context limit was reached. Continue using the recent conversation below.]' },
    { role: 'assistant', content: 'two' },
    { role: 'user', content: 'three' },
  ]);
});

test('keeps the newest messages under the character limit', () => {
  const result = boundConversationHistory([
    { role: 'user', content: 'old context' },
    { role: 'assistant', content: 'recent context' },
  ], { maxChars: 15 });

  assert.equal(result.at(-1)?.content, 'recent context');
  assert.match(result[0].content, /Earlier conversation was omitted/);
});

test('does not add a marker when all history fits', () => {
  const result = boundConversationHistory([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ]);

  assert.deepEqual(result, [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ]);
});