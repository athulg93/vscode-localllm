export type ModelBehaviorStats = {
  capabilityChecks: number;
  capabilityFailures: number;
  toolRequests: number;
  toolCalls: number;
  falseTriggers: number;
  parseFailures: number;
  loopIncidents: number;
  lastUsedAt?: string;
};

export type ModelBehaviorStorage = {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
};

const STORAGE_KEY = 'localOllama.modelBehavior';

export class ModelBehaviorTelemetry {
  constructor(private readonly storage: ModelBehaviorStorage) {}

  get(model: string): ModelBehaviorStats {
    const all = this.storage.get<Record<string, ModelBehaviorStats>>(STORAGE_KEY, {});
    return all[model] ?? this.emptyStats();
  }

  async record(model: string, event: keyof Omit<ModelBehaviorStats, 'lastUsedAt'>): Promise<void> {
    const all = this.storage.get<Record<string, ModelBehaviorStats>>(STORAGE_KEY, {});
    const stats = all[model] ?? this.emptyStats();
    stats[event] += 1;
    stats.lastUsedAt = new Date().toISOString();
    await this.storage.update(STORAGE_KEY, { ...all, [model]: stats });
  }

  async touch(model: string): Promise<void> {
    const all = this.storage.get<Record<string, ModelBehaviorStats>>(STORAGE_KEY, {});
    const stats = all[model] ?? this.emptyStats();
    stats.lastUsedAt = new Date().toISOString();
    await this.storage.update(STORAGE_KEY, { ...all, [model]: stats });
  }

  warning(model: string): string | undefined {
    const stats = this.get(model);
    if (stats.parseFailures >= 3) {
      return `This model has had ${stats.parseFailures} tool-response parsing failures.`;
    }
    if (stats.loopIncidents >= 2) {
      return `This model has reached the tool-call limit ${stats.loopIncidents} times.`;
    }
    if (stats.falseTriggers >= 3) {
      return `This model has triggered workspace tools unexpectedly ${stats.falseTriggers} times.`;
    }
    return undefined;
  }

  private emptyStats(): ModelBehaviorStats {
    return {
      capabilityChecks: 0,
      capabilityFailures: 0,
      toolRequests: 0,
      toolCalls: 0,
      falseTriggers: 0,
      parseFailures: 0,
      loopIncidents: 0,
    };
  }
}
