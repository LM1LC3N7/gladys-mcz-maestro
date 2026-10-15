// -----------------------------------------------------------------------------
// A stove reading: the Status and State answers of the cloud -> phase, on/off,
// temperatures, setpoint, power level, fans, modes, alarm (pure).
//
// Field names are those of the cloud answers, as the Home Assistant
// integration Robbe-B/maestro_mcz parses them (maestro/controller/responses,
// Apache-2.0). The Status answer holds the stove settings and state, the State
// answer its live values; when both carry a field, the Status one wins (as in
// the HA integration), except the live temperatures.
// -----------------------------------------------------------------------------

import { alarmFromState, normalizeAlarm } from './alarms.js';
import { texts } from './i18n.js';
import { GENERATIONS, MODE_CONFIGURATIONS, number } from './model.js';

export const PHASES = {
  OFF: 'off',
  IGNITION: 'ignition',
  HEATING: 'heating',
  CLEANING: 'cleaning',
  STANDBY: 'standby',
  SHUTDOWN: 'shutdown',
  ALARM: 'alarm',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
};

/** Phases where the stove is "on" for the user (the on/off switch shows on). */
const ON_PHASES = new Set([PHASES.IGNITION, PHASES.HEATING, PHASES.CLEANING, PHASES.STANDBY]);

/** Stove texts that only repeat the phase in English ("on" on Maestro+). */
const BARE_TEXTS = new Set(['on', 'off', 'unknown']);

const bool = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'string') {
    return ['true', '1', 'on'].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
};
const text = (value) =>
  value === null || value === undefined || String(value).trim() === ''
    ? null
    : String(value).trim();
/** A temperature, or null when out of the range a probe can read. */
const temperature = (value, min, max) => {
  const n = number(value);
  return n === null || n < min || n > max ? null : n;
};

/**
 * `stato_stufa` of the first generation: the historic Maestro states (the
 * numbers the stoves sent on the old socket.io cloud, listed by the
 * maestrogateway project; the HA diagnostics show 0 "Stufa spenta" and
 * 11–15 "Potenza 1–5"): 0 off, 1–10 ignition (checks, cleaning, pellet load,
 * start 1/2, stabilisation), 11–15 power 1–5, 31 on, 40–41 extinction and
 * cooling, 42–43 cleaning, 45–46 eco standby, 50–69 alarms.
 */
function phaseOfM1(code) {
  if (code === -1) {
    return PHASES.OFFLINE;
  }
  if (code === 0) {
    return PHASES.OFF;
  }
  if (code >= 1 && code <= 10) {
    return PHASES.IGNITION;
  }
  if ((code >= 11 && code <= 15) || code === 31) {
    return PHASES.HEATING;
  }
  if (code === 40 || code === 41) {
    return PHASES.SHUTDOWN;
  }
  if (code === 42 || code === 43) {
    return PHASES.CLEANING;
  }
  if (code === 45 || code === 46) {
    return PHASES.STANDBY;
  }
  if (code >= 50 && code <= 69) {
    return PHASES.ALARM;
  }
  return PHASES.UNKNOWN;
}

/**
 * `stato_stufa` of the second generation (Maestro+), as the HA integration
 * reads it: -1 disconnected, 0 off, 1 turning off, 2 standby, 3 on (igniting
 * while `fase_op` is "turning-on"); any other code is heating.
 */
function phaseOfM2(code, fase) {
  switch (code) {
    case -1:
      return PHASES.OFFLINE;
    case 0:
      return PHASES.OFF;
    case 1:
      return fase === 'turning-off' ? PHASES.SHUTDOWN : PHASES.OFF;
    case 2:
      return PHASES.STANDBY;
    case 3:
      return fase === 'turning-on' ? PHASES.IGNITION : PHASES.HEATING;
    default:
      return PHASES.HEATING;
  }
}

/** `fase_op` alone ("off", "on", "turning-on", "turning-off"), when there is no code. */
function phaseOfFase(fase) {
  switch (fase) {
    case 'off':
      return PHASES.OFF;
    case 'on':
      return PHASES.HEATING;
    case 'turning-on':
      return PHASES.IGNITION;
    case 'turning-off':
      return PHASES.SHUTDOWN;
    default:
      return PHASES.UNKNOWN;
  }
}

/** The stove's own text, Italian on the first generation: "Stufa spenta", "Potenza 3"… */
function phaseOfText(own) {
  const t = String(own ?? '').toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));
  if (!t) {
    return PHASES.UNKNOWN;
  }
  if (has('allarm', 'alarm')) {
    return PHASES.ALARM;
  }
  if (has('spegniment', 'raffredd')) {
    return PHASES.SHUTDOWN;
  }
  if (has('spent') || t === 'off') {
    return PHASES.OFF;
  }
  if (has('pulizia', 'clean')) {
    return PHASES.CLEANING;
  }
  if (has('standby', 'attesa')) {
    return PHASES.STANDBY;
  }
  if (has('accension', 'avvio', 'carico', 'stabilizz', 'controllo')) {
    return PHASES.IGNITION;
  }
  if (has('potenza', 'power', 'lavoro') || t === 'on') {
    return PHASES.HEATING;
  }
  return PHASES.UNKNOWN;
}

/** A fan value of the readings -> the option value of its select ("0", "3", "auto", "silent"). */
export function fanValue(fan, raw) {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const n = number(raw);
  if (n === null) {
    return String(raw).trim().toLowerCase();
  }
  if (n !== 0) {
    const sensors = [...Object.values(fan.modes), ...(fan.fixed ? [fan.fixed] : [])];
    for (const preset of fan.presets) {
      if (sensors.some((sensor) => number(sensor.mappings[preset]) === n)) {
        return preset;
      }
    }
  }
  return String(Math.round(n));
}

/**
 * @param {object} status the Status answer
 * @param {object} state the State answer
 * @param {object} commands commandsOf(model)
 */
export function readStove(status, state, commands = { fans: [] }) {
  const s = status ?? {};
  const l = state ?? {};
  const pick = (...keys) => {
    for (const source of [s, l]) {
      for (const key of keys) {
        if (source[key] !== null && source[key] !== undefined) {
          return source[key];
        }
      }
    }
    return null;
  };
  // The State answer says IsConnected false on stoves the Status answer says
  // connected (HA diagnostics): the Status one is the reference.
  const connected = bool(s.IsConnected ?? l.IsConnected) !== false;
  const code = number(s.stato_stufa);
  const fase = text(s.fase_op)?.toLowerCase() ?? null;
  const stoveText =
    [text(s.Status), text(l.state)].find((t) => t && !BARE_TEXTS.has(t.toLowerCase())) ?? null;
  const generation = commands.generation ?? GENERATIONS.M2;

  let phase;
  if (code === null) {
    phase = phaseOfFase(fase);
  } else {
    phase = generation === GENERATIONS.M1 ? phaseOfM1(code) : phaseOfM2(code, fase);
  }
  if (phase === PHASES.UNKNOWN) {
    phase = phaseOfText(stoveText ?? text(l.state));
  }
  const fromState = generation === GENERATIONS.M1 ? alarmFromState(code) : null;
  const lastAlarm = normalizeAlarm(l.last_alarm ?? s.last_alarm);
  const alarm = bool(pick('IsInError')) === true || phase === PHASES.ALARM;
  if (alarm) {
    phase = PHASES.ALARM;
  } else if (!connected) {
    phase = PHASES.OFFLINE;
  }
  const known = phase !== PHASES.OFFLINE && phase !== PHASES.UNKNOWN;

  const fans = {};
  for (const fan of commands.fans ?? []) {
    fans[fan.n] = fanValue(fan, s[fan.read] ?? l[fan.read]);
  }
  const level = number(pick('set_pot_man', 'potenza_att'));
  const pelletSensor = bool(pick('sens_liv_pellet')) === true;
  return {
    connected,
    phase,
    stoveText,
    on: known ? ON_PHASES.has(phase) : null,
    heating: known ? phase === PHASES.HEATING : null,
    alarm,
    alarmCode: alarm ? (fromState ?? lastAlarm) : null,
    lastAlarm: lastAlarm ?? fromState,
    mode: text(pick('mod_lav_att'))?.toLowerCase() ?? null,
    room: temperature(l.temp_amb_install ?? s.temp_amb_install, -30, 100),
    smoke: temperature(l.temp_fumi ?? s.temp_fumi, -20, 1000),
    setpoint: temperature(pick('set_amb1'), 0, 100),
    level: level === null ? null : String(Math.round(level)),
    fans,
    eco: bool(pick('att_eco')),
    silent: bool(pick('silent_enabled')),
    // `sens_liv_pellet` says the stove has its pellet level sensor turned on,
    // `sens_liv_pel` is that sensor (to check on a real stove: TODO.md).
    pelletSensor,
    pelletLow: pelletSensor ? bool(pick('sens_liv_pel')) : null,
  };
}

/** Which read-only features a stove has, from its first good reading. */
export function layoutOf(reading) {
  return {
    room: reading.room !== null,
    smoke: reading.smoke !== null,
    pellet: reading.pelletSensor,
  };
}

/** The options of the power level select: the bounds of the model, 1–5 by default. */
export function levelOptions(sensor, language) {
  const t = texts(language);
  const min = Math.max(0, Math.round(sensor.min ?? 1));
  const max = Math.min(10, Math.max(min, Math.round(sensor.max ?? 5)));
  const options = [];
  for (let n = min; n <= max; n += 1) {
    options.push({ value: String(n), label: t.level(n) });
  }
  return options;
}

/** The options of a fan select: off, the speeds, the presets of the model. */
export function fanOptions(fan, language) {
  const t = texts(language).fan;
  const options = [{ value: '0', label: t.off }];
  for (let n = 1; n <= fan.speeds; n += 1) {
    options.push({ value: String(n), label: t.speed(n) });
  }
  for (const preset of fan.presets) {
    options.push({ value: preset, label: t[preset] ?? preset });
  }
  return options;
}

/**
 * The command of a fan select. As the HA integration does, the sensor of the
 * configuration of the current work mode (each mode has its own fan settings,
 * "comfort" and "overnight" drive the fans themselves); a stove without work
 * modes uses the fan's own configuration.
 * @returns {{ sensor: object, value: number | string } | { error: string }}
 */
export function fanCommand(commands, reading, n, option) {
  const fan = commands.fans.find((f) => f.n === n);
  if (!fan) {
    return { error: 'this stove has no such fan' };
  }
  if (reading.silent && commands.silent) {
    return { error: 'the silent mode is on: turn it off to set the fans' };
  }
  const forMode = reading.mode ? fan.modes[reading.mode] : undefined;
  const sensor = forMode ?? fan.fixed;
  if (!sensor || !sensor.enabled) {
    return {
      error: `the fans are automatic in the "${reading.mode ?? '?'}" mode of the stove: switch it to manual to set them`,
    };
  }
  const value = String(option ?? '')
    .trim()
    .toLowerCase();
  if (fan.presets.includes(value)) {
    if (!Object.hasOwn(sensor.mappings, value)) {
      return { error: `"${value}" is not available in the "${reading.mode}" mode` };
    }
    // The preset name, like the HA integration sends it: the cloud maps it.
    return { sensor, value };
  }
  const speed = Number(value);
  if (value === '' || !Number.isInteger(speed) || speed < 0 || speed > fan.speeds) {
    return { error: `unknown fan speed ${option}` };
  }
  return { sensor, value: speed };
}

/**
 * The silent mode command (first generation): the configuration of the
 * current work mode when it holds the silent sensor, else a fan
 * configuration (`set_v1`), else the first one that has it.
 */
export function silentCommand(commands, reading) {
  const sensors = (commands.silent ?? []).filter((s) => s.enabled);
  if (sensors.length === 0) {
    return null;
  }
  const generation = commands.generation ?? GENERATIONS.M2;
  const current = MODE_CONFIGURATIONS[generation][reading.mode];
  const named = (name) => (s) => s.configuration.toLowerCase() === name.toLowerCase();
  return (
    (current && sensors.find(named(current))) ??
    sensors.find((s) => /^set_v\d$/i.test(s.configuration)) ??
    sensors[0]
  );
}
