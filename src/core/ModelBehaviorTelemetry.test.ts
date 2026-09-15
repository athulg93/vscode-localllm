import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ModelBehaviorStats, ModelBehaviorTelemetry, ModelBehaviorStorage } from './ModelBehaviorTelemetry';

class MemoryStorage implements ModelBehaviorStorage {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string, defaultValue: T): T {
    return (this.values.get(key) as T | undefined) ?? defaultValue;
  }

  update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

test('persists per-model event counters and timestamps', async () => {
  const telemetry = new ModelBehaviorTelemetry(new MemoryStorage());
  await telemetry.record('llama3.1:8b', 'parseFailures');
  await telemetry.record('llama3.1:8b', 'toolCalls');

  const stats = telemetry.get('llama3.1:8b');
  assert.equal(stats.parseFailures, 1);
  assert.equal(stats.toolCalls, 1);
  assert.equal(typeof stats.lastUsedAt, 'string');
});

test('returns proactive warnings for repeated model problems', async () => {
  const telemetry = new ModelBehaviorTelemetry(new MemoryStorage());
  for (let index = 0; index < 3; index += 1) {
    await telemetry.record('qwen2.5:7b', 'parseFailures');
  }

  assert.match(telemetry.warning('qwen2.5:7b') ?? '', /parsing failures/);
  assert.equal(telemetry.warning('other-model'), undefined);
});

test('returns zeroed stats for an unseen model', () => {
  const telemetry = new ModelBehaviorTelemetry(new MemoryStorage());
  const stats: ModelBehaviorStats = telemetry.get('new-model');
  assert.equal(stats.toolRequests, 0);
  assert.equal(stats.loopIncidents, 0);
});
