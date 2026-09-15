# Local LLM Architecture

The project is designed with a platform-neutral architecture to support Local Large Language Models (LLMs) across different IDEs (VS Code, JetBrains, Eclipse) and model providers (Ollama, OpenAI-compatible services).

## Core Architecture Breakdown

### 1. Core (`src/core/`)
Contains pure logic with zero dependencies on specific IDE APIs (no `vscode`, JetBrains, or Eclipse APIs) or specific LLM provider runtimes:

- **Intent & Parsing**:
  - `PromptIntentClassifier.ts`: Classifies user intent (simple chat, file editing, project-wide refactoring).
  - `EditPlanParser.ts`: Parses structured model edit plans into validated operations.
  - `TextToolCallParser.ts`: Extracts tool calls from model outputs across text-based tool protocols.
- **Safety & Validation**:
  - `PathSafety.ts`: Ensures workspace-relative paths are valid and prevents directory traversal.
- **Model Management**:
  - `ModelProfiles.ts`: Maps model families (Qwen, Llama, Gemma, Mistral, DeepSeek) to their optimal tool-calling protocols and prompt strategies.
  - `ToolIntentGate.ts`: Context-aware tool gating (e.g. filtering out mutating file tools during casual greeting chats).
- **Data Handling & Contracts**:
  - `NdjsonStream.ts`: Handles robust newline-delimited JSON streaming.
  - `ConversationHistory.ts`: Enforces history bounding and conversation lifecycle resets.
  - `contracts.ts`: Defines unified, provider-neutral interfaces for messages, tools, cancellation, logging, and model providers.

### 2. Adapters (`src/services/` & `src/extension.ts`)
Host-specific and provider-specific implementations (currently VS Code + Ollama):

- **Context & Editor**:
  - `ContextManager.ts`: Workspace discovery, file system inspection, and search.
  - `EditorManager.ts`: Manages UI interactions like previews, diff editors, and user confirmation dialogs.
- **Provider Integration**:
  - `OllamaClient.ts`: Manages the specific HTTP/streaming handshake, Ollama tool definitions, and fallbacks.
- **Git & Safety**:
  - `GitManager.ts`: Executes Host-authorized Git operations (`git_status`, `git_diff`, `git_log`, `git_branch`, `git_checkout`, `git_add`, `git_commit`, `git_pull`, `git_push`) with user approval prompts for mutating actions.
- **UI & Lifecycle**:
  - `extension.ts`: VS Code activation, chat participant registration (`@local-ollama`), commands, and configuration.
  - `ActivityLogger.ts`: Output channel logging and diagnostic history.
  - `UpdateManager.ts`: Release checking and VSIX updates.

## Key Design Principles

1. **Host-Owned Data**:
   File access, workspace discovery, and Git operations are strictly owned and executed by the Host (e.g., VS Code). The Provider (e.g., Ollama) only provides the intelligence and requests operations through structured tools; it never has direct shell or file access. Mutating actions (staging, commits, checkouts) require explicit host confirmation.

2. **Provider-Neutrality**:
   The core maps provider-specific tool formats and streaming shapes into a unified internal protocol (`contracts.ts`). Whether models emit native JSON tool calls or XML/markdown formatted text blocks, the adapters normalize them before core consumption.

3. **Incremental Refactor**:
   Existing functionality remains fully working while logic is extracted into the shared core to allow seamless expansion to future IDEs (JetBrains, Eclipse) and providers (OpenAI-compatible, LM Studio, vLLM).
