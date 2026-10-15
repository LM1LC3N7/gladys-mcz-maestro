// -----------------------------------------------------------------------------
// The integration: one MCZ MAESTRO account on the MCZ cloud, the stoves of
// that account as Gladys devices, read at the configured interval, their
// commands, and the "stove alarm" scene trigger. index.js only wires the SDK
// handlers to it (src/handlers.js).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  DEVICE_TYPE,
  FEATURES,
  LIMITS,
  SCENE_TRIGGERS,
  THERMOSTAT_MODE,
  TIMINGS,
} from './constants.js';
import { buildDevice, buildStates, idsOf, statusText, stoveId } from './devices.js';
import { T, alarmLabel, texts } from './i18n.js';
import { MaestroClient, MaestroUnauthorized } from './maestro.js';
import { commandsOf, onOffValue, SENSOR_TYPES, switchValue } from './model.js';
import { Publisher } from './publisher.js';
import { fanCommand, layoutOf, readStove, silentCommand } from './stove.js';

const LABEL = 'MCZ Maestro';
const clip = (text) => String(text ?? '').slice(0, LIMITS.eventText);

/** A short reason for a status message: never a token, a password or a header. */
const reasonOf = (err) => clip(err?.message ?? err).slice(0, 120);

export class MaestroApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'mcz-maestro' }),
    createClient = (options) => new MaestroClient(options),
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.createClient = createClient;
    this.now = now;
    this.timers = timers;
    this.publisher = new Publisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.configKey = undefined;
    this.client = null;
    /** stove id -> { node, commands, reading, ok, failing, queue } */
    this.stoves = new Map();
    this.connected = false;
    this.timer = undefined;
    this.refreshTimers = new Map();
    this.generation = 0;
    this.running = undefined;
    this.nextAttemptAt = 0;
    this.lastStatus = undefined;
    /** device external id -> transport key last published */
    this.transports = new Map();
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * @param {object} raw the configuration
   * @param {{ force?: boolean }} options force: log in again even with the same
   * configuration (the user saved it), instead of a resync
   */
  async start(raw = {}, { force = false } = {}) {
    const config = normalizeConfig(raw);
    const key = JSON.stringify(config);
    if (!force && key === this.configKey && this.client) {
      // Gladys reconnected, same configuration: resend what Gladys may have lost.
      await this.resync();
      return;
    }
    this.stop();
    this.config = config;
    this.configKey = key;
    this.nextAttemptAt = 0;
    if (config.missing.length > 0) {
      await this.setStatus(false, T.notConfigured);
      return;
    }
    await this.setStatus(false, T.connecting);
    this.client = this.newClient();
    this.publisher.start();
    const generation = this.generation;
    this.timer = this.timers.setInterval(() => {
      if (generation === this.generation) {
        this.tick().catch((err) => this.logger.error(`Refresh failed: ${err.message}`));
      }
    }, config.refreshInterval * 1000);
    await this.tick();
  }

  newClient() {
    return this.createClient({
      email: this.config.email,
      password: this.config.password,
      logger: this.logger,
    });
  }

  stop() {
    this.generation += 1;
    this.timers.clearInterval(this.timer);
    this.timer = undefined;
    for (const timer of this.refreshTimers.values()) {
      this.timers.clearTimeout(timer);
    }
    this.refreshTimers.clear();
    this.publisher.stop();
    this.client = null;
    this.connected = false;
    this.running = undefined;
    this.stoves.clear();
    this.configKey = undefined;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Refresh loop ----------------------------------------------------------

  /** One round: log in and discover when needed, else read every stove. */
  tick() {
    if (!this.running) {
      const generation = this.generation;
      this.running = this.round(generation).finally(() => {
        if (generation === this.generation) {
          this.running = undefined;
        }
      });
    }
    return this.running;
  }

  async round(generation) {
    if (!this.client || this.now() < this.nextAttemptAt) {
      return;
    }
    try {
      if (!this.connected) {
        await this.discover(generation);
      } else {
        await this.refreshAll(generation);
      }
    } catch (err) {
      if (generation === this.generation) {
        await this.failed(err);
      }
    }
  }

  async failed(err) {
    this.connected = false;
    if (err instanceof MaestroUnauthorized) {
      this.logger.warn(`${LABEL}: ${err.message}`);
      this.nextAttemptAt = this.now() + TIMINGS.authRetry;
      await this.setStatus(false, T.refused);
    } else {
      this.logger.warn(`${LABEL}: ${reasonOf(err)}`);
      await this.setStatus(false, T.unreachable(reasonOf(err), this.config.refreshInterval));
    }
    for (const entry of this.stoves.values()) {
      entry.ok = false;
    }
    await this.publishTransports();
  }

  /** Logs in, lists the stoves and their models, reads them, publishes the devices. */
  async discover(generation) {
    const client = this.client;
    await client.login();
    const nodes = (await client.listStoves()).slice(0, LIMITS.stoves);
    const models = new Map();
    const entries = new Map();
    for (const node of nodes) {
      if (!models.has(node.ModelId)) {
        models.set(node.ModelId, commandsOf(await client.model(node.ModelId)));
      }
      const id = stoveId(node);
      // A stove already known keeps its last reading: an alarm is not raised twice.
      entries.set(id, {
        node,
        commands: models.get(node.ModelId),
        layout: null,
        reading: this.stoves.get(id)?.reading ?? null,
        ok: false,
      });
    }
    if (generation !== this.generation) {
      return;
    }
    this.stoves = entries;
    this.connected = true;
    this.logger.info(`${LABEL}: ${entries.size} stove(s) on the account`);
    await this.refreshAll(generation, { publish: true });
  }

  async refreshAll(generation, { publish = false } = {}) {
    const entries = [...this.stoves.values()];
    let changed = publish;
    for (const entry of entries) {
      changed = (await this.refreshStove(entry, generation)) || changed;
    }
    if (generation !== this.generation) {
      return;
    }
    if (changed) {
      await this.publishDevices();
    }
    if (entries.length > 0 && entries.every((entry) => !entry.ok)) {
      // No stove answered: the cloud is down, log in again at the next round.
      throw entries.find((entry) => entry.error)?.error ?? new Error('no stove answered');
    }
    await this.setStatus(true, this.stoves.size > 0 ? T.connected(this.stoves.size) : T.noStove);
    await this.publishTransports();
  }

  /**
   * Reads one stove (ping, status, state) and publishes its states. Resolves
   * true when the stove got its layout (first good reading): the devices must
   * be published again.
   */
  refreshStove(entry, generation = this.generation) {
    return this.serial(entry, async () => {
      const client = this.client;
      if (!client || generation !== this.generation) {
        return false;
      }
      let status;
      let state;
      try {
        await client.ping(entry.node.Id);
        status = await client.status(entry.node.Id);
        state = await client.state(entry.node.Id);
      } catch (err) {
        if (err instanceof MaestroUnauthorized) {
          throw err;
        }
        if (!entry.failing) {
          this.logger.warn(`Reading "${entry.node.Name}" failed: ${reasonOf(err)}`);
        }
        entry.ok = false;
        entry.failing = true;
        entry.error = err;
        return false;
      }
      if (generation !== this.generation) {
        return false;
      }
      if (entry.failing) {
        this.logger.info(`"${entry.node.Name}" answers again`);
        entry.failing = false;
      }
      entry.ok = true;
      const reading = readStove(status, state, entry.commands);
      const first = !entry.layout;
      if (first) {
        entry.layout = layoutOf(reading);
      }
      if (entry.pendingPower && reading.on === entry.pendingPower.on) {
        // The press shows in the readings: the next one is safe again.
        entry.pendingPower = null;
      }
      this.detectAlarm(entry, entry.reading, reading);
      entry.reading = reading;
      await this.publishStates(entry);
      return first;
    });
  }

  /** Runs the cloud calls of a stove one after the other. */
  serial(entry, fn) {
    const run = (entry.queue ?? Promise.resolve()).then(fn);
    entry.queue = run.catch(() => {});
    return run;
  }

  scheduleRefresh(entry) {
    const id = stoveId(entry.node);
    this.timers.clearTimeout(this.refreshTimers.get(id));
    const generation = this.generation;
    this.refreshTimers.set(
      id,
      this.timers.setTimeout(() => {
        this.refreshTimers.delete(id);
        if (generation === this.generation && this.connected) {
          this.refreshStove(entry, generation)
            .then((first) => (first ? this.publishDevices() : undefined))
            .then(() => this.publishTransports())
            .catch((err) => this.logger.warn(`Refresh after a command failed: ${err.message}`));
        }
      }, TIMINGS.refreshAfterCommand),
    );
  }

  // --- Publication -----------------------------------------------------------

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  async publishDevices() {
    const devices = [];
    for (const entry of this.stoves.values()) {
      devices.push(buildDevice(this.gladys, entry, this.config.language));
    }
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) => this.logger.warn(`Publishing the discovered devices failed: ${err.message}`));
  }

  async publishStates(entry) {
    if (!entry.reading || !this.createdDevices().has(idsOf(this.gladys, entry.node).device)) {
      return;
    }
    this.publisher.push(buildStates(this.gladys, entry, entry.reading, this.config.language));
    await this.flush();
  }

  flush() {
    return this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /** The transport badge of a stove: unreachable, with the reason when it is the stove's. */
  transportOf(entry) {
    if (!this.connected || !entry.ok) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (entry.reading && !entry.reading.connected) {
      // The SDK accepts a message only with `degraded`.
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: T.stoveOffline,
      };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  }

  async publishTransports() {
    const created = this.createdDevices();
    const entries = [];
    for (const entry of this.stoves.values()) {
      const externalId = idsOf(this.gladys, entry.node).device;
      const badge = this.transportOf(entry);
      const key = JSON.stringify(badge);
      if (created.has(externalId) && this.transports.get(externalId) !== key) {
        this.transports.set(externalId, key);
        entries.push({ external_id: externalId, ...badge });
      }
    }
    if (entries.length > 0) {
      await this.gladys
        .publishTransports(entries)
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  /** Gladys reconnected: publish again what it may have lost. */
  async resync() {
    this.transports.clear();
    if (!this.connected) {
      await this.tick();
      return;
    }
    await this.publishDevices();
    this.gladys.forgetPublishedStates();
    for (const entry of this.stoves.values()) {
      await this.publishStates(entry);
    }
    await this.publishTransports();
  }

  /** The "stove alarm" scene trigger, once per alarm (the first reading is the baseline). */
  detectAlarm(entry, previous, current) {
    if (!previous || !current.alarm) {
      return;
    }
    if (previous.alarm && previous.alarmCode === current.alarmCode) {
      return;
    }
    const t = texts(this.config.language);
    const name = entry.node.Name || entry.commands.name || t.stove;
    const label = alarmLabel(current.alarmCode, this.config.language);
    this.logger.warn(`"${name}" is in alarm${current.alarmCode ? ` (${current.alarmCode})` : ''}`);
    this.publisher.pushSceneEvent(SCENE_TRIGGERS.STOVE_ALARM, {
      stove: idsOf(this.gladys, entry.node).device,
      stove_name: clip(name),
      alarm_code: clip(current.alarmCode ?? ''),
      alarm_label: clip(label ?? ''),
      status: clip(statusText(current, this.config.language)),
      summary: clip(t.summary(name, current.alarmCode, label)),
    });
  }

  // --- Devices created by the user -----------------------------------------

  entryOf(externalId) {
    const prefix = this.gladys.externalId(`${DEVICE_TYPE}:`);
    const text = String(externalId ?? '');
    if (!text.startsWith(prefix)) {
      return undefined;
    }
    const [id, key] = text.slice(prefix.length).split(':');
    const entry = this.stoves.get(id);
    return entry ? { entry, key } : undefined;
  }

  async deviceCreated(device) {
    const found = this.entryOf(device?.external_id);
    if (found) {
      this.transports.delete(device.external_id);
      await this.publishStates(found.entry);
      await this.publishTransports();
    }
  }

  async deviceDeleted(device) {
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery screen asks for the stoves: list them again. */
  async scan() {
    if (!this.client) {
      return;
    }
    await this.running;
    this.connected = false;
    this.nextAttemptAt = 0;
    await this.tick();
  }

  // --- Commands --------------------------------------------------------------

  async setValue(device, feature, value) {
    const found = this.entryOf(feature?.external_id);
    if (!this.client || !this.connected) {
      throw new Error('not connected to the MCZ cloud');
    }
    const entry = found?.entry;
    if (!entry?.reading) {
      throw new Error('this stove has not been read yet, try again in a minute');
    }
    const { commands, reading } = entry;
    if (!reading.connected) {
      throw new Error('the stove is not connected to the MCZ cloud');
    }
    let sensor;
    let target;
    let state;
    switch (found.key) {
      case FEATURES.MODE: {
        sensor = commands.power;
        const on = Number(value) !== THERMOSTAT_MODE.OFF;
        state = { state: on ? THERMOSTAT_MODE.HEATING : THERMOSTAT_MODE.OFF };
        const toggle = sensor?.type === SENSOR_TYPES.BOOLEAN;
        const pending = entry.pendingPower;
        if (toggle && pending && this.now() < pending.until) {
          // The cloud reports a press a few seconds late: a second press now
          // would toggle the stove back.
          if (pending.on !== on) {
            throw new Error('a power command is under way: try again in a minute');
          }
          await this.confirm(entry, feature, state);
          return;
        }
        if (reading.on === on) {
          // Already there: a toggle would turn the stove the other way.
          await this.confirm(entry, feature, state);
          return;
        }
        if (toggle && reading.on === null) {
          throw new Error('the stove state is unknown: try again after the next reading');
        }
        target = sensor ? onOffValue(sensor, on) : null;
        if (toggle) {
          entry.pendingPower = { on, until: this.now() + TIMINGS.toggleGuard };
        }
        break;
      }
      case FEATURES.SETPOINT: {
        sensor = commands.setpoint;
        const n = Number(value);
        if (!Number.isFinite(n)) {
          throw new Error('the setpoint must be a number');
        }
        const min = sensor?.min ?? 5;
        const max = sensor?.max ?? 35;
        target = Math.min(max, Math.max(min, Math.round(n * 2) / 2));
        state = { state: target };
        break;
      }
      case FEATURES.POWER: {
        sensor = commands.level;
        const n = Number(String(value).trim());
        if (sensor && (!Number.isInteger(n) || n < (sensor.min ?? 1) || n > (sensor.max ?? 5))) {
          throw new Error(`unknown power level ${value}`);
        }
        target = n;
        state = { text: String(n) };
        break;
      }
      case FEATURES.FAN_1:
      case FEATURES.FAN_2:
      case FEATURES.FAN_3: {
        const command = fanCommand(commands, reading, Number(found.key.slice(-1)), value);
        if (command.error) {
          throw new Error(command.error);
        }
        ({ sensor, value: target } = command);
        state = { text: String(target) };
        break;
      }
      case FEATURES.ECO:
      case FEATURES.SILENT: {
        const on = Number(value) === 1;
        sensor = found.key === FEATURES.ECO ? commands.eco : silentCommand(commands, reading);
        target = sensor ? switchValue(sensor, on) : null;
        state = { state: on ? 1 : 0 };
        break;
      }
      default:
        throw new Error(`${feature?.name ?? found?.key ?? 'this feature'} cannot be controlled`);
    }
    if (!sensor || target === null || target === undefined) {
      throw new Error(`${feature?.name ?? found.key} cannot be controlled on this stove`);
    }
    const client = this.client;
    try {
      await this.serial(entry, () =>
        client.activate(entry.node, sensor.configurationId, [
          { sensorId: sensor.sensorId, value: target },
        ]),
      );
    } catch (err) {
      if (found.key === FEATURES.MODE) {
        entry.pendingPower = null;
      }
      throw err;
    }
    this.logger.info(`"${entry.node.Name}": ${found.key} set to ${JSON.stringify(target)}`);
    await this.confirm(entry, feature, state);
    this.scheduleRefresh(entry);
  }

  /**
   * Shows the new value at once, through publishChangedStates: the reading
   * that follows corrects it if the stove did not follow.
   */
  async confirm(entry, feature, state) {
    if (this.createdDevices().has(idsOf(this.gladys, entry.node).device)) {
      this.publisher.push([{ device_feature_external_id: feature.external_id, ...state }]);
      await this.flush();
    }
  }

  // --- Configuration screen button -------------------------------------------

  /** Logs in with the saved configuration and lists the stoves. */
  async testConnection() {
    if (this.config.missing.length > 0) {
      return T.notConfigured;
    }
    const client = this.newClient();
    try {
      await client.login();
      const nodes = await client.listStoves();
      return T.test.ok(nodes.map((n) => n.Name || n.UniqueCode || '?'));
    } catch (err) {
      return err instanceof MaestroUnauthorized
        ? T.test.refused
        : T.test.failed(reasonOf(err) || 'error');
    }
  }
}
