import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NdjsonParseError, consumeNdjsonBuffer } from './NdjsonStream';

test('consumes complete lines and holds back a trailing partial line', () => {
  const buffer = '{"message":{"content":"a"}}\n{"message":{"content":"b"}}\n{"message":{"content":"c"';
  const result = consumeNdjsonBuffer(buffer);
  assert.equal(result.chunks.length, 2);
  assert.equal(result.chunks[0].message?.content, 'a');
  assert.equal(result.chunks[1].message?.content, 'b');
  assert.equal(result.remaining, '{"message":{"content":"c"');
});

test('skips blank lines between chunks', () => {
  const buffer = '{"message":{"content":"a"}}\n\n{"message":{"content":"b"}}\n';
  const result = consumeNdjsonBuffer(buffer);
  assert.equal(result.chunks.length, 2);
  assert.equal(result.remaining, '');
});

test('flush parses a final line with no trailing newline', () => {
  const result = consumeNdjsonBuffer('{"message":{"content":"tail"}}', true);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].message?.content, 'tail');
  assert.equal(result.remaining, '');
});

test('flush with an empty buffer returns no chunks', () => {
  const result = consumeNdjsonBuffer('', true);
  assert.equal(result.chunks.length, 0);
});

test('throws NdjsonParseError with the offending line on malformed JSON', () => {
  assert.throws(
    () => consumeNdjsonBuffer('{"message":{"content":"a"}}\nnot json\n'),
    (error: unknown) => {
      assert.ok(error instanceof NdjsonParseError);
      assert.equal(error.rawLine, 'not json');
      assert.equal(error.isTailChunk, false);
      return true;
    },
  );
});

test('throws NdjsonParseError for a malformed line encountered during flush', () => {
  // Note: a lone malformed line is caught by the main per-line loop before the
  // tail-specific re-parse runs, so isTailChunk is false here. The tail path
  // only re-triggers when the main loop found no error on an already-parsed
  // buffer; in real usage the flush buffer contains at most one line, so this
  // does not affect behavior, only which log message is used.
  assert.throws(
    () => consumeNdjsonBuffer('not json', true),
    (error: unknown) => {
      assert.ok(error instanceof NdjsonParseError);
      assert.equal(error.isTailChunk, false);
      return true;
    },
  );
});
