import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTextToolCall, parseXmlToolCall } from './TextToolCallParser';

test('parses a single JSON object tool call', () => {
  const result = parseTextToolCall('{"name":"read_file","arguments":{"path":"src/a.ts"}}');
  assert.equal(result.length, 1);
  assert.equal(result[0].function.name, 'read_file');
  assert.deepEqual(result[0].function.arguments, { path: 'src/a.ts' });
});

test('strips markdown code fences before parsing', () => {
  const result = parseTextToolCall('```json\n{"name":"read_file","arguments":{"path":"src/a.ts"}}\n```');
  assert.equal(result.length, 1);
  assert.equal(result[0].function.name, 'read_file');
});

test('parses a JSON array of tool calls', () => {
  const result = parseTextToolCall('[{"name":"a","arguments":{}},{"name":"b","arguments":{"x":1}}]');
  assert.equal(result.length, 2);
  assert.equal(result[0].function.name, 'a');
  assert.equal(result[1].function.name, 'b');
});

test('falls back to parsing one JSON object per line', () => {
  const content = '{"name":"a","arguments":{}}\nsome commentary\n{"name":"b","arguments":{"x":1}}';
  const result = parseTextToolCall(content);
  assert.equal(result.length, 2);
});

test('ignores candidates missing a name or arguments object', () => {
  assert.deepEqual(parseTextToolCall('{"name":"a"}'), []);
  assert.deepEqual(parseTextToolCall('{"arguments":{}}'), []);
  assert.deepEqual(parseTextToolCall('{"name":"a","arguments":[1,2]}'), []);
});

test('returns an empty array for empty or plain-text content', () => {
  assert.deepEqual(parseTextToolCall(undefined), []);
  assert.deepEqual(parseTextToolCall(''), []);
  assert.deepEqual(parseTextToolCall('Just a normal answer, no tool call here.'), []);
});

test('parses XML-style tool calls with JSON arguments', () => {
  const result = parseXmlToolCall('<tool_call><name>read_file</name><arguments>{"path":"src/a.ts"}</arguments></tool_call>');
  assert.equal(result.length, 1);
  assert.equal(result[0].function.name, 'read_file');
  assert.deepEqual(result[0].function.arguments, { path: 'src/a.ts' });
});
