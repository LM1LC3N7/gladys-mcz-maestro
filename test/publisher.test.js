import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Publisher } from '../src/publisher.js';

const silent = { warn() {}, debug() {}, info() {}, error() {} };

async function setup({ stateBudget, eventBudget } = {}) {
  let now = 1_000_000;
  const gladys = createFakeGladys();
  await gladys.connect();
  const p = new Publisher({ gladys, logger: silent, now: () => now, stateBudget, eventBudget });
  return { gladys, p, advance: (ms) => (now += ms) };
}

const id = (n) => `ext:test-integration:stove:s${n}:room`;
const state = (n, value) => ({ device_feature_external_id: id(n), state: value });

test('only the last value of a feature is sent, and an unchanged one is skipped', async () => {
  const { gladys, p } = await setup();
  p.push([state(1, 20), state(1, 21), { device_feature_external_id: id(2), text: 'On' }]);
  assert.deepEqual(await p.flush(), { states: 2, events: 0 });
  assert.deepEqual(
    gladys.fake.states.map((s) => [s.device_feature_external_id, s.state ?? s.text]),
    [
      [id(1), 21],
      [id(2), 'On'],
    ],
  );
  p.push([state(1, 21)]);
  assert.deepEqual(await p.flush(), { states: 0, events: 0 });
});

test('the per-minute budget holds the rest for later', async () => {
  const { gladys, p, advance } = await setup({ stateBudget: 3 });
  p.push([0, 1, 2, 3, 4].map((n) => state(n, n)));
  assert.equal((await p.flush()).states, 3);
  assert.equal((await p.flush()).states, 0, 'budget spent');
  advance(60_000);
  assert.equal((await p.flush()).states, 2);
  assert.equal(gladys.fake.states.length, 5);
});

test('scene events are all sent, in order, within their own budget', async () => {
  const { gladys, p, advance } = await setup({ eventBudget: 2 });
  p.pushSceneEvent('stove_alarm', { stove_name: 'a' });
  p.pushSceneEvent('stove_alarm', { stove_name: 'a' });
  p.pushSceneEvent('stove_alarm', { stove_name: 'b' });
  assert.equal((await p.flush()).events, 2);
  advance(60_000);
  assert.equal((await p.flush()).events, 1);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.data?.stove_name ?? e.stove_name),
    ['a', 'a', 'b'],
  );
});

test('a rate-limited event waits, a refused one is dropped, the states still go', async (t) => {
  const { gladys, p } = await setup();
  let calls = 0;
  t.mock.method(gladys, 'publishSceneEvent', async (key) => {
    calls += 1;
    if (key === 'undeclared') {
      throw new GladysApiError(404, 'NOT_FOUND', 'unknown scene trigger');
    }
    throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'max 300 events per minute');
  });
  p.pushSceneEvent('undeclared', {});
  p.pushSceneEvent('stove_alarm', {});
  p.push([state(1, 20)]);
  await assert.rejects(p.flush(), /300 events/);
  assert.equal(calls, 2);
  assert.deepEqual(
    p.events.map((e) => e.key),
    ['stove_alarm'],
  );
  assert.equal(gladys.fake.lastState(id(1)), 20, 'the states were sent anyway');
});

test('a failed state request keeps the values, unless a newer one arrived', async (t) => {
  const { gladys, p } = await setup();
  t.mock.method(gladys, 'publishChangedStates', async () => {
    throw new Error('429');
  });
  p.push([state(1, 20)]);
  await assert.rejects(p.flush(), /429/);
  assert.deepEqual(p.pending.get(id(1)), { state: 20 });
  p.forget('ext:test-integration:stove:s1');
  assert.equal(p.pending.size, 0);
});

test('the queue of events is bounded', async () => {
  const { p } = await setup();
  for (let i = 0; i < 150; i += 1) {
    p.pushSceneEvent('stove_alarm', { n: i });
  }
  assert.equal(p.events.length, 100);
  assert.equal(p.events[0].data.n, 50);
});

test('start and stop drive the flush timer', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { gladys, p } = await setup();
  p.start();
  p.push([state(1, 20)]);
  t.mock.timers.tick(1000);
  await p.flushing;
  assert.equal(gladys.fake.lastState(id(1)), 20);
  p.stop();
  p.push([state(1, 21)]);
  t.mock.timers.tick(5000);
  assert.equal(p.flushing, undefined);
});
