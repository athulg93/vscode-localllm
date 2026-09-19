import { Logger } from '../core/contracts';

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'warn' | 'error' | 'tool' | 'edit' | 'summary';
}

export class WebLogger implements Logger {
  private logs: LogEntry[] = [];
  private summaryLogs: LogEntry[] = [];
  private listeners: Set<(entry: LogEntry) => void> = new Set();

  appendLine(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    let type: LogEntry['type'] = 'info';
    if (message.includes('[Error]') || message.toLowerCase().includes('failed') || message.toLowerCase().includes('error:')) {
      type = 'error';
    } else if (message.includes('[SUMMARY]') || message.startsWith('[SUMMARY]')) {
      type = 'summary';
    } else if (message.includes('[Tool]') || message.includes('FILE TOOL RESULT') || message.includes('Reading workspace')) {
      type = 'tool';
    } else if (message.includes('[Edit]')) {
      type = 'edit';
    } else if (message.includes('[Warn]')) {
      type = 'warn';
    }

    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp,
      message,
      type,
    };

    this.logs.push(entry);
    if (this.logs.length > 500) {
      this.logs.shift();
    }

    if (type === 'summary' || this.isSummaryCandidate(message)) {
      this.summaryLogs.push({ ...entry, type: 'summary' });
      if (this.summaryLogs.length > 200) {
        this.summaryLogs.shift();
      }
    }

    this.listeners.forEach((listener) => listener(entry));
  }

  appendSummary(headline: string, metricsOverview?: string): void {
    const summaryMsg = `[SUMMARY] ${headline}${metricsOverview ? ` — ${metricsOverview}` : ''}`;
    this.appendLine(summaryMsg);
  }

  private isSummaryCandidate(message: string): boolean {
    return (
      message.startsWith('[Lifecycle]') ||
      message.startsWith('[Session]') ||
      message.startsWith('[SUMMARY]') ||
      message.startsWith('[Chat] Request started') ||
      message.startsWith('[Ollama] Stream completed') ||
      message.startsWith('[Ollama] Agent loop completed') ||
      message.startsWith('[EditPlan]')
    );
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getSummaryLogs(): LogEntry[] {
    return [...this.summaryLogs];
  }

  clear(): void {
    this.logs = [];
    this.summaryLogs = [];
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
