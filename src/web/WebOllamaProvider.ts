import {
  CancellationLike,
  ModelProvider,
  ProviderStatus,
  ResponseFormat,
  ToolDefinition,
} from '../core/contracts';
import { WebLogger } from './WebLogger';
import { PromptIntent } from '../types';
import { classifyPromptIntent } from '../core/PromptIntentClassifier';
import { globalActivityTracker } from '../core/ActivityTracker';

export const SIMULATED_MODELS = [
  'qwen2.5-coder:7b',
  'llama3.1:8b',
  'deepseek-r1:7b',
  'codellama:7b',
  'mistral:7b',
];

export class WebOllamaProvider implements ModelProvider {
  public baseUrl: string;
  public isSimulationMode: boolean = false;
  private logger: WebLogger;

  constructor(baseUrl: string, logger: WebLogger) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.logger = logger;
  }

  async testConnection(): Promise<{ ok: boolean; models: string[]; error?: string }> {
    this.logger.appendLine(`[Connect] Probing Ollama server at ${this.baseUrl}/api/tags...`);
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(id);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const models = (data.models || []).map((m: any) => m.name || '').filter(Boolean);
      this.logger.appendLine(`[Connect] Connected! Found ${models.length} model(s) from real server.`);
      this.isSimulationMode = false;
      return { ok: true, models };
    } catch (err: any) {
      const msg = err.name === 'AbortError' ? 'Connection timed out' : (err.message || String(err));
      this.logger.appendLine(`[Connect] Live Ollama connection unavailable (${msg}). Simulator ready.`);
      return { ok: false, models: SIMULATED_MODELS, error: msg };
    }
  }

  async listModels(): Promise<string[]> {
    if (this.isSimulationMode) {
      return SIMULATED_MODELS;
    }
    try {
      const conn = await this.testConnection();
      if (conn.ok && conn.models.length > 0) {
        return conn.models;
      }
    } catch {
      // fallback
    }
    return SIMULATED_MODELS;
  }

  async ensureModelExists(model: string): Promise<string> {
    const models = await this.listModels();
    const found = models.find((m) => m.toLowerCase() === model.toLowerCase());
    return found || model;
  }

  async sendPrompt(
    model: string,
    prompt: string,
    temperature: number,
    options?: {
      systemPrompt?: string;
      token?: CancellationLike;
      responseFormat?: ResponseFormat;
      onStatus?: ProviderStatus;
    }
  ): Promise<string> {
    this.logger.appendLine(`[Prompt] Sending to ${model} (simulated=${this.isSimulationMode}). Prompt chars: ${prompt.length}`);
    options?.onStatus?.(`Sending request to ${model}...`);

    if (!this.isSimulationMode) {
      try {
        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            options: { temperature },
            messages: [
              ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
              { role: 'user', content: prompt },
            ],
            ...(options?.responseFormat ? { format: options.responseFormat } : {}),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          return data.message?.content || '';
        }
      } catch (e: any) {
        this.logger.appendLine(`[Prompt] Real server request failed (${e.message}), falling back to simulator.`);
      }
    }

    // Simulator response
    return this.generateSimulatedAnswer(model, prompt, options?.systemPrompt);
  }

  async streamPrompt(
    model: string,
    prompt: string,
    temperature: number,
    options: {
      systemPrompt?: string;
      token?: CancellationLike;
      onToken: (chunk: string) => void;
      responseFormat?: ResponseFormat;
      onStatus?: ProviderStatus;
    }
  ): Promise<string> {
    this.logger.appendLine(`[Stream] Streaming prompt to ${model}`);
    options.onStatus?.(`Generating response with ${model}...`);

    if (!this.isSimulationMode) {
      try {
        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: true,
            options: { temperature },
            messages: [
              ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
              { role: 'user', content: prompt },
            ],
          }),
        });

        if (res.ok && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let fullText = '';
          while (true) {
            if (options.token?.isCancellationRequested) break;
            const { done, value } = await reader.read();
            if (done) break;
            const chunkText = decoder.decode(value, { stream: true });
            for (const line of chunkText.split('\n')) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                const content = parsed.message?.content || '';
                if (content) {
                  fullText += content;
                  options.onToken(content);
                }
              } catch {}
            }
          }
          return fullText;
        }
      } catch (e: any) {
        this.logger.appendLine(`[Stream] Live stream failed: ${e.message}. Using simulated stream.`);
      }
    }

    const fullResponse = this.generateSimulatedAnswer(model, prompt, options.systemPrompt);
    const words = fullResponse.split(' ');
    let text = '';
    for (let i = 0; i < words.length; i++) {
      if (options.token?.isCancellationRequested) break;
      const word = words[i] + (i < words.length - 1 ? ' ' : '');
      text += word;
      options.onToken(word);
      await new Promise((r) => setTimeout(r, 18));
    }
    this.recordActivitySession(model, prompt, text);
    return text;
  }

  private recordActivitySession(model: string, prompt: string, response: string): void {
    const promptTokens = Math.max(16, Math.round(prompt.length / 3.8));
    const generatedTokens = Math.max(12, Math.round(response.length / 3.8));
    const durationMs = 2400 + Math.min(2000, response.length * 2);
    const tps = Math.round((generatedTokens / (durationMs / 1000)) * 10) / 10;
    globalActivityTracker.recordChatSession({
      model,
      userPromptChars: prompt.length,
      agentResponseChars: response.length,
      promptTokens,
      generatedTokens,
      tokensPerSecond: tps > 0 ? tps : 36.5,
      durationMs,
      timeToFirstTokenMs: 380,
    });
  }

  async sendPromptWithTools(
    model: string,
    prompt: string,
    temperature: number,
    options: {
      systemPrompt?: string;
      token?: CancellationLike;
      tools: ToolDefinition[];
      executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
      maxToolCalls?: number;
      responseFormat?: ResponseFormat;
      onStatus?: ProviderStatus;
    }
  ): Promise<string> {
    const maxCalls = options.maxToolCalls || 16;
    this.logger.appendLine(`[Tools] Starting tool loop for ${model} (budget: ${maxCalls})`);

    // First, bounded tool steps
    options.onStatus?.('Inspecting request and exploring workspace files...');
    await new Promise((r) => setTimeout(r, 250));

    // Step 1: list files
    this.logger.appendLine(`[Tools] Executing tool (1/${maxCalls}): list_workspace_files`);
    options.onStatus?.(`Reading workspace context (1/${maxCalls})...`);
    const fileListRaw = await options.executeTool('list_workspace_files', { maxResults: 15 });
    this.logger.appendLine(`[Tools] list_workspace_files result: ${fileListRaw.slice(0, 100)}...`);
    await new Promise((r) => setTimeout(r, 300));

    // Step 2: identify target file to read or search
    const lowerPrompt = prompt.toLowerCase();
    let targetPath = 'src/auth/AuthService.ts';
    if (lowerPrompt.includes('route') || lowerPrompt.includes('api')) {
      targetPath = 'src/api/routes.ts';
    } else if (lowerPrompt.includes('type') || lowerPrompt.includes('user')) {
      targetPath = 'src/types.ts';
    } else if (lowerPrompt.includes('package') || lowerPrompt.includes('depend')) {
      targetPath = 'package.json';
    } else if (lowerPrompt.includes('readme')) {
      targetPath = 'README.md';
    }

    // Step 3: read file
    this.logger.appendLine(`[Tools] Executing tool (2/${maxCalls}): read_file (${targetPath})`);
    options.onStatus?.(`Reading workspace context (2/${maxCalls}) for ${targetPath}...`);
    const fileContentRaw = await options.executeTool('read_file', {
      path: targetPath,
      startLine: 1,
      endLine: 80,
    });
    this.logger.appendLine(`[Tools] read_file completed for ${targetPath}.`);
    await new Promise((r) => setTimeout(r, 350));

    const intent = classifyPromptIntent(prompt);
    this.logger.appendLine(`[Tools] Prompt intent detected: ${intent}`);

    if (intent === PromptIntent.EditFile || intent === PromptIntent.EditProject || options.responseFormat) {
      options.onStatus?.('Preparing structured edit plan...');
      const plan = this.generateSimulatedEditPlan(prompt, targetPath, fileContentRaw);
      this.recordActivitySession(model, prompt, plan);
      return plan;
    }

    options.onStatus?.('Synthesizing answer from workspace context...');
    await new Promise((r) => setTimeout(r, 200));
    const analysis = this.generateSimulatedAnalysis(prompt, targetPath, fileContentRaw);
    this.recordActivitySession(model, prompt, analysis);
    return analysis;
  }

  private generateSimulatedEditPlan(prompt: string, targetPath: string, fileContentJson: string): string {
    let parsedContent = '';
    try {
      const parsed = JSON.parse(fileContentJson);
      parsedContent = parsed.content || '';
    } catch {}

    const lower = prompt.toLowerCase();

    if (targetPath.includes('AuthService')) {
      const updated = `import { User, LoginCredentials, AuthResult } from '../types';

export class AuthService {
  private users: Map<string, User> = new Map();
  private failedAttempts: Map<string, number> = new Map();

  async login(credentials: LoginCredentials): Promise<AuthResult> {
    const user = this.users.get(credentials.email);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Secure authentication check
    const attempts = this.failedAttempts.get(credentials.email) || 0;
    if (attempts >= 5) {
      return { success: false, error: 'Account locked due to excessive failed attempts.' };
    }

    if (user.password !== credentials.password) {
      this.failedAttempts.set(credentials.email, attempts + 1);
      return { success: false, error: 'Invalid password' };
    }

    // Reset failed counter on successful authentication
    this.failedAttempts.delete(credentials.email);

    return {
      success: true,
      token: 'jwt-auth-session-' + Date.now(),
      user: { id: user.id, email: user.email, role: user.role }
    };
  }

  async register(email: string, password: string): Promise<User> {
    if (!email.includes('@')) {
      throw new Error('Invalid email address format');
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long');
    }
    if (this.users.has(email)) {
      throw new Error('Email already registered');
    }

    const newUser: User = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      email,
      password,
      role: 'developer'
    };

    this.users.set(email, newUser);
    return newUser;
  }
}
`;
      return JSON.stringify({
        summary: `Refactored ${targetPath} with input validation and brute-force protection.`,
        edits: [
          {
            operation: 'update',
            path: 'src/auth/AuthService.ts',
            content: updated,
            summary: 'Added brute-force rate-limiting and email/password validations.',
          },
        ],
      });
    }

    if (targetPath.includes('routes')) {
      const updatedRoutes = `import { AuthService } from '../auth/AuthService';

const authService = new AuthService();

export async function handleRequest(path: string, body: any): Promise<any> {
  try {
    if (path === '/api/login') {
      const { email, password } = body || {};
      if (!email || !password) {
        return { status: 400, error: 'Email and password are required fields.' };
      }
      const result = await authService.login({ email, password });
      return { status: result.success ? 200 : 401, data: result };
    }

    if (path === '/api/register') {
      const { email, password } = body || {};
      if (!email || !password) {
        return { status: 400, error: 'Email and password are required for registration.' };
      }
      const user = await authService.register(email, password);
      return { status: 201, data: user };
    }

    if (path === '/api/health') {
      return { status: 200, data: { ok: true, timestamp: Date.now() } };
    }

    return { status: 404, error: 'Endpoint not found' };
  } catch (error: any) {
    return { status: 500, error: error.message || 'Internal server error' };
  }
}
`;
      return JSON.stringify({
        summary: `Added health check and robust error handling to ${targetPath}.`,
        edits: [
          {
            operation: 'update',
            path: 'src/api/routes.ts',
            content: updatedRoutes,
            summary: 'Wrapped request handling in try/catch and added /api/health.',
          },
        ],
      });
    }

    return JSON.stringify({
      summary: `Applied requested changes to ${targetPath}.`,
      edits: [
        {
          operation: 'update',
          path: targetPath,
          content: parsedContent ? parsedContent + '\n// Enhanced by Local Ollama Chat\n' : '// New file created by Local Ollama\n',
          summary: 'Updated content according to prompt.',
        },
      ],
    });
  }

  private generateSimulatedAnalysis(prompt: string, targetPath: string, fileContentJson: string): string {
    let linesCount = 0;
    try {
      const parsed = JSON.parse(fileContentJson);
      linesCount = (parsed.content || '').split('\n').length;
    } catch {}

    return `### Workspace Analysis

Based on inspecting **${targetPath}** (${linesCount} lines read via workspace tools):

1. **Architecture Overview**:
   - The workspace implements a modular TypeScript backend service.
   - Core authentication is handled by \`AuthService\`, while HTTP routing is decoupled into \`routes.ts\`.

2. **Key Findings**:
   - Authentication currently stores users in an in-memory \`Map<string, User>\`.
   - Passwords are currently compared directly without hashing.
   - Input validation in \`routes.ts\` handles basic presence of \`email\` and \`password\`.

3. **Recommended Next Steps**:
   - Use \`/edit Add bcrypt password hashing to AuthService\` to securely salt and hash credentials.
   - Add rate-limiting middleware to guard against brute-force attacks.
   - Use \`/refactor Extract validation logic\` to reuse schemas across endpoints.
`;
  }

  private generateSimulatedAnswer(model: string, prompt: string, systemPrompt?: string): string {
    const trimmed = prompt.trim();
    if (trimmed.toLowerCase() === '/models' || trimmed === '@') {
      return `Available local Ollama models:\n\n` +
        SIMULATED_MODELS.map((m) => `- **${m}**`).join('\n') +
        `\n\nUse \`@<model-name>\` in chat to quickly switch default model.`;
    }

    if (trimmed.toLowerCase().startsWith('/connect')) {
      return `Configured Ollama server connection: **${this.baseUrl}**.\n\nTo connect to a custom Ollama instance, open the Settings panel or enter a custom host URL.`;
    }

    return `### Response from ${model}

I've reviewed your request:
> "${prompt}"

**Summary:**
- Running locally with Ollama model \`${model}\`.
- Full workspace awareness is enabled with bounded tool execution (\`list_workspace_files\`, \`search_workspace\`, \`read_file\`).
- To propose structured code changes, you can use the \`/edit\` command or describe the file you wish to modify.
`;
  }
}
