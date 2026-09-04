# Local LLM Architecture

The project is organized around a platform-neutral core and host-specific adapters.

## Core

`src/core/` contains logic that can be reused by VS Code, Eclipse, JetBrains, or another host:

- `PromptIntentClassifier.ts` classifies requests such as analysis, editing, and project operations.
- `EditPlanParser.ts` parses the structured edit plan returned by a model.
- `contracts.ts` defines logger, model-provider, chat-message, and cancellation contracts.

Core modules do not import VS Code, Ollama, Node.js, or any IDE API.

## Adapters

The current host and provider implementations are retained while the migration proceeds:

- `src/extension.ts` owns VS Code activation, chat registration, commands, settings, and UI.
- `src/services/ContextManager.ts` owns VS Code workspace discovery and file reading.
- `src/services/EditorManager.ts` owns VS Code previews, confirmation dialogs, and workspace edits.
- `src/services/OllamaClient.ts` owns Ollama HTTP requests and streaming responses.
- `src/services/ActivityLogger.ts` adapts logging to the VS Code output channel and extension storage.
- `src/services/UpdateManager.ts` owns VS Code VSIX update behavior.

## Future adapters

A new provider adapter should implement the model-provider contract and translate its native API into the shared chat and streaming shapes. A new IDE adapter should provide context, editor, settings, logging, and update implementations without changing `src/core/`.

The current refactor is intentionally incremental: the existing VS Code/Ollama extension remains usable while pure logic and contracts are extracted for other hosts and local LLM providers.
