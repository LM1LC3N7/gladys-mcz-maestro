// -----------------------------------------------------------------------------
// The Gladys device of a stove, and its states (pure).
//
// One device per stove of the account, offered on the Discovery screen. Its
// features follow the commands of the stove model (model.js) and what its
// first reading carries (stove.js layoutOf), with the choices of the other
// pellet stove integrations of the store (Palazzetti, Micronova Agua IOT), so
// every pellet stove looks alike in Gladys:
//   - `mode`        thermostat/mode: off / heating, the on/off switch;
//   - `setpoint`    thermostat/target-temperature, bounds of the model;
//   - `operating`   thermostat/operating-state: producing heat or not;
//   - `room`        temperature-sensor/decimal: the room temperature;
//   - `smoke`       temperature-sensor/probe: the smoke (exhaust) temperature;
//   - `status`      text: the state in words (phase, stove text, alarm);
//   - `alarm`       unknown/binary: 1 while the stove is in alarm;
//   - `last-alarm`  text: the last alarm code and its meaning;
//   - `power`       text/select: the power levels (Gladys has no "heat
//                   level" type);
//   - `fan-1..3`    text/select: off, speeds, auto (FAN_MODE has three
//                   speeds only);
//   - `eco`         switch/binary: the Start & Stop eco mode;
//   - `silent`      switch/binary: the silent mode (room fans off);
//   - `pellet`      unknown/binary: 1 when the pellet level sensor says the
//                   tank is low.
// Feature external ids end with these keys (constants.js FEATURES): never
// rename one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, FEATURES, LIMITS, OPERATING_STATE, THERMOSTAT_MODE } from './constants.js';
import { alarmLabel, texts } from './i18n.js';
import { fanOptions, levelOptions, PHASES } from './stove.js';

/** The id of a stove in the external ids: its serial number (UniqueCode). */
export function stoveId(node) {
  const id = String(node?.UniqueCode ?? node?.Id ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  return id || 'unknown';
}

export const idsOf = (gladys, node) => gladys.externalIds(DEVICE_TYPE, stoveId(node));

const sensor = (feature) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...feature,
});
const command = (feature) => ({
  read_only: false,
  has_feedback: true,
  keep_history: true,
  ...feature,
});
const select = (options) =>
  command({
    category: C.TEXT,
    type: T.TEXT.SELECT,
    keep_history: false,
    min: 0,
    max: 0,
    supported_options: options.map((o, i) => ({ ...o, sort_order: i })),
  });
const binary = (make, category, type) => make({ category, type, min: 0, max: 1 });

/**
 * @param {object} gladys the SDK client (external ids)
 * @param {{ node: object, commands: object, layout: object | null }} entry
 * @param {'en' | 'fr'} language
 */
export function buildDevice(gladys, entry, language) {
  const { node, commands } = entry;
  const layout = entry.layout ?? {};
  const ids = idsOf(gladys, node);
  const t = texts(language);
  const features = [];
  const add = (key, feature) =>
    features.push({ name: t.features[key], external_id: ids.feature(key), ...feature });

  add(
    FEATURES.MODE,
    (commands.power ? command : sensor)({
      category: C.THERMOSTAT,
      type: T.THERMOSTAT.MODE,
      min: THERMOSTAT_MODE.OFF,
      max: THERMOSTAT_MODE.HEATING,
      has_feedback: true,
      supported_options: [
        { value: THERMOSTAT_MODE.OFF, label: t.modes.off },
        { value: THERMOSTAT_MODE.HEATING, label: t.modes.heating },
      ],
    }),
  );
  if (commands.setpoint) {
    add(
      FEATURES.SETPOINT,
      command({
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        unit: U.CELSIUS,
        min: commands.setpoint.min ?? 5,
        max: commands.setpoint.max ?? 35,
        step: 0.5,
      }),
    );
  }
  add(
    FEATURES.OPERATING,
    sensor({
      category: C.THERMOSTAT,
      type: T.THERMOSTAT.OPERATING_STATE,
      min: OPERATING_STATE.IDLE,
      max: OPERATING_STATE.HEATING,
    }),
  );
  const temperature = (key, type, min, max) =>
    add(key, sensor({ category: C.TEMPERATURE_SENSOR, type, unit: U.CELSIUS, min, max }));
  if (layout.room || commands.setpoint) {
    temperature(FEATURES.ROOM, T.SENSOR.DECIMAL, -30, 100);
  }
  if (layout.smoke) {
    temperature(FEATURES.SMOKE, T.TEMPERATURE_SENSOR.PROBE, -20, 1000);
  }
  add(
    FEATURES.STATUS,
    sensor({ category: C.TEXT, type: T.TEXT.TEXT, keep_history: false, min: 0, max: 0 }),
  );
  // unknown/binary: the generic binary the Gladys front labels.
  add(FEATURES.ALARM, binary(sensor, C.UNKNOWN, T.SENSOR.BINARY));
  add(
    FEATURES.LAST_ALARM,
    sensor({ category: C.TEXT, type: T.TEXT.TEXT, keep_history: false, min: 0, max: 0 }),
  );
  if (commands.level) {
    add(FEATURES.POWER, select(levelOptions(commands.level, language)));
  }
  for (const fan of commands.fans) {
    add(`fan-${fan.n}`, select(fanOptions(fan, language)));
  }
  if (commands.eco) {
    add(FEATURES.ECO, binary(command, C.SWITCH, T.SWITCH.BINARY));
  }
  if (commands.silent) {
    add(FEATURES.SILENT, binary(command, C.SWITCH, T.SWITCH.BINARY));
  }
  if (layout.pellet) {
    add(FEATURES.PELLET, binary(sensor, C.UNKNOWN, T.SENSOR.BINARY));
  }
  const params = [];
  if (commands.name) {
    params.push({ name: 'MODEL', value: commands.name.slice(0, 100) });
  }
  if (node.UniqueCode) {
    params.push({ name: 'SERIAL', value: String(node.UniqueCode).slice(0, 100) });
  }
  return {
    name: String(node.Name || commands.name || t.stove).slice(0, LIMITS.statusText),
    external_id: ids.device,
    should_poll: false,
    params,
    features,
  };
}

/** The state in words: the alarm, else the phase with the stove's own text. */
export function statusText(reading, language) {
  const t = texts(language);
  let text;
  if (reading.alarm) {
    text = t.alarm(reading.alarmCode, alarmLabel(reading.alarmCode, language));
  } else if (reading.phase === PHASES.OFFLINE) {
    // The stove's own text is its last one before the link was lost.
    text = t.phases.offline;
  } else if (reading.phase === PHASES.UNKNOWN) {
    text = reading.stoveText ?? t.phases.unknown;
  } else {
    const phase = t.phases[reading.phase];
    const own = reading.stoveText;
    text = own && own.toLowerCase() !== phase.toLowerCase() ? `${phase} (${own})` : phase;
  }
  return text.slice(0, LIMITS.statusText);
}

/** The last alarm in words, "None" when the stove reports none. */
export function lastAlarmText(reading, language) {
  const t = texts(language);
  if (!reading.lastAlarm) {
    return t.noAlarm;
  }
  return t.lastAlarm(reading.lastAlarm, alarmLabel(reading.lastAlarm, language));
}

/**
 * The states of a reading, in the publishStates format, for the features the
 * device has.
 */
export function buildStates(gladys, entry, reading, language) {
  const ids = idsOf(gladys, entry.node);
  const device = buildDevice(gladys, entry, language);
  const has = new Set(device.features.map((f) => f.external_id));
  const states = [];
  const push = (key, value) => {
    const id = ids.feature(key);
    if (has.has(id) && value !== null && value !== undefined) {
      states.push({ device_feature_external_id: id, ...value });
    }
  };
  const number = (value) => (value === null || value === undefined ? null : { state: value });
  const bool = (value) => (value === null || value === undefined ? null : { state: Number(value) });
  const text = (value) => (value === null || value === undefined ? null : { text: String(value) });

  push(FEATURES.MODE, bool(reading.on));
  push(FEATURES.OPERATING, bool(reading.heating));
  push(FEATURES.ALARM, bool(reading.alarm));
  push(FEATURES.STATUS, text(statusText(reading, language)));
  push(FEATURES.LAST_ALARM, text(lastAlarmText(reading, language)));
  push(FEATURES.SETPOINT, number(reading.setpoint));
  push(FEATURES.ROOM, number(reading.room));
  push(FEATURES.SMOKE, number(reading.smoke));
  push(FEATURES.POWER, text(reading.level));
  for (const fan of entry.commands.fans) {
    push(`fan-${fan.n}`, text(reading.fans[fan.n]));
  }
  push(FEATURES.ECO, bool(reading.eco));
  push(FEATURES.SILENT, bool(reading.silent));
  push(FEATURES.PELLET, bool(reading.pelletLow));
  return states;
}
