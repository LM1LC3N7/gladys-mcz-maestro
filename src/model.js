// -----------------------------------------------------------------------------
// The model of a stove: which commands it accepts, and how (pure).
//
// The cloud describes each stove model as configurations ("Spegnimento",
// "Set_amb_temp", "Set_pot", one per work mode…), each listing its sensors:
// SensorId, type (boolean, int, double, string), Min/Max, Variants and
// Mappings, Enabled. A command is a value for a sensor of one configuration.
// The names below are those the Home Assistant integration Robbe-B/maestro_mcz
// matches (maestro/models/models.py, Apache-2.0), checked against public
// diagnostics of real stoves: the second generation (Maestro+, "M2") names
// its sensors `com_on_off`, `set_amb1`…, the first generation ("M1", moved to
// the new cloud by the Upgrade app) prefixes them with `m1_`.
// -----------------------------------------------------------------------------

export const GENERATIONS = { M1: 'M1', M2: 'M2' };

export const SENSOR_TYPES = { BOOLEAN: 'boolean', INT: 'int', DOUBLE: 'double', STRING: 'string' };

/** Commands by role: the first [configuration, sensor] the model has wins. */
export const COMMANDS = {
  power: [
    ['Spegnimento', 'com_on_off', GENERATIONS.M2],
    ['Spegnimento', 'm1_stato_stufa', GENERATIONS.M1],
  ],
  setpoint: [
    ['Set_amb_temp', 'set_amb1', GENERATIONS.M2],
    ['Set_amb_temp', 'm1_set_amb1', GENERATIONS.M1],
  ],
  level: [
    ['Set_pot', 'set_pot_man', GENERATIONS.M2],
    ['Set_pot', 'm1_potenza_att', GENERATIONS.M1],
  ],
  eco: [
    ['Start&Stop', 'att_eco', GENERATIONS.M2],
    ['Start&Stop', 'm1_att_eco', GENERATIONS.M1],
  ],
};

/** Work mode (`mod_lav_att` of the readings) -> the configuration of its fan settings. */
export const MODE_CONFIGURATIONS = {
  [GENERATIONS.M2]: {
    manual: 'Manuale',
    auto: 'Auto',
    overnight: 'Overnight',
    comfort: 'Comfort',
    turbo: 'Turbo',
  },
  [GENERATIONS.M1]: {
    manual: 'Manuale',
    dynamic: 'Dynamic',
    overnight: 'Overnight',
    comfort: 'Comfort',
    power: 'Power',
  },
};

/**
 * The fans: one sensor (read under the M2 name in the readings), set in the
 * configuration of the current work mode, else in a configuration of its own
 * (M1 `set_v1`…, M2 hydro `set_vent_room`).
 */
export const FANS = [1, 2, 3].map((n) => ({
  n,
  read: `set_vent_v${n}`,
  sensors: { [GENERATIONS.M2]: `set_vent_v${n}`, [GENERATIONS.M1]: `m1_set_vent_v${n}` },
  fixed: {
    [GENERATIONS.M2]: n === 1 ? ['set_vent_room'] : [],
    [GENERATIONS.M1]: [`set_v${n}`],
  },
}));

/** The silent mode of the first generation: a boolean sensor of several configurations. */
export const SILENT_SENSORS = ['silent_enabled', 'm1_silent_enabled'];

const same = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.trim().toLowerCase() === b.trim().toLowerCase();

export const number = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function sensorOf(configuration, sensor) {
  return {
    configuration: String(configuration.ConfigurationName ?? '').trim(),
    configurationId: configuration.ConfigurationId,
    sensorId: sensor.SensorId,
    name: sensor.SensorName,
    type: String(sensor.Type ?? '').toLowerCase(),
    min: number(sensor.Min),
    max: number(sensor.Max),
    variants: Array.isArray(sensor.Variants) ? sensor.Variants.map(String) : [],
    mappings:
      sensor.Mappings && typeof sensor.Mappings === 'object' && !Array.isArray(sensor.Mappings)
        ? sensor.Mappings
        : {},
    enabled: sensor.Enabled !== false,
  };
}

/**
 * A sensor of a configuration of the model, or null (names compared without
 * case nor surrounding spaces: a hydro model names one " Start&Stop").
 * @returns {{ configuration: string, configurationId: string, sensorId: string,
 *   name: string, type: string, min: number | null, max: number | null,
 *   variants: string[], mappings: Record<string, unknown>, enabled: boolean } | null}
 */
export function findSensor(model, configurationName, sensorName) {
  for (const configuration of model?.ModelConfigurations ?? []) {
    if (!same(configuration?.ConfigurationName, configurationName)) {
      continue;
    }
    const sensor = (configuration.Configurations ?? []).find((s) =>
      same(s?.SensorName, sensorName),
    );
    if (sensor?.SensorId && configuration.ConfigurationId) {
      return sensorOf(configuration, sensor);
    }
  }
  return null;
}

/** Every configuration holding one of these sensors. */
export function findEverywhere(model, sensorNames) {
  const found = [];
  for (const configuration of model?.ModelConfigurations ?? []) {
    for (const sensor of configuration?.Configurations ?? []) {
      if (
        sensor?.SensorId &&
        configuration.ConfigurationId &&
        sensorNames.some((name) => same(sensor.SensorName, name))
      ) {
        found.push(sensorOf(configuration, sensor));
      }
    }
  }
  return found;
}

/** The first candidate the model has: { generation, ...sensor } or null. */
function first(model, candidates) {
  for (const [configuration, sensor, generation] of candidates) {
    const found = findSensor(model, configuration, sensor);
    if (found) {
      return { generation, ...found };
    }
  }
  return null;
}

/** The named presets of a fan sensor ("auto", "silent"): its mapped, non-numeric variants. */
const presetsOf = (sensor) =>
  sensor.variants.filter(
    (v) => Object.hasOwn(sensor.mappings, v) && v !== 'off' && number(v) === null,
  );

/** The highest speed of a fan sensor: its max, presets excluded ("auto" is 6 on a 0–6 range). */
function topSpeed(sensor) {
  const presetValues = new Set(presetsOf(sensor).map((p) => number(sensor.mappings[p])));
  let top = Math.round(sensor.max ?? 0);
  while (top > 0 && presetValues.has(top)) {
    top -= 1;
  }
  return Math.max(0, Math.min(top, 10));
}

function fanOf(model, fan, generation) {
  const modes = {};
  for (const [mode, configuration] of Object.entries(MODE_CONFIGURATIONS[generation])) {
    const sensor = findSensor(model, configuration, fan.sensors[generation]);
    if (sensor) {
      modes[mode] = sensor;
    }
  }
  const fixed =
    fan.fixed[generation]
      .map((configuration) => findSensor(model, configuration, fan.sensors[generation]))
      .find(Boolean) ?? null;
  const sensors = [...Object.values(modes), ...(fixed ? [fixed] : [])];
  if (sensors.length === 0) {
    return null;
  }
  return {
    n: fan.n,
    read: fan.read,
    modes,
    fixed,
    // One option list for every mode: off, the speeds, the named presets.
    speeds: Math.max(...sensors.map(topSpeed)),
    presets: [...new Set(sensors.flatMap(presetsOf))],
  };
}

/**
 * What a model accepts, by role.
 * @returns {{ generation: string | null, name: string, power, setpoint, level, eco,
 *   silent: object[] | null, fans: Array<{ n: number, read: string,
 *   modes: Record<string, object>, fixed: object | null, speeds: number,
 *   presets: string[] }> }}
 */
export function commandsOf(model) {
  const commands = {
    name: String(model?.ModelName ?? '').trim(),
    power: first(model, COMMANDS.power),
    setpoint: first(model, COMMANDS.setpoint),
    level: first(model, COMMANDS.level),
    eco: first(model, COMMANDS.eco),
    fans: [],
  };
  // The generation of the on/off command, else of any command found.
  commands.generation =
    [commands.power, commands.setpoint, commands.level, commands.eco].find(Boolean)?.generation ??
    null;
  const generation = commands.generation ?? GENERATIONS.M2;
  commands.fans = FANS.map((fan) => fanOf(model, fan, generation)).filter(Boolean);
  const silent = findEverywhere(model, SILENT_SENSORS).filter(
    (s) => s.type === SENSOR_TYPES.BOOLEAN,
  );
  commands.silent = silent.length > 0 ? silent : null;
  return commands;
}

/**
 * The value that turns the stove on or off. A boolean on/off sensor is a
 * press of the power button: `true` toggles (as the HA integration and the
 * ioBroker adapter found), so it is sent only when the stove is in the other
 * state. An int sensor maps "on" and "off" to its own values (M1: 1 and 40).
 */
export function onOffValue(sensor, on) {
  if (sensor.type === SENSOR_TYPES.BOOLEAN) {
    return true;
  }
  return number(sensor.mappings[on ? 'on' : 'off']);
}

/** The value of a switch command (eco, silent): booleans as such, else the on/off mappings. */
export function switchValue(sensor, on) {
  if (sensor.type === SENSOR_TYPES.BOOLEAN) {
    return on;
  }
  return number(sensor.mappings[on ? 'on' : 'off']);
}
