import { MAX_CONVERSATION_CHARS, MAX_CONVERSATION_MESSAGES } from '../constants';
import { ConversationMessage } from './contracts';

const CONVERSATION_RESET_REQUEST = /(?:^|\b)(?:start|begin|open)\s+(?:a\s+)?(?:new|fresh)\s+(?:chat|conversation|convo)|(?:clear|clean|reset|forget)\s+(?:the\s+)?(?:chat|conversation|convo|conversation\s+history|context|cache)|clean\s+start|start\s+fresh(?:\s+conversation)?/i;

export function isConversationResetRequest(prompt: string): boolean {
  return CONVERSATION_RESET_REQUEST.test(prompt.trim());
}

export function boundConversationHistory(
  history: readonly ConversationMessage[],
  limits: { maxMessages?: number; maxChars?: number } = {},
): ConversationMessage[] {
  const maxMessages = limits.maxMessages ?? MAX_CONVERSATION_MESSAGES;
  const maxChars = limits.maxChars ?? MAX_CONVERSATION_CHARS;
  const selected: ConversationMessage[] = [];
  let totalChars = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message.content.trim()) {
      continue;
    }

    if (selected.length >= maxMessages || totalChars + message.content.length > maxChars) {
      break;
    }

    selected.unshift(message);
    totalChars += message.content.length;
  }

  if (selected.length < history.filter((message) => message.content.trim()).length) {
    selected.unshift({
      role: 'assistant',
      content: '[Earlier conversation was omitted because the context limit was reached. Continue using the recent conversation below.]',
    });
  }

  return selected;
}