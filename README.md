<div align="center">

# 🦙 Local Ollama Chat

**Bring local, private AI to VS Code Chat — powered by your own Ollama server.**

[![VS Code](https://img.shields.io/badge/VS%20Code-%E2%89%A5%201.96.0-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![Ollama](https://img.shields.io/badge/Requires-Ollama-000000?logo=ollama&logoColor=white)](https://ollama.com/)
[![Latest Release](https://img.shields.io/badge/release-v1.3.0-brightgreen)](https://github.com/athulg93/vscode-localllm/releases/download/v1.3.0/local-ollama-chat-1.3.0.vsix)

</div>

---

Local Ollama Chat connects the **VS Code Chat** experience to an **Ollama server** running on your machine. Use local models for conversation, workspace-aware code analysis, bounded file exploration, and reviewable file edits — **without sending your source code to a hosted AI service.**

## Table of Contents

- [What It Does](#what-it-does)
- [Requirements](#requirements)
- [Install](#install)
- [Get Started](#get-started)
- [Chat Usage](#chat-usage)
- [Model Switching and Capabilities](#model-switching-and-capabilities)
- [Workspace Awareness](#workspace-awareness)
- [Editing Workflow](#editing-workflow)
- [Configuration](#configuration)
- [Updating](#updating)
- [Diagnostics and Troubleshooting](#diagnostics-and-troubleshooting)
- [Development](#development)
- [License](#license)

---

## What It Does

- 🔌 Connects VS Code Chat to any reachable Ollama-compatible server
- 📋 Discovers installed Ollama models and lets you switch between them
- 💬 Streams responses through the `@local-ollama` chat participant
- 🧠 Selects relevant workspace context for questions about the current file or project
- 🔍 Explores a workspace in multiple bounded steps instead of guessing which files matter
- 🧩 Selects a model-specific tool strategy and avoids workspace tools for casual prompts
- ✏️ Proposes create, update, delete, and rename operations as structured edit plans
- 👀 Opens previews and asks for a keep/discard decision before applying each proposed file operation
- 📊 Reports progress while it connects, explores files, plans edits, and checks for updates
- ⬆️ Updates standalone VSIX installations from GitHub Releases
- 🌿 Inspects and manages the current Git repository with confirmation before mutations

> **Privacy note:** All model requests and workspace context go to the Ollama server configured in the extension. The updater contacts GitHub only when you explicitly check for an extension update.

## Requirements

| Requirement | Notes |
| --- | --- |
| VS Code | `1.96.0` or newer |
| Ollama | Installed and running locally, or an Ollama-compatible server reachable over HTTP |
| A model | At least one model installed in Ollama |

**Example Ollama setup:**

```sh
ollama serve
ollama pull qwen2.5-coder:7b
```

> The model name above is just an example — use any model returned by `ollama list` or the extension's model picker.

## Install

### Option A — Install the published VSIX

1. Download [`local-ollama-chat-1.3.0.vsix`](https://github.com/athulg93/vscode-localllm/releases/download/v1.3.0/local-ollama-chat-1.3.0.vsix) from the GitHub release.
2. In VS Code, open **Extensions**.
3. Click the `...` menu → **Install from VSIX...** → select the downloaded file.
4. Reload VS Code if prompted.

### Option B — Install from source

```sh
git clone https://github.com/athulg93/vscode-localllm.git
cd vscode-localllm
npm install
npm run compile
```

Then use **Extensions: Install from VSIX...** after packaging the extension, or use `Local Ollama: Update From Workspace` while developing the extension.

## Get Started

1. Start Ollama: `ollama serve`
2. Open a workspace in VS Code.
3. Run **Local Ollama: Connect** from the Command Palette.
4. Enter the Ollama server URL, then select a model.
5. Open VS Code Chat and address a prompt to `@local-ollama`.

The default server URL is `http://localhost:11434`. You can also configure the connection manually in **Settings** under **Local Ollama**.

## Chat Usage

Use the participant directly in VS Code Chat:

```text
@local-ollama Explain the authentication flow in this project.
```

### Chat Commands

| Command | What it does | Example |
| --- | --- | --- |
| `/models` | Lists models available from the configured Ollama server. | `@local-ollama /models` |
| `/connect` | Prompts for a server URL and default model. | `@local-ollama /connect` |
| `/change-model` | Lists local models, checks tool support, and changes the active default model. | `@local-ollama /change-model` |
| `/edit` | Creates a reviewable edit plan for the current file or requested files. | `@local-ollama /edit improve error handling` |
| `/refactor` | Creates a reviewable multi-file refactor plan. | `@local-ollama /refactor simplify duplicated validation` |
| `/update` | Checks GitHub Releases for a newer extension version. | `@local-ollama /update` |

> The updater also recognizes `@local-ollama run update`.

### Git operations

For a workspace opened inside a Git repository, ask `@local-ollama` to inspect or manage Git:

```text
@local-ollama Check the Git status and show the latest diff.
@local-ollama Stage the changed source files, commit them with "fix: improve validation", and push the current branch.
```

Read-only operations such as status, diff, log, and branch inspection can run automatically. Staging, committing, pushing, pulling, and switching branches always display the exact operation in a modal confirmation dialog. The Git layer does not expose arbitrary shell commands, force-push, branch creation/deletion, reset, or sensitive `.env` files.

### Switch Models Inline

Prefix a prompt with an installed model name to use it for that request **and** make it the new default:

```text
@qwen2.5-coder:7b Explain this function and suggest edge cases.
```

List available models with `@` on its own:

```text
@
```

You can also use **Local Ollama: Select Model** or **Local Ollama: List Models** from the Command Palette.

## Model Switching and Capabilities

Use **Local Ollama: Change Model** from the Command Palette, or run:

```text
@local-ollama /change-model
```

The extension lists the models available on the configured Ollama server, lets you choose one, and saves it as the active default for subsequent requests. During model selection and connection, the extension checks Ollama's model capabilities. If the selected model does not support tools, it displays a warning because workspace exploration and AI-assisted edit workflows may not work with that model.

Tool behavior is selected through extensible model-family profiles for Qwen, Gemma, Llama, DeepSeek, and unknown models. Profiles can use Ollama native tool calls, JSON/XML text calls, or no workspace tools. The extension also records per-model capability failures, parsing failures, unexpected tool triggers, and tool-loop incidents in VS Code global state and warns when a model repeatedly misbehaves.

## Workspace Awareness

For questions that need repository context, the extension performs several **host-owned operations**:

| Tool | Purpose |
| --- | --- |
| `list_workspace_files` | Discovers bounded workspace-relative text files |
| `search_workspace` | Finds literal text matches and line numbers |
| `read_file` | Reads a limited line range from one workspace file |

The model can chain these tools — for example: discover likely files → search for a symbol → read the relevant implementation. Tool calls have a configurable per-request budget so a large request can explore more than eight times without becoming an unbounded loop.

**Excluded by default:** `node_modules`, `.git`, `dist`, `out`, `build`, `.next`, `.turbo`, `.cache`.

> File paths must stay workspace-relative and cannot contain parent-directory traversal.

## Editing Workflow

Ask for a focused change:

```text
@local-ollama /edit Add input validation to the current API handler.
```

The extension then:

1. **Explores** relevant files with bounded tools.
2. **Requests** a structured edit plan from Ollama.
3. **Validates** the proposed paths and operations on the host.
4. **Previews** diffs for up to three files.
5. **Lets you decide** — keep or discard each validated operation.
6. **Applies** selected changes with VS Code `WorkspaceEdit` and saves the affected documents.

Supported operations: `create`, `update`, `delete`, `rename`. The extension protects sensitive or generated locations, rejects unsafe paths, limits the number and size of edits, and skips operations that fail validation. **A proposed edit is never applied without your confirmation.**

Equivalent workflows are also available from the Command Palette:

- **Local Ollama: Apply Suggested Edit** — edits the current file based on a prompt.
- **Local Ollama: Refactor Project** — proposes a project-level refactor.

## Configuration

All settings live under **Settings → Extensions → Local Ollama**.

| Setting | Default | Description |
| --- | --- | --- |
| `localOllama.baseUrl` | `http://localhost:11434` | Ollama server URL. |
| `localOllama.defaultModel` | `qwen2.5-coder:7b` | Model used when no inline model is specified. |
| `localOllama.temperature` | `0.7` | Generation temperature from `0` to `1`. |
| `localOllama.autoCreateDirectories` | `true` | Creates missing parent directories for safe create and rename operations. |
| `localOllama.maxToolCalls` | `16` | Maximum workspace exploration operations for one request. Allowed range: `4`–`40`. |

> The tool-call limit is a guardrail, not a target. Requests stop as soon as the model has enough context; requests that reach the configured maximum receive a bounded-limit error instead of continuing forever.

## Updating

### Installed VSIX or release update

Run **Local Ollama: Check for Updates** from the Command Palette, or:

```text
@local-ollama /update
```

The updater:

1. Checks the latest release at [GitHub Releases](https://github.com/athulg93/vscode-localllm/releases).
2. Compares the release version with the installed extension version.
3. Finds the release `.vsix` asset and asks for confirmation.
4. Downloads and validates the VSIX archive in VS Code extension storage.
5. Installs the update and offers to reload the window.

If no newer release is available, the extension reports that it's already up to date. Marketplace installations, when available, can use VS Code's normal extension update service.

### Update from the source workspace

**Local Ollama: Update From Workspace** is intended for contributors developing this extension from source. It validates that the open workspace's `package.json` matches this extension, asks for confirmation before running any commands, compiles the workspace, packages the VSIX, installs it into the current VS Code instance, and offers to reload the window. Dependencies must already be installed.

## Diagnostics and Troubleshooting

Open **Local Ollama: Open Activity Log** or the **Local Ollama** output channel for connection failures, model resolution, context selection, tool progress, skipped edits, update errors, and cancellation messages.

<details>
<summary><strong>Ollama connection fails</strong></summary>

- Confirm Ollama is running with `ollama serve`.
- Check the configured `localOllama.baseUrl`.
- Verify the server responds at `<baseUrl>/api/tags`.
- Confirm at least one model is installed with `ollama list`.

</details>

<details>
<summary><strong>A model cannot be selected</strong></summary>

Run **Local Ollama: List Models** and compare the name with `ollama list`. Model names are matched case-insensitively, but the selected model must exist on the configured server.

</details>

<details>
<summary><strong>Exploration reaches its limit</strong></summary>

Increase `localOllama.maxToolCalls` up to `40`, or make the request narrower by naming the relevant folder, file, or symbol. The limit is intentionally finite to prevent runaway workspace scans.

</details>

<details>
<summary><strong>An edit is skipped</strong></summary>

Review the Local Ollama output channel. Common reasons include an unsafe path, a protected file or directory, a missing rename target, a file that is too large, or a conflicting workspace state.

</details>

## Development

Install dependencies and compile:

```sh
npm install
npm run compile
```

Lint and run the unit test suite (covers the pure logic in `src/core/`):

```sh
npm run lint
npm test
```

Build a VSIX:

```sh
npm run package -- --allow-star-activation --skip-license --allow-missing-repository
```

The output file is named `local-ollama-chat-<version>.vsix`.

> Automated tests currently cover `src/core/` only (prompt-intent classification, edit-plan parsing, path safety, and NDJSON stream parsing). Before publishing, also validate: compilation, VSIX integrity, a local Ollama request, and the GitHub release asset.

## License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
<sub>Built for developers who want AI assistance without sending code off their machine.</sub>
</div>
