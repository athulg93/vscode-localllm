import { Logger } from '../core/contracts';

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'warn' | 'error' | 'tool' | 'edit';
}

export class WebLogger implements Logger {
  private logs: LogEntry[] = [];
  private listeners: Set<(entry: LogEntry) => void> = new Set();

  appendLine(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    let type: LogEntry['type'] = 'info';
    if (message.includes('[Error]') || message.toLowerCase().includes('failed') || message.toLowerCase().includes('error:')) {
      type = 'error';
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

    this.listeners.forEach((listener) => listener(entry));
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
