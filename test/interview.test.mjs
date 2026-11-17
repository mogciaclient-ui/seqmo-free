import test from 'node:test';
import assert from 'node:assert/strict';
import { interviewContext, interviewNextStep, parseInterview } from '../lib/interview.mjs';

test('the five staff interview questions accept preset answers and expose only approved labels', () => {
  const answers = parseInterview({ purpose: 'internal', builder: 'vendor', maintenance: 'none', data: 'yes', concerns: ['spoofing', 'spoofing'], additional: 'private' });
  assert.equal(interviewContext(answers).length, 5);
  assert.deepEqual(answers.concerns, ['spoofing']);
  assert.match(interviewNextStep(answers), /制作会社の窓口.*個人情報/);
  assert.doesNotMatch(JSON.stringify(answers), /private/);
  assert.equal(parseInterview({ concerns: ['unknown', 'spam'] }), null);
  assert.equal(parseInterview({ builder: 'random input' }), null);
});
