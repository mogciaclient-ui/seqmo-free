import test from 'node:test';
import assert from 'node:assert/strict';
import { aiProvider } from '../lib/ai.mjs';

test('the OpenAI key alone selects the official API and does not reach a custom endpoint', () => {
  const config = aiProvider({
    OPENAI_API_KEY: ' fixture-key ',
    SEQMO_AI_ENDPOINT: 'https://example.com/custom',
    SEQMO_AI_TOKEN: 'custom-key',
  });
  assert.equal(config.url.href, 'https://api.openai.com/v1/chat/completions');
  assert.equal(config.token, 'fixture-key');
  assert.equal(config.model, 'gpt-6-luna');
  assert.equal(config.limit, 100);
  assert.deepEqual(config.options, { store: false, reasoning_effort: 'none' });
});

test('a model override and request limit work on the OpenAI configuration', () => {
  const config = aiProvider({ OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'fixture-model', SEQMO_AI_MONTHLY_REQUESTS: '50' });
  assert.equal(config.model, 'fixture-model');
  assert.equal(config.limit, 50);
  assert.deepEqual(config.options, { store: false });
  assert.equal(aiProvider({ OPENAI_API_KEY: 'test-key', SEQMO_AI_MONTHLY_REQUESTS: '0' }), null);
});

test('the alternative provider keeps its explicit no-training and limit settings', () => {
  const env = {
    SEQMO_AI_ENDPOINT: 'https://example.com/custom', SEQMO_AI_TOKEN: 'fixture-key',
    SEQMO_AI_MODEL: 'fixture-model', SEQMO_AI_MONTHLY_REQUESTS: '10',
  };
  assert.equal(aiProvider(env), null);
  assert.equal(aiProvider({ ...env, SEQMO_AI_NO_TRAINING: '1' }).url.href, env.SEQMO_AI_ENDPOINT);
  assert.equal(aiProvider({ ...env, SEQMO_AI_NO_TRAINING: '1', SEQMO_AI_ENDPOINT: 'http://example.com' }), null);
});
