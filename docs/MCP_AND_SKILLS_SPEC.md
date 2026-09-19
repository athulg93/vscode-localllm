# Model Context Protocol (MCP) & Skills Architecture Specification

## Overview

Local Ollama (@localllm) integrates Model Context Protocol (MCP) servers and domain-specific Procedural Skills to extend local LLMs (Qwen 2.5 Coder, Llama 3, DeepSeek Coder, etc.) with external capabilities and structured engineering playbooks.

- **MCP (Tools & Capabilities)**: Dynamic, protocol-standard tool execution connecting local scripts, databases, CLI binaries, and remote services via `stdio` and `sse` transports.
- **Skills (Workflows & Playbooks)**: Modular procedural instructions in standard `SKILL.md` format (YAML frontmatter + Markdown) injected dynamically based on user prompt intent or manual selection.

---

## 1. MCP Configuration & Standards

### Standard Locations
Local Ollama scans configuration files in the following precedence order:
1. Workspace Level: `.vscode/mcp.json`
2. Workspace Specific: `.vscode/localllm-mcp.json`
3. Global User Level: `~/.localllm/mcp.json`

### Configuration Schema
```json
{
  "mcpServers": {
    "local-python": {
      "command": "python3",
      "args": ["./scripts/db_tools.py"],
      "cwd": "${workspaceFolder}",
      "env": {
        "DB_PATH": "./data.db"
      },
      "timeoutMs": 30000,
      "maxOutputLength": 8000,
      "autoRestart": true,
      "disabledTools": []
    },
    "docker-sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "./test.db"]
    },
    "remote-service": {
      "url": "http://localhost:8000/sse",
      "headers": {
        "Authorization": "Bearer local-token"
      },
      "timeoutMs": 15000
    }
  }
}
```

---

## 2. Transports Supported

### 1. `stdio` Transport (Local Binaries & Scripts)
- Spawns subprocesses (`node`, `python`, `uvx`, `npx`, binaries).
- Uses JSON-RPC 2.0 over standard input / standard output.
- Intercepts and logs `stderr` for rapid diagnosis without breaking JSON-RPC parsing.
- Enforces strict process supervisor lifecycle: kills child processes on IDE deactivation (`SIGTERM` -> `SIGKILL` fallback).

### 2. `sse` Transport (Server-Sent Events / HTTP)
- Connects to remote or dockerized MCP endpoints (`/sse`).
- Handles JSON-RPC requests via HTTP POST.
- Auto-reconnect with exponential backoff on dropped connections.

---

## 3. Reliability, Error Prevention & Safety Matrix

| Failure Mode | Root Cause | Prevention & Recovery Strategy |
| :--- | :--- | :--- |
| **Missing Binary (`ENOENT`)** | `uvx` or `python` not found in PATH | Pre-flight binary check in system `PATH`. Clear UI warning with exact command to install. |
| **Orphaned Processes** | IDE reload/crash leaves child processes running | Process supervisor tracks PIDs; registers parent exit hooks and kills children on deactivation. |
| **Context Window Overflow** | 20+ MCP tools consume thousands of tokens | Token budget guard estimates schema size. Flags warning if tools exceed 20% of context window. |
| **Giant Tool Output** | Tool returns 2MB database dump or file | Output truncation guard caps result at 8,000 chars and advises model to refine query. |
| **Malformed Tool Args** | 7B model omits required fields | Pre-flight JSON Schema validation with auto-coercion (string -> number). In-loop retry feedback. |
| **Tool Name Collision** | 2 MCP servers define identical tool name | Automatic namespace prefixing (`serverName__toolName`). |
| **Hanging Operations** | Infinite loop or slow remote network | Configurable 30s timeout per invocation. Hooked to VS Code `CancellationToken`. |
| **Zombie Tool Loops** | Model repeatedly calls same failing tool | Duplicate call breaker: aborts if identical failed call runs 3 times consecutively. |
| **Secret Leakage** | Database password or token in tool args | Sensitive field redaction (`token`, `password`, `key`, `secret`) before writing to activity logs. |

---

## 4. User Extensibility & Escape Hatches

1. **Custom Wrapper Shims**: Users can wrap any quirky server in a local Node/Python script in `.vscode/mcp.json` without modifying extension code.
2. **Per-Server Fine Tuning**: `timeoutMs`, `disabledTools`, `env`, `cwd`, and `toolPrefix` can be adjusted per server directly in JSON.
3. **Local Middleware Hooks (`.vscode/localllm-hooks.js`)**:
   Optional user file in the workspace allowing developers to intercept and modify tool arguments or results before and after execution:
   ```javascript
   module.exports = {
     beforeToolCall: async ({ serverName, toolName, args }) => args,
     afterToolCall: async ({ serverName, toolName, result }) => result
   };
   ```

---

## 5. Skills Architecture (Phase 2 Roadmap)

- **File Format**: Standard `SKILL.md` with YAML frontmatter (`name`, `description`, `triggers`, `autoTrigger`).
- **Directories**: `.vscode/skills/<skill-name>/SKILL.md` or `~/.localllm/skills/<skill-name>/SKILL.md`.
- **Dynamic Context Injection**: Only summaries are listed initially; full instructions are injected when matched or explicitly enabled.
- **MCP Bridge**: Skills can reference required MCP tools (e.g., `requiresTools: ["sqlite"]`).
