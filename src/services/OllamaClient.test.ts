import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OllamaClient } from './OllamaClient';

const logger = {
  appendLine: (_message: string) => undefined,
};

test('keeps a planning response internal and completes the request before returning', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const chatRequests: Array<{ messages: unknown[] }> = [];
  const responses = [
    new Response(JSON.stringify({ capabilities: ['tools'] }), { status: 200 }),
    new Response(JSON.stringify({ message: { content: "I'll inspect the repository and review the relevant files." } }), { status: 200 }),
    new Response(JSON.stringify({ message: { content: 'The review is complete. The issue is caused by early finalization.' } }), { status: 200 }),
  ];

  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/api/chat')) {
      chatRequests.push(JSON.parse(String(init?.body)) as { messages: unknown[] });
    }

    const response = responses.shift();
    if (!response) {
      throw new Error('Unexpected Ollama request');
    }

    return response;
  };

  try {
    const client = new OllamaClient('http://localhost:11434', logger);
    const result = await client.sendPromptWithTools('qwen2.5-coder:7b', 'review this repository', 0.2, {
      tools: [],
      executeTool: async () => 'unused',
    });

    assert.equal(result, 'The review is complete. The issue is caused by early finalization.');
    assert.equal(chatRequests.length, 2);
    assert.match(JSON.stringify(chatRequests[1]?.messages), /Do not stop at a plan/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('allows multiple native tool rounds before the final answer', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const chatResponses = [
    { message: { tool_calls: [{ function: { name: 'read_file', arguments: { path: 'src/a.ts' } } }] } },
    { message: { tool_calls: [{ function: { name: 'read_file', arguments: { path: 'src/b.ts' } } }] } },
    { message: { content: 'Both files were inspected and the analysis is complete.' } },
    { message: { content: 'Both files were inspected and the analysis is complete.' } },
  ];
  let chatIndex = 0;

  globalThis.fetch = async (input) => {
    if (String(input).includes('/api/show')) {
      return new Response(JSON.stringify({ capabilities: ['tools'] }), { status: 200 });
    }

    return new Response(JSON.stringify(chatResponses[chatIndex++] ?? {}), { status: 200 });
  };

  try {
    const client = new OllamaClient('http://localhost:11434', logger);
    const executedPaths: string[] = [];
    const result = await client.sendPromptWithTools('qwen2.5-coder:7b', 'review this repository', 0.2, {
      tools: [{ name: 'read_file', description: 'Read a file', parameters: {} }],
      executeTool: async (_name, arguments_) => {
        executedPaths.push(String(arguments_.path));
        return `content for ${String(arguments_.path)}`;
      },
    });

    assert.equal(result, 'Both files were inspected and the analysis is complete.');
    assert.deepEqual(executedPaths, ['src/a.ts', 'src/b.ts']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});