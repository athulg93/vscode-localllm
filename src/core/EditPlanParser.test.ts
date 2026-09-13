import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractJsonBlock, parseEditPlan } from './EditPlanParser';

test('extractJsonBlock returns an already-clean JSON object as-is', () => {
  assert.equal(extractJsonBlock('{"summary":"ok"}'), '{"summary":"ok"}');
});

test('extractJsonBlock strips markdown code fences', () => {
  const raw = '```json\n{"summary":"ok"}\n```';
  assert.equal(extractJsonBlock(raw), '{"summary":"ok"}');
});

test('extractJsonBlock extracts the first balanced-looking object from surrounding prose', () => {
  const raw = 'Here you go:\n{"summary":"ok"}\nHope that helps!';
  assert.equal(extractJsonBlock(raw), '{"summary":"ok"}');
});

test('extractJsonBlock returns the trimmed input when no JSON object is found', () => {
  assert.equal(extractJsonBlock('  not json  '), 'not json');
});

test('parseEditPlan parses a valid edit plan', () => {
  const plan = parseEditPlan('{"summary":"Add logging","edits":[{"operation":"update","path":"src/a.ts","content":"x"}]}');
  assert.equal(plan.summary, 'Add logging');
  assert.equal(plan.edits?.length, 1);
  assert.equal(plan.edits?.[0].operation, 'update');
  assert.equal(plan.edits?.[0].path, 'src/a.ts');
});

test('parseEditPlan throws on malformed JSON', () => {
  assert.throws(() => parseEditPlan('not json at all and no braces'));
});
