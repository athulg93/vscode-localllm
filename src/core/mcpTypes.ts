export type McpTransportType = 'stdio' | 'sse';

export interface McpServerStdioConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputLength?: number;
  autoRestart?: boolean;
  disabledTools?: string[];
  toolPrefix?: string;
}

export interface McpServerSseConfig {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxOutputLength?: number;
  disabledTools?: string[];
  toolPrefix?: string;
}

export type McpServerConfig = McpServerStdioConfig | McpServerSseConfig;

export function isSseConfig(config: McpServerConfig): config is McpServerSseConfig {
  return 'url' in config && typeof (config as McpServerSseConfig).url === 'string';
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: Record<string, unknown>;
  default?: unknown;
}

export interface McpToolInputSchema {
  type: 'object';
  properties?: Record<string, McpToolParameterProperty>;
  required?: string[];
  description?: string;
}

export interface McpDiscoveredTool {
  serverName: string;
  originalName: string;
  name: string; // Namespaced or prefixed name exposed to the LLM
  description: string;
  inputSchema: McpToolInputSchema;
  isEnabled: boolean;
  estimatedTokens: number;
}

export type McpServerStatus = 'connected' | 'connecting' | 'stopped' | 'error' | 'reconnecting';

export interface McpServerState {
  name: string;
  transport: McpTransportType;
  status: McpServerStatus;
  tools: McpDiscoveredTool[];
  lastError?: string;
  pid?: number;
  lastConnectedAt?: number;
  restartCount: number;
}

export interface McpToolInvocationResult {
  success: boolean;
  output: string;
  durationMs: number;
  truncated: boolean;
  error?: string;
}

export interface McpContextBudgetReport {
  totalEstimatedTokens: number;
  toolCount: number;
  isOverBudget: boolean;
  maxRecommendedTokens: number;
  warningMessage?: string;
}
