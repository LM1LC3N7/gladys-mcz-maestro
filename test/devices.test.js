import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildDevice, buildStates, lastAlarmText, statusText, stoveId } from '../src/devices.js';
import { commandsOf } from '../src/model.js';
import { PHASES, layoutOf, readStove } from '../src/stove.js';
import { loadStove } from './helpers/fixtures.js';

const gladys = createFakeGladys();

function entryOf(name, { status = {}, state = {} } = {}) {
  const f = loadStove(name);
  const commands = commandsOf(f.model);
  const reading = readStove({ ...f.status, ...status }, { ...f.state, ...state }, commands);
  return { node: f.node, commands, layout: layoutOf(reading), reading };
}

const keys = (device) => device.features.map((f) => f.external_id.split(':').pop());

test('the device of each stove, named after it, keyed by its serial number', () => {
  const m2 = buildDevice(gladys, entryOf('m2_air'), 'fr');
  assert.equal(m2.name, 'Poêle salon');
  assert.equal(m2.external_id, 'ext:test-integration:stove:2509150000001');
  assert.equal(m2.should_poll, false);
  assert.deepEqual(m2.params, [
    { name: 'MODEL', value: 'Air Stove - 3 Fan' },
    { name: 'SERIAL', value: '2509150000001' },
  ]);
  assert.deepEqual(keys(m2), [
    'mode',
    'setpoint',
    'operating',
    'room',
    'smoke',
    'status',
    'alarm',
    'last-alarm',
    'power',
    'fan-1',
    'fan-2',
    'fan-3',
    'eco',
    'pellet',
  ]);
  assert.deepEqual(keys(buildDevice(gladys, entryOf('m1_air'), 'fr')), [
    'mode',
    'setpoint',
    'operating',
    'room',
    'smoke',
    'status',
    'alarm',
    'last-alarm',
    'power',
    'fan-1',
    'eco',
    'silent',
  ]);
  assert.deepEqual(keys(buildDevice(gladys, entryOf('m2_hydro'), 'en')), [
    'mode',
    'setpoint',
    'operating',
    'room',
    'smoke',
    'status',
    'alarm',
    'last-alarm',
    'fan-1',
    'eco',
    'pellet',
  ]);
});

test('the features use the Gladys categories, types and bounds', async () => {
  const device = buildDevice(gladys, entryOf('m2_air'), 'en');
  const by = Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
  assert.deepEqual(
    [by.mode.category, by.mode.type, by.mode.min, by.mode.max, by.mode.read_only],
    ['thermostat', 'mode', 0, 1, false],
  );
  assert.deepEqual(
    [by.setpoint.type, by.setpoint.unit, by.setpoint.min, by.setpoint.max, by.setpoint.step],
    ['target-temperature', 'celsius', 5, 35, 0.5],
  );
  assert.deepEqual([by.operating.type, by.operating.read_only], ['operating-state', true]);
  assert.deepEqual([by.alarm.category, by.alarm.type], ['unknown', 'binary']);
  assert.deepEqual([by.eco.category, by.eco.type, by.eco.read_only], ['switch', 'binary', false]);
  assert.deepEqual([by.power.category, by.power.type], ['text', 'select']);
  assert.deepEqual(
    by['fan-1'].supported_options.map((o) => [o.value, o.label]),
    [
      ['0', 'Off'],
      ['1', 'Speed 1'],
      ['2', 'Speed 2'],
      ['3', 'Speed 3'],
      ['4', 'Speed 4'],
      ['5', 'Speed 5'],
      ['auto', 'Auto'],
      ['silent', 'Silent'],
    ],
  );
  assert.equal(by['fan-2'].name, 'Ducted fan 1');
  await gladys.connect();
  // The fake Gladys refuses what Gladys refuses (unknown category, type, unit).
  await gladys.publishDiscoveredDevices(
    ['m2_air', 'm1_air', 'm2_hydro'].map((n) => buildDevice(gladys, entryOf(n), 'fr')),
  );
  assert.equal(gladys.fake.discoveredDevices.length, 3);
});

test('a stove without a first reading still gets its commands, not its sensors', () => {
  const entry = { ...entryOf('m2_air'), layout: null };
  const device = buildDevice(gladys, entry, 'en');
  assert.ok(keys(device).includes('room'), 'a thermostat stove has a room temperature');
  assert.ok(!keys(device).includes('smoke'));
  assert.ok(!keys(device).includes('pellet'));
});

test('the states of a reading, for the features of the device only', () => {
  const entry = entryOf('m1_air');
  const states = buildStates(gladys, entry, entry.reading, 'fr');
  const by = Object.fromEntries(
    states.map((s) => [s.device_feature_external_id.split(':').pop(), s.state ?? s.text]),
  );
  assert.deepEqual(by, {
    mode: 1,
    operating: 1,
    alarm: 0,
    status: 'Chauffe (Potenza 5)',
    'last-alarm': 'Aucune',
    setpoint: 22,
    room: 21,
    smoke: 165,
    power: '5',
    'fan-1': '5',
    eco: 1,
    silent: 0,
  });
});

test('state and last alarm in words', () => {
  const alarm = entryOf('m1_air', { status: { stato_stufa: 50, Status: 'Allarme A01' } }).reading;
  assert.equal(statusText(alarm, 'fr'), 'Alarme A01 : Échec de l’allumage');
  assert.equal(statusText(alarm, 'en'), 'Alarm A01: Ignition failed');
  const hydro = entryOf('m2_hydro').reading;
  assert.equal(statusText(hydro, 'en'), 'Heating');
  assert.equal(lastAlarmText(hydro, 'en'), 'A02: Flame went out');
  assert.equal(lastAlarmText({ lastAlarm: 'A201' }, 'fr'), 'A201');
  assert.equal(lastAlarmText({ lastAlarm: null }, 'en'), 'None');
  assert.equal(
    statusText({ phase: PHASES.UNKNOWN, stoveText: 'Diagnostica' }, 'en'),
    'Diagnostica',
  );
  assert.equal(statusText({ phase: PHASES.OFFLINE, stoveText: null }, 'fr'), 'Non connecté');
});

test('the stove id is its serial number, lowercased and safe', () => {
  assert.equal(stoveId({ UniqueCode: ' AB 12/3 ', Id: 'x' }), 'ab-12-3');
  assert.equal(stoveId({ Id: 'only-id' }), 'only-id');
  assert.equal(stoveId({}), 'unknown');
});
