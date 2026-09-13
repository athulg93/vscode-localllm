# Local LLM Architecture

The project is organized around a platform-neutral core and host-specific adapters.

## Core

`src/core/` contains logic that can be reused by VS Code, Eclipse, JetBrains, or another host:

- `PromptIntentClassifier.ts` classifies requests such as analysis, editing, and project operations.
- `EditPlanParser.ts` parses the structured edit plan returned by a model.
- `PathSafety.ts` validates workspace-relative paths (traversal, protected files/directories, text-source extensions) used by both the editing and workspace-exploration workflows.
- `NdjsonStream.ts` parses newline-delimited JSON chunks from a streaming provider response.
- `TextToolCallParser.ts` parses a tool call emitted as plain JSON text by models that don't use a native tool-calling response field.
- `ModelProfiles.ts` resolves model-family capabilities and tool wire-format/message-role strategies.
- `ToolIntentGate.ts` prevents workspace tools from being offered for greetings and other non-workspace prompts.
- `ModelBehaviorTelemetry.ts` persists per-model capability and tool-loop outcomes through a host-provided storage contract.
- `contracts.ts` defines logger, provider-neutral model, tool, chat-message, and cancellation contracts.

Core modules do not import VS Code, Ollama, Node.js, or any IDE API, and are covered by unit tests (`*.test.ts`) runnable with `npm test`.

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

The provider contract includes a tool loop. The core and host expose generic tool definitions such as `read_file`; each provider adapter translates those definitions and its tool-call response format into the provider's native protocol. This keeps file access owned by the host while allowing providers such as Ollama, AnythingLLM, or an OpenAI-compatible service to participate.

The current refactor is intentionally incremental: the existing VS Code/Ollama extension remains usable while pure logic and contracts are extracted for other hosts and local LLM providers.
