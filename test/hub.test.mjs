import assert from 'node:assert/strict';
import test from 'node:test';
import { harnessFreeEnv } from '../src/silka/hub.mjs';

test('TH-11: los sub-agentes no heredan variables del harness (tokens, email, CI)', () => {
  const env = harnessFreeEnv({
    PATH: 'C:/bin',
    HOME: 'C:/Users/x',
    CI: '1',
    CLAUDECODE: '1',
    CLAUDE_CODE_MESSAGING_TOKEN: 'secreto',
    CLAUDE_CODE_USER_EMAIL: 'alguien@ejemplo.com',
    CLAUDE_AGENT_SDK_VERSION: '1',
    CLAUDE_PROJECT_DIR: 'C:/p',
    OPENAI_API_KEY: 'se-mantiene',
  });
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'OPENAI_API_KEY', 'PATH']);
});
