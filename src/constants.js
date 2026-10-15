// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their scenes and
// configuration) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/** Manifest `scene_triggers` keys. */
export const SCENE_TRIGGERS = {
  STOVE_ALARM: 'stove_alarm',
};

/** Languages of the device texts (manifest `language` option values). */
export const LANGUAGES = ['fr', 'en'];

/** Refresh interval of the stoves (seconds), mirrored by the manifest. */
export const REFRESH_INTERVAL = { min: 60, max: 3600, default: 60 };

/** Device type of the external ids: ext:<selector>:stove:<serial>. */
export const DEVICE_TYPE = 'stove';

/** Feature keys, the end of the feature external ids: never rename one. */
export const FEATURES = {
  MODE: 'mode',
  SETPOINT: 'setpoint',
  OPERATING: 'operating',
  ROOM: 'room',
  SMOKE: 'smoke',
  STATUS: 'status',
  ALARM: 'alarm',
  LAST_ALARM: 'last-alarm',
  POWER: 'power',
  FAN_1: 'fan-1',
  FAN_2: 'fan-2',
  FAN_3: 'fan-3',
  ECO: 'eco',
  SILENT: 'silent',
  PELLET: 'pellet',
};

/** Gladys core values (server/utils/constants.js). */
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1 };
export const OPERATING_STATE = { IDLE: 0, HEATING: 1 };

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin. */
  statesPerMinute: 250,
  /** Gladys accepts 300 scene events per minute. */
  eventsPerMinute: 250,
  /** Scene event strings. */
  eventText: 1000,
  /** Status texts. */
  statusText: 200,
  /** Stoves handled for one account. */
  stoves: 20,
};

export const TIMINGS = {
  /** One HTTP request to the cloud. */
  httpTimeout: 15_000,
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** Refresh of a stove after a command: the cloud needs a few seconds. */
  refreshAfterCommand: 5000,
  /**
   * After a press of a toggling power button, how long another press waits
   * for a reading that shows it (a second press would toggle the stove back).
   */
  toggleGuard: 2 * 60_000,
  /** After a refused login, the next attempt waits this long (no account lock). */
  authRetry: 15 * 60_000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
};
