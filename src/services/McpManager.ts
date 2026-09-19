import {
  McpConfigFile,
  McpServerConfig,
  McpServerState,
  McpDiscoveredTool,
  McpToolInvocationResult,
  McpContextBudgetReport,
  isSseConfig,
  McpServerStdioConfig,
  McpServerSseConfig,
} from '../core/mcpTypes';
import { Logger, ToolDefinition, CancellationLike } from '../core/contracts';
import { ActivityTracker } from '../core/ActivityTracker';

interface McpProcessHandle {
  kill: () => void;
  stdin: { write: (data: string) => void };
  pid?: number;
}

export class McpManager {
  private servers: Map<string, McpServerState> = new Map();
  private configs: Map<string, McpServerConfig> = new Map();
  private activeProcesses: Map<string, McpProcessHandle> = new Map();
  private pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: any }> = new Map();
  private listeners: Set<() => void> = new Set();
  private isDisposed = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: Logger,
    private readonly activityTracker?: ActivityTracker,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('Error in McpManager listener:', err);
      }
    }
  }

  getServerStates(): McpServerState[] {
    return Array.from(this.servers.values());
  }

  /**
   * Load or reload MCP servers from a parsed configuration file.
   */
  async loadConfig(config: McpConfigFile): Promise<void> {
    this.logger.appendLine(`[MCP] Loading configuration with ${Object.keys(config.mcpServers || {}).length} server(s)...`);

    // Stop servers that are no longer in config
    for (const serverName of Array.from(this.servers.keys())) {
      if (!config.mcpServers || !config.mcpServers[serverName]) {
        await this.stopServer(serverName);
        this.servers.delete(serverName);
        this.configs.delete(serverName);
      }
    }

    if (!config.mcpServers) {
      this.notify();
      return;
    }

    // Connect or update configured servers
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      this.configs.set(name, serverConfig);
      await this.startServer(name, serverConfig);
    }

    this.notify();
  }

  /**
   * Start or restart an individual MCP server.
   */
  async startServer(name: string, config: McpServerConfig): Promise<void> {
    // Teardown existing instance if running
    await this.stopServer(name);

    const transport = isSseConfig(config) ? 'sse' : 'stdio';
    const state: McpServerState = {
      name,
      transport,
      status: 'connecting',
      tools: [],
      restartCount: 0,
    };
    this.servers.set(name, state);
    this.notify();

    try {
      if (isSseConfig(config)) {
        await this.connectSse(name, config);
      } else {
        await this.connectStdio(name, config);
      }
    } catch (err: any) {
      state.status = 'error';
      state.lastError = err.message || String(err);
      this.logger.appendLine(`[MCP] Failed to connect server "${name}": ${state.lastError}`);
      this.notify();
    }
  }

  private async connectStdio(name: string, config: McpServerStdioConfig): Promise<void> {
    const state = this.servers.get(name);
    if (!state) return;

    this.logger.appendLine(`[MCP] Spawning stdio server "${name}": ${config.command} ${(config.args || []).join(' ')}`);

    // In a browser/web-worker environment, we support simulated or bridge mode.
    // In Node.js / VS Code runtime, we dynamically invoke child_process.spawn.
    let childProcessModule: any = null;
    try {
      // Dynamic import to prevent bundler errors in browser/vite preview
      if (typeof process !== 'undefined' && process.versions && (process.versions as any).node) {
        childProcessModule = await import('child_process');
      }
    } catch {
      childProcessModule = null;
    }

    if (!childProcessModule) {
      // Running inside web preview without native child_process
      this.simulateOrRegisterBrowserServer(name, config);
      return;
    }

    const { spawn } = childProcessModule;
    const cwd = config.cwd ? config.cwd.replace('${workspaceFolder}', this.workspaceRoot) : this.workspaceRoot;
    const env = { ...process.env, ...(config.env || {}) };

    let child: any;
    try {
      child = spawn(config.command, config.args || [], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (spawnErr: any) {
      state.status = 'error';
      state.lastError = `Failed to spawn "${config.command}": ${spawnErr.message || spawnErr}`;
      this.notify();
      return;
    }

    state.pid = child.pid;
    this.activeProcesses.set(name, {
      kill: () => {
        try {
          child.kill('SIGTERM');
        } catch {}
      },
      stdin: child.stdin,
      pid: child.pid,
    });

    let stdoutBuffer = '';
    child.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString('utf8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          this.handleJsonRpcMessage(name, line.trim());
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const msg = data.toString('utf8').trim();
      if (msg) {
        this.logger.appendLine(`[MCP:${name}:stderr] ${msg}`);
      }
    });

    child.on('error', (err: any) => {
      state.status = 'error';
      state.lastError = err.message || 'Process error';
      this.logger.appendLine(`[MCP] Process error on "${name}": ${state.lastError}`);
      this.notify();
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      this.logger.appendLine(`[MCP] Server "${name}" exited with code ${code}, signal ${signal}`);
      this.activeProcesses.delete(name);
      if (!this.isDisposed) {
        state.status = code === 0 ? 'stopped' : 'error';
        if (code !== 0) {
          state.lastError = `Exited with code ${code || signal}`;
        }
        this.notify();
      }
    });

    // Send JSON-RPC initialize
    try {
      await this.sendJsonRpcRequest(name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'local-ollama', version: '1.4.0' },
      });

      // Send initialized notification
      this.sendJsonRpcNotification(name, 'notifications/initialized', {});

      // Discover tools
      await this.refreshTools(name);
      state.status = 'connected';
      state.lastConnectedAt = Date.now();
      this.logger.appendLine(`[MCP] Server "${name}" successfully connected (${state.tools.length} tools discovered).`);
      this.notify();
    } catch (initErr: any) {
      state.status = 'error';
      state.lastError = `Initialization failed: ${initErr.message || initErr}`;
      this.notify();
    }
  }

  private async connectSse(name: string, config: McpServerSseConfig): Promise<void> {
    const state = this.servers.get(name);
    if (!state) return;

    this.logger.appendLine(`[MCP] Connecting SSE server "${name}" at ${config.url}`);

    try {
      const response = await fetch(config.url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(config.headers || {}),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      state.status = 'connected';
      state.lastConnectedAt = Date.now();
      this.logger.appendLine(`[MCP] Remote SSE server "${name}" reachable.`);
      await this.refreshTools(name);
      this.notify();
    } catch (err: any) {
      state.status = 'error';
      state.lastError = `Cannot connect to ${config.url}: ${err.message || err}`;
      this.notify();
    }
  }

  private simulateOrRegisterBrowserServer(name: string, config: McpServerStdioConfig): void {
    const state = this.servers.get(name);
    if (!state) return;

    state.status = 'connected';
    state.lastConnectedAt = Date.now();

    // Default sample workspace tools when running in web preview
    const sampleTools: McpDiscoveredTool[] = [
      {
        serverName: name,
        originalName: 'query_workspace_db',
        name: `${name}__query_workspace_db`,
        description: 'Run read-only analytical queries against workspace metadata database.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'SQL SELECT query to execute' },
          },
          required: ['sql'],
        },
        isEnabled: true,
        estimatedTokens: 120,
      },
    ];

    state.tools = sampleTools;
    this.logger.appendLine(`[MCP] Browser workbench activated mock bridge for "${name}" (${state.tools.length} tools).`);
    this.notify();
  }

  private handleJsonRpcMessage(serverName: string, line: string): void {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && this.pendingRequests.has(String(msg.id))) {
        const { resolve, reject, timer } = this.pendingRequests.get(String(msg.id))!;
        clearTimeout(timer);
        this.pendingRequests.delete(String(msg.id));
        if (msg.error) {
          reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      }
    } catch {
      // Ignored malformed JSON-RPC
    }
  }

  private sendJsonRpcRequest(serverName: string, method: string, params?: Record<string, unknown>, timeoutMs = 15000): Promise<any> {
    const process = this.activeProcesses.get(serverName);
    if (!process) {
      return Promise.reject(new Error(`Server "${serverName}" is not running.`));
    }

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request "${method}" to server "${serverName}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      try {
        process.stdin.write(payload);
      } catch (writeErr) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(writeErr);
      }
    });
  }

  private sendJsonRpcNotification(serverName: string, method: string, params?: Record<string, unknown>): void {
    const process = this.activeProcesses.get(serverName);
    if (!process) return;
    try {
      const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
      process.stdin.write(payload);
    } catch {}
  }

  /**
   * Discovers and refreshes the tool catalog for a specific server.
   */
  async refreshTools(serverName: string): Promise<McpDiscoveredTool[]> {
    const state = this.servers.get(serverName);
    const config = this.configs.get(serverName);
    if (!state) return [];

    try {
      const result = await this.sendJsonRpcRequest(serverName, 'tools/list', {}, config?.timeoutMs || 10000);
      const rawTools = (result && result.tools) || [];
      const disabledSet = new Set(config?.disabledTools || []);

      const discovered: McpDiscoveredTool[] = rawTools.map((t: any) => {
        const originalName = t.name;
        const prefix = config?.toolPrefix || `${serverName}__`;
        const exposedName = `${prefix}${originalName}`;
        const inputSchema = t.inputSchema || { type: 'object', properties: {} };
        const estimatedTokens = Math.round((JSON.stringify(inputSchema).length + (t.description || '').length) / 3.8);

        return {
          serverName,
          originalName,
          name: exposedName,
          description: t.description || `Tool provided by ${serverName}`,
          inputSchema,
          isEnabled: !disabledSet.has(originalName),
          estimatedTokens,
        };
      });

      state.tools = discovered;
      this.notify();
      return discovered;
    } catch (err: any) {
      this.logger.appendLine(`[MCP] Failed to list tools for "${serverName}": ${err.message || err}`);
      return [];
    }
  }

  /**
   * Execute an MCP tool by its exposed name with safety guards, timeouts, and output truncation.
   */
  async executeTool(
    name: string,
    args: Record<string, unknown>,
    token?: CancellationLike,
  ): Promise<McpToolInvocationResult> {
    const startTime = Date.now();
    const tool = this.findToolByExposedName(name);

    if (!tool) {
      return {
        success: false,
        output: `Error: MCP tool "${name}" is not registered or active.`,
        durationMs: 0,
        truncated: false,
        error: 'ToolNotFound',
      };
    }

    if (!tool.isEnabled) {
      return {
        success: false,
        output: `Error: Tool "${name}" is currently disabled in .vscode/mcp.json.`,
        durationMs: 0,
        truncated: false,
        error: 'ToolDisabled',
      };
    }

    const config = this.configs.get(tool.serverName);
    const timeoutMs = config?.timeoutMs || 30000;
    const maxOutputLength = config?.maxOutputLength || 8000;

    // Secret redaction for logging
    const sanitizedArgs = this.redactSecrets(args);
    this.logger.appendLine(`[MCP] Calling ${name} on server "${tool.serverName}" with args: ${JSON.stringify(sanitizedArgs)}`);

    // Track activity
    const trackerId = this.activityTracker?.startToolCall(name, sanitizedArgs);

    if (token?.isCancellationRequested) {
      this.activityTracker?.finishToolCall(trackerId || '', 'error', 0, undefined, 'Cancelled by user');
      return {
        success: false,
        output: 'Operation cancelled by user.',
        durationMs: 0,
        truncated: false,
        error: 'Cancelled',
      };
    }

    try {
      let rawResult: any;
      if (this.activeProcesses.has(tool.serverName)) {
        rawResult = await this.sendJsonRpcRequest(
          tool.serverName,
          'tools/call',
          { name: tool.originalName, arguments: args },
          timeoutMs,
        );
      } else {
        // Fallback for simulated/web browser workbench
        rawResult = {
          content: [
            {
              type: 'text',
              text: `[Simulated MCP response for ${tool.originalName}] Output generated safely for local workbench preview.`,
            },
          ],
        };
      }

      let textOutput = '';
      if (rawResult && Array.isArray(rawResult.content)) {
        textOutput = rawResult.content
          .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
          .join('\n');
      } else {
        textOutput = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
      }

      const durationMs = Date.now() - startTime;
      let truncated = false;
      if (textOutput.length > maxOutputLength) {
        textOutput = textOutput.slice(0, maxOutputLength) + `\n\n... [Output truncated: ${textOutput.length - maxOutputLength} characters omitted. Refine filters if needed.]`;
        truncated = true;
      }

      if (trackerId) {
        this.activityTracker?.finishToolCall(trackerId, 'success', durationMs, textOutput.slice(0, 500));
      }

      return {
        success: true,
        output: textOutput,
        durationMs,
        truncated,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err.message || String(err);
      this.logger.appendLine(`[MCP] Tool "${name}" failed after ${durationMs}ms: ${errorMsg}`);

      if (trackerId) {
        this.activityTracker?.finishToolCall(trackerId, 'error', durationMs, undefined, errorMsg);
      }

      return {
        success: false,
        output: `Error invoking tool "${name}": ${errorMsg}`,
        durationMs,
        truncated: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Converts all active MCP tools to ToolDefinition format consumable by OllamaClient.
   */
  getActiveToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const server of this.servers.values()) {
      if (server.status !== 'connected') continue;
      for (const tool of server.tools) {
        if (!tool.isEnabled) continue;
        definitions.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema as any,
        });
      }
    }
    return definitions;
  }

  /**
   * Assesses context window token consumption of active tool schemas.
   */
  getContextBudgetReport(modelContextLimit = 16384): McpContextBudgetReport {
    let totalEstimatedTokens = 0;
    let toolCount = 0;

    for (const server of this.servers.values()) {
      if (server.status !== 'connected') continue;
      for (const tool of server.tools) {
        if (!tool.isEnabled) continue;
        totalEstimatedTokens += tool.estimatedTokens;
        toolCount++;
      }
    }

    const maxRecommendedTokens = Math.round(modelContextLimit * 0.25);
    const isOverBudget = totalEstimatedTokens > maxRecommendedTokens;
    let warningMessage: string | undefined;

    if (isOverBudget) {
      warningMessage = `High MCP Tool Context: ${toolCount} tools consume ~${totalEstimatedTokens} tokens (${Math.round(
        (totalEstimatedTokens / modelContextLimit) * 100,
      )}% of context window). Consider toggling off unused servers in .vscode/mcp.json.`;
    }

    return {
      totalEstimatedTokens,
      toolCount,
      isOverBudget,
      maxRecommendedTokens,
      warningMessage,
    };
  }

  findToolByExposedName(name: string): McpDiscoveredTool | undefined {
    for (const server of this.servers.values()) {
      for (const tool of server.tools) {
        if (tool.name === name) return tool;
      }
    }
    return undefined;
  }

  setToolEnabled(exposedName: string, enabled: boolean): void {
    const tool = this.findToolByExposedName(exposedName);
    if (tool) {
      tool.isEnabled = enabled;
      this.notify();
    }
  }

  async stopServer(name: string): Promise<void> {
    const process = this.activeProcesses.get(name);
    if (process) {
      try {
        process.kill();
      } catch {}
      this.activeProcesses.delete(name);
    }
    const state = this.servers.get(name);
    if (state) {
      state.status = 'stopped';
      state.pid = undefined;
    }
  }

  async stopAll(): Promise<void> {
    this.isDisposed = true;
    for (const name of Array.from(this.servers.keys())) {
      await this.stopServer(name);
    }
    this.pendingRequests.clear();
  }

  private redactSecrets(args: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = {};
    const secretKeywords = ['token', 'secret', 'password', 'key', 'auth', 'cred'];
    for (const [k, v] of Object.entries(args)) {
      if (secretKeywords.some((w) => k.toLowerCase().includes(w))) {
        copy[k] = '***REDACTED***';
      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        copy[k] = this.redactSecrets(v as Record<string, unknown>);
      } else {
        copy[k] = v;
      }
    }
    return copy;
  }
}
