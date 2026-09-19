export interface WorkspaceFile {
  path: string;
  content: string;
}

export const INITIAL_WORKSPACE_FILES: Record<string, string> = {
  'src/auth/AuthService.ts': `import { User, LoginCredentials, AuthResult } from '../types';

export class AuthService {
  private users: Map<string, User> = new Map();

  async login(credentials: LoginCredentials): Promise<AuthResult> {
    const user = this.users.get(credentials.email);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // TODO: Password check should be hashed and compared safely
    if (user.password !== credentials.password) {
      return { success: false, error: 'Invalid password' };
    }

    return {
      success: true,
      token: 'jwt-mock-token-' + Date.now(),
      user: { id: user.id, email: user.email, role: user.role }
    };
  }

  async register(email: string, password: string): Promise<User> {
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
`,
  'src/api/routes.ts': `import { AuthService } from '../auth/AuthService';

const authService = new AuthService();

export async function handleRequest(path: string, body: any): Promise<any> {
  if (path === '/api/login') {
    const { email, password } = body;
    if (!email || !password) {
      return { status: 400, error: 'Email and password are required.' };
    }
    const result = await authService.login({ email, password });
    return { status: result.success ? 200 : 401, data: result };
  }

  if (path === '/api/register') {
    const { email, password } = body;
    const user = await authService.register(email, password);
    return { status: 201, data: user };
  }

  return { status: 404, error: 'Endpoint not found' };
}
`,
  'src/types.ts': `export interface User {
  id: string;
  email: string;
  password?: string;
  role: 'admin' | 'developer' | 'viewer';
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: Omit<User, 'password'>;
  error?: string;
}
`,
  'package.json': `{
  "name": "sample-backend-service",
  "version": "1.0.0",
  "description": "Sample workspace for local Ollama testing",
  "main": "src/api/routes.ts",
  "scripts": {
    "start": "ts-node src/api/routes.ts",
    "test": "vitest run"
  }
}
`,
  'README.md': `# Sample Backend Service

This workspace is managed by Local Ollama.
Try asking the model:
- \`@localllm /edit Add rate limiting to routes.ts\`
- \`@localllm /refactor Extract error handling into a dedicated middleware\`
- \`@localllm Explain how authentication works in this project\`
`,
  '.vscode/mcp.json': `{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "./workspace.db"],
      "timeoutMs": 30000,
      "maxOutputLength": 8000
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "timeoutMs": 20000
    }
  }
}
`,
  '.vscode/skills/tdd-refactor/SKILL.md': `---
name: tdd-refactor
description: Enforces test-driven development, regression safety, and modular refactoring guidelines.
triggers: ["test", "refactor", "tdd", "unit test", "spec"]
autoTrigger: true
requiresTools: []
---

# Test-Driven Development (TDD) & Safe Refactoring Playbook

## Core Principles
1. **Never break existing public APIs**: Retain backwards compatibility for exported functions and classes.
2. **Red-Green-Refactor**:
   - Write or inspect the test suite before modifying production logic.
   - Run tests or check assertions after every discrete edit.
3. **Small, Atomic Diffs**: Avoid massive multi-file rewrites. Keep edits surgical and verifiable.

## Workflow Checklist
- [ ] Identify candidate functions or methods to refactor.
- [ ] Ensure edge cases (null, undefined, invalid types, empty arrays) are covered by tests.
- [ ] Refactor logic incrementally, maintaining clean variable naming and modular helpers.
- [ ] Verify no unused imports or lint warnings are introduced.
`,
  '.vscode/skills/database-safety/SKILL.md': `---
name: database-safety
description: Enforces safe query practices, transactions, indexing, and protection against destructive operations.
triggers: ["sql", "database", "sqlite", "query", "migration", "table"]
autoTrigger: true
requiresTools: ["sqlite__query_workspace_db"]
---

# Database Operations & Query Safety Playbook

## Safety Mandates
1. **Never run destructive SQL without explicit criteria**:
   - \`DELETE\` and \`UPDATE\` queries MUST include a precise \`WHERE\` clause.
   - Never execute \`DROP TABLE\` or \`TRUNCATE\` without prompting the user first.
2. **Read-First Pattern**:
   - Always run \`EXPLAIN QUERY PLAN\` or verify table schemas before proposing complex joins.
3. **Limit Results**:
   - Append \`LIMIT 50\` or pagination to unknown SELECT queries to avoid blowing the context window.
`
};
