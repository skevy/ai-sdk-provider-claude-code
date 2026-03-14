/**
 * Persistent Session Example
 *
 * Demonstrates keeping a Claude Code process alive across multiple
 * streamText() calls. The process starts once and subsequent messages
 * are injected into the running session — no restart overhead.
 *
 * Key pattern: create the model instance ONCE per session and reuse it.
 * The model holds the persistent process state internally.
 */

import { streamText } from 'ai';
import { claudeCode, type ClaudeCodeLanguageModel } from '../dist/index.js';

// Store model instances by session ID. Each instance holds a persistent process.
const sessions = new Map<string, ClaudeCodeLanguageModel>();

function getOrCreateModel(sessionId: string): ClaudeCodeLanguageModel {
  let model = sessions.get(sessionId);
  if (model) return model;

  model = claudeCode('sonnet', {
    persistentSession: true,
    sessionId,
    onStreamStart: (injector) => {
      console.log(`[${sessionId}] Process started, injector ready`);
    },
  }) as ClaudeCodeLanguageModel;

  sessions.set(sessionId, model);
  return model;
}

function destroySession(sessionId: string) {
  const model = sessions.get(sessionId);
  if (model) {
    model.destroyPersistentSession();
    sessions.delete(sessionId);
    console.log(`[${sessionId}] Session destroyed`);
  }
}

async function main() {
  const sessionId = 'demo-session';
  const model = getOrCreateModel(sessionId);

  // Turn 1: spawns the Claude Code process
  console.log('\n--- Turn 1 ---');
  const result1 = streamText({
    model,
    prompt: 'What files are in the current directory? Just list the first 5.',
  });

  for await (const chunk of result1.textStream) {
    process.stdout.write(chunk);
  }
  console.log('\n');

  // Turn 2: reuses the same process (no restart!)
  console.log('--- Turn 2 ---');
  const result2 = streamText({
    model,
    prompt: 'Now count how many of those files are TypeScript files.',
  });

  for await (const chunk of result2.textStream) {
    process.stdout.write(chunk);
  }
  console.log('\n');

  // Clean up: destroy the persistent session
  destroySession(sessionId);
}

main().catch(console.error);
