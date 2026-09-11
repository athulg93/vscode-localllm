# Local Ollama Chat

A VS Code extension that connects the built-in chat experience to a local Ollama instance.

## Features

- Chat with a local Ollama model from VS Code chat using `@local-ollama`
- Set the local Ollama base URL and default model in settings
- Pick from available local models on your machine
- Use slash commands like `/models` inside the chat participant
- Automatically choose and inject local context for prompts like "analyze this file", "help me with this", or "review this project"
- Cache project context for 60 seconds to avoid rescanning unchanged workspaces on repeated requests
- Stream human-readable responses back from Ollama in chat
- Explore the workspace through bounded multi-step tools for file discovery, search, and line-range reads
- Propose file/project edits with preview + apply/cancel flow
- Protect dotfiles, lockfiles, generated folders, and dirty editors from unsafe overwrite attempts

## Setup

1. Start Ollama locally.
2. Download one or more models, for example `qwen2.5-coder:7b` or `gemma4:12b-mlx`.
3. Open the command palette and run `Local Ollama: Connect`.
4. Use `@local-ollama` in the chat panel.

## Editing Workflow

- Ask `@local-ollama` to edit the current file, for example: `fix this file and improve readability`
- Ask `@local-ollama` to refactor the project, for example: `refactor this project to improve naming consistency`
- The extension requests a structured edit plan from Ollama, opens preview diffs, then asks whether to apply or discard changes
- Edit previews compare against the last saved on-disk version to avoid confusing diffs from unsaved editor state

You can also run these commands from the Command Palette:

- `Local Ollama: Apply Suggested Edit`
- `Local Ollama: Refactor Project`
- `Local Ollama: Update From Workspace`
- `Local Ollama: Check for Updates`

## Updating

- Marketplace installations are updated by VS Code's normal extension update service.
- Standalone VSIX installations can check GitHub Releases from the Command Palette with `Local Ollama: Check for Updates`.
- The same updater is available in chat with `@local-ollama /update`.
- `@local-ollama run update` is also recognized for compatibility with that phrasing.
- The updater checks the latest release at `https://github.com/athulg93/vscode-localllm/releases`, compares versions, downloads the release VSIX, asks for confirmation, installs it, and offers to reload VS Code.
- `Local Ollama: Update From Workspace` remains available for developers who are running the extension from its source workspace.

## Configuration

- `localOllama.baseUrl`: defaults to `http://localhost:11434`
- `localOllama.defaultModel`: defaults to `qwen2.5-coder:7b`
- `localOllama.temperature`: defaults to `0.7`
- `localOllama.maxToolCalls`: defaults to `16`, with a maximum of `40` workspace exploration operations per request

## Diagnostics

- Open the `Local Ollama` output channel in VS Code to inspect context selection, file-scan failures, cancellation, and skipped edit reasons.
