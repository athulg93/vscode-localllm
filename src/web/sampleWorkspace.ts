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

This workspace is managed by Local Ollama Chat.
Try asking the model:
- \`@local-ollama /edit Add rate limiting to routes.ts\`
- \`@local-ollama /refactor Extract error handling into a dedicated middleware\`
- \`@local-ollama Explain how authentication works in this project\`
`
};
