// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake MCZ cloud built on the stove fixtures. Timers and the
// clock are mocked: the refresh interval runs when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MaestroApp } from '../src/app.js';
import { ACTIONS, SCENE_TRIGGERS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { MaestroClient } from '../src/maestro.js';
import { ACCOUNT, fakeCloud } from './helpers/fakeCloud.js';
import { loadStove } from './helpers/fixtures.js';

const CONFIG = { email: ACCOUNT.email, password: ACCOUNT.password };
const M2 = loadStove('m2_air').node;
const M1 = loadStove('m1_air').node;
const DEVICE = 'ext:test-integration:stove:2509150000001';
const M1_DEVICE = 'ext:test-integration:stove:1911140000002';
const feature = (key, device = DEVICE) => `${device}:${key}`;
const MINUTE = 60_000;

async function setup(t, { config = CONFIG, stoves = ['m2_air'], prepare } = {}) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_760_000_000_000 });
  const cloud = fakeCloud({ stoves });
  prepare?.(cloud);
  const gladys = createFakeGladys({ config });
  const app = new MaestroApp({
    gladys,
    logger: createLogger({ level: 'silent' }),
    createClient: (options) => new MaestroClient({ ...options, fetch: cloud.fetch }),
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  t.after(() => app.stop());
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) {
      await new Promise(setImmediate);
    }
  };
  /** Lets the timers run, then waits for the refresh they started. */
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    for (let i = 0; i < 5; i += 1) {
      await app.running;
      await flush();
    }
  };
  const create = async (externalId = DEVICE) => {
    const device = gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
    await gladys.fake.deviceCreated(device);
    return device;
  };
  return { gladys, app, cloud, tick, create, flush };
}

const featureOf = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
const lastCommand = (cloud) => {
  const c = cloud.state.commands.at(-1);
  return c && [c.ConfigurationId, c.Commands[0].SensorId, c.Commands[0].Value];
};

test('the stoves of the account are offered in Discovery, read once', async (t) => {
  const { gladys, cloud } = await setup(t, { stoves: ['m2_air', 'm1_air'] });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Poêle salon', 'Stove kitchen'],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /Connected to the MCZ cloud: 2 stoves/);
  assert.match(gladys.fake.connectionStatus.message.fr, /2 poêles/);
  assert.equal(gladys.fake.states.length, 0, 'no state before the user adds a stove');
  assert.deepEqual(cloud.routes(), [
    'login',
    'stoves',
    'model',
    'model',
    'ping',
    'status',
    'state',
    'ping',
    'status',
    'state',
  ]);
});

test('a created stove gets its states and badge, refreshed at the interval', async (t) => {
  const { gladys, cloud, tick, create } = await setup(t);
  await create();
  assert.equal(gladys.fake.lastState(feature('mode')), 0);
  assert.equal(gladys.fake.lastState(feature('status')), 'Éteint (Stufa spenta)');
  assert.equal(gladys.fake.lastState(feature('room')), 19.5);
  assert.equal(gladys.fake.lastState(feature('setpoint')), 21);
  assert.equal(gladys.fake.lastState(feature('power')), '3');
  assert.equal(gladys.fake.lastState(feature('fan-2')), 'auto');
  assert.equal(gladys.fake.lastState(feature('last-alarm')), 'Aucune');
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE,
    transport: DEVICE_TRANSPORTS.CLOUD,
  });

  cloud.set(M2.Id, { stato_stufa: 3, fase_op: 'turning-on', Status: 'on' }, 'status');
  const reads = cloud.count('status');
  await tick(MINUTE - 1);
  assert.equal(cloud.count('status'), reads, 'not before the interval');
  await tick(1);
  assert.equal(cloud.count('status'), reads + 1);
  assert.deepEqual(cloud.routes().slice(-3), ['ping', 'status', 'state']);
  assert.equal(gladys.fake.lastState(feature('mode')), 1);
  assert.equal(gladys.fake.lastState(feature('operating')), 0);
  assert.equal(gladys.fake.lastState(feature('status')), 'Allumage');

  const sent = gladys.fake.states.length;
  await tick(MINUTE);
  assert.equal(gladys.fake.states.length, sent, 'unchanged values are not sent again');
});

test('the refresh interval comes from the configuration, one minute at least', async (t) => {
  const { cloud, tick } = await setup(t, { config: { ...CONFIG, refresh_interval: 300 } });
  const reads = cloud.count('status');
  await tick(4 * MINUTE);
  assert.equal(cloud.count('status'), reads);
  await tick(MINUTE);
  assert.equal(cloud.count('status'), reads + 1);
});

test('on/off of a Maestro+: one press of the power button, only when needed', async (t) => {
  const { gladys, cloud, create, tick } = await setup(t);
  const device = await create();
  const mode = featureOf(device, 'mode');

  let ack = await gladys.fake.setValue(device, mode, 0);
  assert.equal(ack.success, true);
  assert.equal(cloud.state.commands.length, 0, 'already off: a press would turn it on');

  ack = await gladys.fake.setValue(device, mode, 1);
  assert.equal(ack.success, true);
  assert.deepEqual(lastCommand(cloud), ['cfg-m2-power', 'sns-m2-com-on-off', true]);
  assert.equal(cloud.state.commands[0].ModelId, M2.ModelId);
  assert.equal(cloud.state.commands[0].SensorSetTypeId, M2.SensorSetTypeId);
  assert.equal(gladys.fake.lastState(feature('mode')), 1, 'shown at once');

  // The cloud has not seen the press yet: the reading 5 s later says off.
  const reads = cloud.count('status');
  await tick(TIMINGS.refreshAfterCommand);
  assert.equal(cloud.count('status'), reads + 1);
  assert.equal(gladys.fake.lastState(feature('mode')), 0);

  // A second "on" meanwhile is not a second press (it would turn it off).
  ack = await gladys.fake.setValue(device, mode, 1);
  assert.equal(ack.success, true);
  assert.equal(cloud.state.commands.length, 1);
  ack = await gladys.fake.setValue(device, mode, 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /power command is under way/);

  // Once the readings show it on, "off" is a press again.
  cloud.set(M2.Id, { stato_stufa: 3, fase_op: 'turning-on' }, 'status');
  await tick(MINUTE);
  assert.equal(gladys.fake.lastState(feature('mode')), 1);
  ack = await gladys.fake.setValue(device, mode, 0);
  assert.equal(ack.success, true);
  assert.equal(cloud.state.commands.length, 2);
  assert.deepEqual(lastCommand(cloud), ['cfg-m2-power', 'sns-m2-com-on-off', true]);
});

test('a press the stove never shows is forgotten after the guard delay', async (t) => {
  const { gladys, cloud, create, tick } = await setup(t);
  const device = await create();
  await gladys.fake.setValue(device, featureOf(device, 'mode'), 1);
  await tick(TIMINGS.toggleGuard);
  const ack = await gladys.fake.setValue(device, featureOf(device, 'mode'), 1);
  assert.equal(ack.success, true);
  assert.equal(cloud.state.commands.length, 2, 'still off: pressed again');
});

test('on/off of a first-generation stove: the mapped on and off values', async (t) => {
  const { gladys, cloud, create } = await setup(t, { stoves: ['m1_air'] });
  const device = await create(M1_DEVICE);
  const ack = await gladys.fake.setValue(device, featureOf(device, 'mode'), 0);
  assert.equal(ack.success, true);
  assert.deepEqual(lastCommand(cloud), ['cfg-m1-power', 'sns-m1-stato-stufa', 40]);
});

test('setpoint, power level and eco are sent to their configuration', async (t) => {
  const { gladys, cloud, create } = await setup(t);
  const device = await create();

  let ack = await gladys.fake.setValue(device, featureOf(device, 'setpoint'), 21.3);
  assert.equal(ack.success, true);
  assert.deepEqual(lastCommand(cloud), ['cfg-m2-setpoint', 'sns-m2-set-amb1', 21.5]);
  assert.equal(gladys.fake.lastState(feature('setpoint')), 21.5);
  await gladys.fake.setValue(device, featureOf(device, 'setpoint'), 50);
  assert.equal(lastCommand(cloud)[2], 35, 'within the bounds of the model');

  ack = await gladys.fake.setValue(device, featureOf(device, 'power'), '4');
  assert.equal(ack.success, true);
  assert.deepEqual(lastCommand(cloud), ['cfg-m2-level', 'sns-m2-set-pot-man', 4]);
  assert.equal(gladys.fake.lastState(feature('power')), '4');
  ack = await gladys.fake.setValue(device, featureOf(device, 'power'), '9');
  assert.equal(ack.success, false);
  assert.match(ack.error, /unknown power level/);

  ack = await gladys.fake.setValue(device, featureOf(device, 'eco'), 1);
  assert.equal(ack.success, true);
  assert.deepEqual(lastCommand(cloud), ['cfg-m2-eco', 'sns-m2-att-eco', true]);
  assert.equal(gladys.fake.lastState(feature('eco')), 1);
});

test('fans follow the work mode: set in manual, refused in comfort', async (t) => {
  const { gladys, cloud, create, tick } = await setup(t);
  const device = await create();
  let ack = await gladys.fake.setValue(device, featureOf(device, 'fan-1'), '5');
  assert.equal(ack.success, true);
  assert.deepEqual(lastCommand(cloud), ['cfg-m2-manual', 'sns-m2-manual-v1', 5]);
  ack = await gladys.fake.setValue(device, featureOf(device, 'fan-3'), 'silent');
  assert.equal(ack.success, true);
  assert.deepEqual(lastCommand(cloud), ['cfg-m2-manual', 'sns-m2-manual-v3', 'silent']);
  assert.equal(gladys.fake.lastState(feature('fan-3')), 'silent');

  cloud.set(M2.Id, { mod_lav_att: 'comfort' });
  await tick(MINUTE);
  const before = cloud.state.commands.length;
  ack = await gladys.fake.setValue(device, featureOf(device, 'fan-1'), '2');
  assert.equal(ack.success, false);
  assert.match(ack.error, /automatic in the "comfort" mode/);
  assert.equal(cloud.state.commands.length, before);
});

test('the silent switch of a first-generation stove', async (t) => {
  const { gladys, cloud, create } = await setup(t, { stoves: ['m1_air'] });
  const device = await create(M1_DEVICE);
  const ack = await gladys.fake.setValue(device, featureOf(device, 'silent'), 1);
  assert.equal(ack.success, true);
  assert.deepEqual(lastCommand(cloud), ['cfg-m1-dynamic', 'sns-m1-dynamic-silent', true]);
  assert.equal(gladys.fake.lastState(feature('silent', M1_DEVICE)), 1);
});

test('read-only features and unknown stoves refuse commands', async (t) => {
  const { gladys, app, cloud, create } = await setup(t);
  const device = await create();
  let ack = await gladys.fake.setValue(device, featureOf(device, 'room'), 20);
  assert.equal(ack.success, false);
  assert.match(ack.error, /cannot be controlled/);
  ack = await gladys.fake.setValue(
    device,
    { external_id: 'ext:test-integration:stove:nope:mode' },
    1,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /not been read yet/);

  cloud.set(M2.Id, { IsConnected: false }, 'status');
  await app.refreshStove(app.stoves.get('2509150000001'));
  ack = await gladys.fake.setValue(device, featureOf(device, 'setpoint'), 20);
  assert.equal(ack.success, false);
  assert.match(ack.error, /not connected to the MCZ cloud/);
  assert.equal(cloud.state.commands.length, 0);
});

test('an alarm fires the scene trigger once, the first reading being the baseline', async (t) => {
  const { gladys, cloud, create, tick } = await setup(t, {
    prepare: (c) => c.set(loadStove('m2_air').node.Id, { IsInError: true, last_alarm: 'A1' }),
  });
  await create();
  assert.equal(gladys.fake.sceneEvents.length, 0, 'already in alarm at the start: no event');
  assert.equal(gladys.fake.lastState(feature('alarm')), 1);
  assert.equal(gladys.fake.lastState(feature('status')), 'Alarme A01 : Échec de l’allumage');

  cloud.set(M2.Id, { IsInError: false });
  await tick(MINUTE);
  assert.equal(gladys.fake.lastState(feature('alarm')), 0);
  assert.equal(gladys.fake.lastState(feature('last-alarm')), 'A01 : Échec de l’allumage');

  cloud.set(M2.Id, { IsInError: true, last_alarm: 'A04' });
  await tick(MINUTE);
  await tick(MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 1, 'once per alarm');
  const [event] = gladys.fake.sceneEvents;
  assert.equal(event.key, SCENE_TRIGGERS.STOVE_ALARM);
  assert.deepEqual(event.data, {
    stove: DEVICE,
    stove_name: 'Poêle salon',
    alarm_code: 'A04',
    alarm_label: 'Température des fumées trop élevée',
    status: 'Alarme A04 : Température des fumées trop élevée',
    summary: 'Poêle salon : alarme du poêle (A04 : Température des fumées trop élevée)',
  });
});

test('an expired token is renewed without the user noticing', async (t) => {
  const { gladys, cloud, tick } = await setup(t);
  cloud.expireTokens();
  await tick(MINUTE);
  assert.equal(cloud.count('login'), 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('refused credentials wait 15 minutes, or a new configuration', async (t) => {
  const { gladys, cloud, tick } = await setup(t, { config: { ...CONFIG, password: 'wrong' } });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the e-mail or the password/);
  await tick(14 * MINUTE);
  assert.equal(cloud.count('login'), 1, 'no account lock-out');
  await tick(MINUTE);
  assert.equal(cloud.count('login'), 2);
  await gladys.fake.configUpdated(CONFIG);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(cloud.count('login'), 3);
});

test('a missing configuration says what to fill in', async (t) => {
  const { gladys, cloud } = await setup(t, { config: {} });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /e-mail et le mot de passe/);
  assert.equal(cloud.state.requests.length, 0);
});

test('a cloud outage: unreachable badge, status, back at the next attempt', async (t) => {
  const { gladys, cloud, create, tick } = await setup(t, { stoves: ['m2_air', 'm1_air'] });
  await create();
  cloud.state.failures.set('ping', 502);
  await tick(MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, false, 'no stove answered');
  assert.match(gladys.fake.connectionStatus.message.en, /unreachable \(HTTP 502\)/);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });

  cloud.state.failures.clear();
  cloud.state.failures.set('login', 503);
  cloud.expireTokens();
  await tick(MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /unreachable \(login failed \(HTTP 503\)\)/,
  );

  cloud.state.failures.set('login', 'network');
  await tick(MINUTE);
  assert.match(
    gladys.fake.connectionStatus.message.fr,
    /injoignable \(s\.maestro\.mcz\.it: ECONNREFUSED\)/,
  );

  cloud.state.failures.clear();
  await tick(MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('one stove that does not answer leaves the others and the status alone', async (t) => {
  const { gladys, cloud, create, tick } = await setup(t, { stoves: ['m2_air', 'm1_air'] });
  await create();
  await create(M1_DEVICE);
  cloud.state.stoveFailures.set(M1.Id, 500);
  cloud.set(M2.Id, { set_amb1: 23 }, 'status');
  await tick(MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.lastState(feature('setpoint')), 23);
  const badges = Object.fromEntries(
    gladys.fake.transports.map((b) => [b.device_external_id, b.transport]),
  );
  assert.deepEqual(badges, {
    [DEVICE]: DEVICE_TRANSPORTS.CLOUD,
    [M1_DEVICE]: DEVICE_TRANSPORTS.UNREACHABLE,
  });
  cloud.state.stoveFailures.clear();
  await tick(MINUTE);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('a stove off the MCZ cloud: unreachable, degraded, with the reason', async (t) => {
  const { gladys, cloud, create, tick } = await setup(t);
  await create();
  cloud.set(M2.Id, { IsConnected: false }, 'status');
  await tick(MINUTE);
  const badge = gladys.fake.transports.at(-1);
  assert.equal(badge.transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(badge.degraded, true);
  assert.match(badge.message.en, /not connected to the MCZ cloud/);
  assert.equal(gladys.fake.lastState(feature('status')), 'Non connecté');
});

test('the test button logs in and lists the stoves', async (t) => {
  const { gladys } = await setup(t, { stoves: ['m2_air', 'm1_air'] });
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /Login OK: 2 stoves \("Poêle salon", "Stove kitchen"\)/);
});

test('the test button with wrong credentials says so', async (t) => {
  const { gladys } = await setup(t, { config: { ...CONFIG, password: 'nope' } });
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(ack.data.message.fr, /refusé l’e-mail ou le mot de passe/);
});

test('a scan lists the stoves again; a deleted device is forgotten', async (t) => {
  const { gladys, cloud, create } = await setup(t);
  const device = await create();
  await gladys.fake.scanRequest();
  assert.equal(cloud.count('stoves'), 2);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  await gladys.fake.deviceDeleted(device);
  const sent = gladys.fake.states.length;
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.states.length, sent, 'no state for a device that is gone');
});

test('Gladys reconnecting gets the devices and states again', async (t) => {
  const { gladys, app, create } = await setup(t);
  await create();
  const published = gladys.fake.states.length;
  await app.start(CONFIG);
  assert.ok(gladys.fake.states.length > published, 'the states are sent again');
});

test('commands wait for the cloud like the readings, one at a time per stove', async (t) => {
  const { gladys, cloud, create } = await setup(t);
  const device = await create();
  const order = [];
  cloud.state.onCommand = (_stove, body) => order.push(body.Commands[0].Value);
  await Promise.all([
    gladys.fake.setValue(device, featureOf(device, 'power'), '2'),
    gladys.fake.setValue(device, featureOf(device, 'power'), '5'),
  ]);
  assert.deepEqual(order, [2, 5]);
});
