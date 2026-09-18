import test from 'node:test';
import assert from 'node:assert/strict';
import { OllamaClient } from './OllamaClient';
import { GitErrorDiagnoser } from './GitErrorDiagnoser';

const dummyLogger = {
  appendLine: (_message: string) => undefined,
};

test('Autonomous Git Recovery: Non-fast-forward push rejection guides model to ask user confirmation before pulling', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const executedTools: Array<{ name: string; args: any }> = [];
  const modelPromptsReceived: any[] = [];

  const rawPushError = `
To https://github.com/athulg93/repo.git
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/athulg93/repo.git'
hint: Updates were rejected because the remote contains work that you do not have locally.
`;

  // Step 1: Model tries to run git_push
  // Step 2: Tool returns error with GitErrorDiagnoser guidance
  // Step 3: Model sees diagnosis and asks user for confirmation instead of force pushing
  const chatResponses = [
    {
      message: {
        tool_calls: [
          {
            function: {
              name: 'git_push',
              arguments: { remote: 'origin', branch: 'main' },
            },
          },
        ],
      },
    },
    {
      message: {
        content:
          'The push was rejected because the remote branch contains newer commits that are not present locally. ' +
          'Would you like me to pull the latest changes from origin/main and then retry pushing your commit?',
      },
    },
  ];

  let chatIndex = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/api/show')) {
      return new Response(JSON.stringify({ capabilities: ['tools'] }), { status: 200 });
    }

    if (String(input).includes('/api/chat')) {
      const body = JSON.parse(String(init?.body));
      modelPromptsReceived.push(body);
      const res = chatResponses[chatIndex++] ?? chatResponses[chatResponses.length - 1];
      return new Response(JSON.stringify(res), { status: 200 });
    }

    return new Response(JSON.stringify({}), { status: 200 });
  };

  try {
    const client = new OllamaClient('http://localhost:11434', dummyLogger);

    const executeTool = async (name: string, args: Record<string, unknown>) => {
      executedTools.push({ name, args });
      if (name === 'git_push') {
        const diagnosis = GitErrorDiagnoser.diagnose(name, rawPushError, args);
        return JSON.stringify({
          success: false,
          error: rawPushError,
          diagnosis,
          agentGuidance: diagnosis.agentGuidance,
        });
      }
      return JSON.stringify({ success: true });
    };

    const finalAnswer = await client.sendPromptWithTools('llama3.1:8b', 'Please push my latest changes to remote', 0.1, {
      tools: [],
      executeTool,
    });

    assert.equal(executedTools.length, 1);
    assert.equal(executedTools[0].name, 'git_push');

    // Verify model received the diagnosis guidance
    const secondCallMessages = modelPromptsReceived[1].messages;
    const toolMsg = secondCallMessages.find((m: any) => m.role === 'tool' || (m.role === 'user' && m.content.includes('GIT TOOL RESULT')));
    assert.ok(toolMsg, 'Expected tool message in chat loop');
    assert.ok(toolMsg.content.includes('PUSH_REJECTED_NON_FAST_FORWARD'));
    assert.ok(toolMsg.content.includes('NEVER execute a force push'));
    assert.ok(toolMsg.content.includes('Recommended Strategy'));

    // Verify final answer asks the user for confirmation cleanly
    assert.ok(finalAnswer.includes('pull the latest changes'));
    assert.ok(finalAnswer.includes('Would you like me to'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Autonomous Git Recovery: File overlap during pull prompts multi-step stash and sync recommendation', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const executedTools: Array<{ name: string; args: any }> = [];

  const rawPullOverlapError = `
error: Your local changes to the following files would be overwritten by merge:
\tsrc/App.tsx
\tsrc/config.json
Please commit your changes or stash them before you merge.
Aborting
`;

  const chatResponses = [
    {
      message: {
        tool_calls: [
          {
            function: {
              name: 'git_pull',
              arguments: { remote: 'origin', branch: 'main' },
            },
          },
        ],
      },
    },
    {
      message: {
        content:
          'Your local uncommitted changes in src/App.tsx and src/config.json would be overwritten by pulling from remote. ' +
          'I recommend temporarily stashing your changes, pulling the remote updates, and then re-applying your stash. ' +
          'Would you like me to proceed with this plan?',
      },
    },
  ];

  let chatIndex = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes('/api/show')) {
      return new Response(JSON.stringify({ capabilities: ['tools'] }), { status: 200 });
    }
    return new Response(JSON.stringify(chatResponses[chatIndex++] ?? chatResponses[chatResponses.length - 1]), { status: 200 });
  };

  try {
    const client = new OllamaClient('http://localhost:11434', dummyLogger);

    const executeTool = async (name: string, args: Record<string, unknown>) => {
      executedTools.push({ name, args });
      if (name === 'git_pull') {
        const diagnosis = GitErrorDiagnoser.diagnose(name, rawPullOverlapError, args);
        return JSON.stringify({
          success: false,
          error: rawPullOverlapError,
          diagnosis,
          agentGuidance: diagnosis.agentGuidance,
        });
      }
      return JSON.stringify({ success: true });
    };

    const finalAnswer = await client.sendPromptWithTools('qwen2.5-coder:7b', 'Pull latest updates from main', 0.1, {
      tools: [],
      executeTool,
    });

    assert.equal(executedTools.length, 1);
    assert.equal(executedTools[0].name, 'git_pull');
    assert.ok(finalAnswer.includes('src/App.tsx'));
    assert.ok(finalAnswer.includes('stashing your changes'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Autonomous Git Recovery: When user authorizes automated conflict resolution, agent executes remediation sequence', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const executedTools: Array<{ name: string; args: any }> = [];

  const rawPullOverlapError = `
error: Your local changes to the following files would be overwritten by merge:
\tsrc/App.tsx
Please commit your changes or stash them before you merge.
`;

  // Simulation:
  // Turn 1: git_pull fails due to local changes in App.tsx
  // Turn 2: Agent reads directive (user explicitly requested auto-recovery), calls git_stash
  // Turn 3: Agent calls git_pull (succeeds)
  // Turn 4: Agent calls git_stash pop (succeeds)
  // Turn 5: Agent reports full success
  const chatResponses = [
    {
      message: {
        tool_calls: [
          { function: { name: 'git_pull', arguments: { remote: 'origin', branch: 'main' } } },
        ],
      },
    },
    {
      message: {
        tool_calls: [
          { function: { name: 'git_stash', arguments: { action: 'push', message: 'Auto-stash before pull' } } },
        ],
      },
    },
    {
      message: {
        tool_calls: [
          { function: { name: 'git_pull', arguments: { remote: 'origin', branch: 'main' } } },
        ],
      },
    },
    {
      message: {
        tool_calls: [
          { function: { name: 'git_stash', arguments: { action: 'pop' } } },
        ],
      },
    },
    {
      message: {
        content: 'Successfully resolved file overlap by stashing your local changes, pulling remote updates, and re-applying your stash cleanly.',
      },
    },
  ];

  let chatIndex = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes('/api/show')) {
      return new Response(JSON.stringify({ capabilities: ['tools'] }), { status: 200 });
    }
    return new Response(JSON.stringify(chatResponses[chatIndex++] ?? chatResponses[chatResponses.length - 1]), { status: 200 });
  };

  try {
    const client = new OllamaClient('http://localhost:11434', dummyLogger);

    let pullAttempt = 0;
    const executeTool = async (name: string, args: Record<string, unknown>) => {
      executedTools.push({ name, args });
      if (name === 'git_pull' && pullAttempt === 0) {
        pullAttempt++;
        const diagnosis = GitErrorDiagnoser.diagnose(name, rawPullOverlapError, args);
        return JSON.stringify({
          success: false,
          error: rawPullOverlapError,
          diagnosis,
          agentGuidance: diagnosis.agentGuidance,
        });
      }
      return JSON.stringify({ success: true, message: `${name} succeeded` });
    };

    const finalAnswer = await client.sendPromptWithTools(
      'qwen2.5-coder:7b',
      'Pull latest changes from remote. If there are overlapping uncommitted files, stash them and pop them automatically.',
      0.1,
      {
        tools: [],
        executeTool,
      }
    );

    assert.deepEqual(
      executedTools.map((t) => t.name),
      ['git_pull', 'git_stash', 'git_pull', 'git_stash']
    );
    assert.equal(executedTools[1].args.action, 'push');
    assert.equal(executedTools[3].args.action, 'pop');
    assert.ok(finalAnswer.includes('Successfully resolved file overlap'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
