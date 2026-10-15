import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAlarm } from '../src/alarms.js';
import { alarmLabel } from '../src/i18n.js';
import { commandsOf } from '../src/model.js';
import {
  PHASES,
  fanCommand,
  fanOptions,
  fanValue,
  layoutOf,
  levelOptions,
  readStove,
  silentCommand,
} from '../src/stove.js';
import { loadStove } from './helpers/fixtures.js';

const fixture = (name) => {
  const f = loadStove(name);
  return { ...f, commands: commandsOf(f.model) };
};
const M2 = fixture('m2_air');
const M1 = fixture('m1_air');
const HYDRO = fixture('m2_hydro');
const read = (f, status = {}, state = {}) =>
  readStove({ ...f.status, ...status }, { ...f.state, ...state }, f.commands);

test('the readings of the fixtures', () => {
  assert.deepEqual(read(M2), {
    connected: true,
    phase: PHASES.OFF,
    stoveText: 'Stufa spenta',
    on: false,
    heating: false,
    alarm: false,
    alarmCode: null,
    lastAlarm: null,
    mode: 'manual',
    room: 19.5,
    smoke: 24,
    setpoint: 21,
    level: '3',
    fans: { 1: '3', 2: 'auto', 3: '0' },
    eco: false,
    silent: false,
    pelletSensor: true,
    pelletLow: false,
  });
  const m1 = read(M1);
  assert.deepEqual(
    [m1.phase, m1.on, m1.heating, m1.stoveText, m1.level, m1.smoke, m1.eco, m1.fans],
    [PHASES.HEATING, true, true, 'Potenza 5', '5', 165, true, { 1: '5' }],
  );
  assert.equal(m1.connected, true, 'the State answer says false: the Status one wins');
  assert.equal(m1.pelletLow, null, 'no pellet sensor turned on');
  const hydro = read(HYDRO);
  assert.deepEqual(
    [hydro.phase, hydro.stoveText, hydro.lastAlarm, hydro.alarm, hydro.level, hydro.mode],
    [PHASES.HEATING, null, 'A02', false, '5', null],
  );
});

test('first generation: the historic Maestro states', () => {
  const phase = (code) => read(M1, { stato_stufa: code, Status: null }, { state: null }).phase;
  assert.equal(phase(0), PHASES.OFF);
  for (const code of [1, 3, 7, 10]) {
    assert.equal(phase(code), PHASES.IGNITION, String(code));
  }
  for (const code of [11, 13, 15, 31]) {
    assert.equal(phase(code), PHASES.HEATING, String(code));
  }
  assert.equal(phase(40), PHASES.SHUTDOWN);
  assert.equal(phase(41), PHASES.SHUTDOWN);
  assert.equal(phase(42), PHASES.CLEANING);
  assert.equal(phase(46), PHASES.STANDBY);
  assert.equal(phase(-1), PHASES.OFFLINE);
  assert.equal(phase(99), PHASES.UNKNOWN);
  const standby = read(M1, { stato_stufa: 46 });
  assert.deepEqual([standby.on, standby.heating], [true, false], 'eco standby is still on');
});

test('first generation: an alarm state carries its code', () => {
  const r = read(M1, { stato_stufa: 51, Status: 'Allarme A02' });
  assert.deepEqual(
    [r.phase, r.alarm, r.alarmCode, r.on, r.heating],
    [PHASES.ALARM, true, 'A02', false, false],
  );
  assert.equal(read(M1, { stato_stufa: 67 }).alarmCode, 'A17');
});

test('second generation: the codes the HA integration reads, refined by fase_op', () => {
  const phase = (code, fase) => read(M2, { stato_stufa: code, fase_op: fase }).phase;
  assert.equal(phase(-1, null), PHASES.OFFLINE);
  assert.equal(phase(0, 'off'), PHASES.OFF);
  assert.equal(phase(1, 'turning-off'), PHASES.SHUTDOWN);
  assert.equal(phase(1, null), PHASES.OFF);
  assert.equal(phase(2, 'off'), PHASES.STANDBY);
  assert.equal(phase(3, 'turning-on'), PHASES.IGNITION);
  assert.equal(phase(3, 'on'), PHASES.HEATING);
  assert.equal(phase(7, null), PHASES.HEATING);
  const igniting = read(M2, { stato_stufa: 3, fase_op: 'turning-on' });
  assert.deepEqual([igniting.on, igniting.heating], [true, false]);
});

test('without a code: fase_op, then the stove text', () => {
  const phase = (fase, own) =>
    read(M2, { stato_stufa: null, fase_op: fase, Status: own }, { state: null }).phase;
  assert.equal(phase('turning-on', null), PHASES.IGNITION);
  assert.equal(phase('on', null), PHASES.HEATING);
  assert.equal(phase(null, 'Potenza 2'), PHASES.HEATING);
  assert.equal(phase(null, 'Stufa spenta'), PHASES.OFF);
  assert.equal(phase(null, 'Spegnimento'), PHASES.SHUTDOWN);
  assert.equal(phase(null, 'Raffreddamento'), PHASES.SHUTDOWN);
  assert.equal(phase(null, 'Pulizia braciere'), PHASES.CLEANING);
  assert.equal(phase(null, 'Accensione'), PHASES.IGNITION);
  assert.equal(phase(null, 'Standby'), PHASES.STANDBY);
  assert.equal(phase(null, 'Allarme'), PHASES.ALARM);
  assert.equal(phase(null, null), PHASES.UNKNOWN);
  const unknown = read(M2, { stato_stufa: null, fase_op: null, Status: null }, { state: null });
  assert.deepEqual([unknown.on, unknown.heating], [null, null]);
});

test('IsInError is an alarm with the last alarm code; a disconnected stove is offline', () => {
  const r = read(HYDRO, { IsInError: true });
  assert.deepEqual([r.phase, r.alarm, r.alarmCode], [PHASES.ALARM, true, 'A02']);
  const offline = read(M2, { IsConnected: false });
  assert.deepEqual([offline.phase, offline.connected, offline.on], [PHASES.OFFLINE, false, null]);
});

test('alarm codes: "A2" is A02, unknown codes are kept, meanings in both languages', () => {
  assert.equal(normalizeAlarm('A2'), 'A02');
  assert.equal(normalizeAlarm(' a01 '), 'A01');
  assert.equal(normalizeAlarm('A201'), 'A201');
  assert.equal(normalizeAlarm(''), null);
  assert.equal(normalizeAlarm(null), null);
  assert.equal(normalizeAlarm(0), null);
  assert.equal(alarmLabel('A01', 'en'), 'Ignition failed');
  assert.equal(alarmLabel('A01', 'fr'), 'Échec de l’allumage');
  assert.equal(alarmLabel('A201', 'fr'), null);
});

test('values out of range are dropped, strings are read', () => {
  const r = read(
    M2,
    { temp_amb_install: 255, set_amb1: '21,5', att_eco: 'true' },
    {
      temp_fumi: 'n/a',
      temp_amb_install: 255,
    },
  );
  assert.deepEqual([r.room, r.smoke, r.setpoint, r.eco], [null, null, 21.5, true]);
  assert.deepEqual(layoutOf(r), { room: false, smoke: false, pellet: true });
});

test('fan values: speeds, presets by their mapped value or name', () => {
  const [fan] = M2.commands.fans;
  assert.equal(fanValue(fan, 0), '0');
  assert.equal(fanValue(fan, 4), '4');
  assert.equal(fanValue(fan, 6), 'auto');
  assert.equal(fanValue(fan, -1), 'silent');
  assert.equal(fanValue(fan, 'Auto'), 'auto');
  assert.equal(fanValue(fan, null), null);
});

test('select options: power levels and fan settings', () => {
  assert.deepEqual(
    levelOptions(M2.commands.level, 'fr').map((o) => [o.value, o.label]),
    [
      ['1', 'Puissance 1'],
      ['2', 'Puissance 2'],
      ['3', 'Puissance 3'],
      ['4', 'Puissance 4'],
      ['5', 'Puissance 5'],
    ],
  );
  assert.deepEqual(
    fanOptions(M2.commands.fans[0], 'en').map((o) => o.value),
    ['0', '1', '2', '3', '4', '5', 'auto', 'silent'],
  );
  assert.equal(fanOptions(M2.commands.fans[0], 'fr').at(-1).label, 'Silence');
});

test('fan commands use the configuration of the current work mode', () => {
  const manual = read(M2);
  let c = fanCommand(M2.commands, manual, 1, '4');
  assert.deepEqual([c.sensor.configurationId, c.value], ['cfg-m2-manual', 4]);
  c = fanCommand(M2.commands, read(M2, { mod_lav_att: 'auto' }), 2, 'auto');
  assert.deepEqual([c.sensor.configurationId, c.value], ['cfg-m2-auto', 'auto']);
  c = fanCommand(M2.commands, read(M2, { mod_lav_att: 'comfort' }), 1, '2');
  assert.match(c.error, /automatic in the "comfort" mode/);
  c = fanCommand(M2.commands, read(M2, { mod_lav_att: 'overnight' }), 2, '2');
  assert.match(c.error, /automatic/, 'no configuration for this fan in that mode');
  assert.match(fanCommand(M2.commands, manual, 1, '9').error, /unknown fan speed/);
  assert.match(fanCommand(M2.commands, manual, 1, '').error, /unknown fan speed/);
  assert.match(fanCommand(M2.commands, manual, 4, '1').error, /no such fan/);
});

test('fan commands of a stove without work modes use the fan configuration', () => {
  const c = fanCommand(HYDRO.commands, read(HYDRO), 1, '3');
  assert.deepEqual([c.sensor.configurationId, c.value], ['cfg-hy-room-fan', 3]);
});

test('first generation: the silent switch locks the fans, and has its own command', () => {
  const silent = read(M1, { silent_enabled: true });
  assert.match(fanCommand(M1.commands, silent, 1, '2').error, /silent mode is on/);
  assert.equal(silentCommand(M1.commands, silent).configurationId, 'cfg-m1-dynamic');
  const unknownMode = read(M1, { mod_lav_att: 'comfort' });
  assert.equal(silentCommand(M1.commands, unknownMode).configurationId, 'cfg-m1-set-v1');
  assert.equal(silentCommand(M2.commands, read(M2)), null);
});
