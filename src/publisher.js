// -----------------------------------------------------------------------------
// What the integration sends to Gladys, within its rate limits.
//
// Gladys accepts 300 states and 300 scene events per minute per integration.
// A big account (20 stoves of 16 features) read for the first time would
// overflow the states budget at once: the publisher keeps the LAST value of
// each feature, sends the pending ones within a per-minute budget (the rest
// waits for the next second), and skips the unchanged ones
// (publishChangedStates, with a heartbeat). Scene events are queued apart and
// all sent, in order, within their own budget: two alarms are two events.
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from './constants.js';

/** Scene events kept while Gladys is unreachable or the budget is spent. */
const MAX_QUEUED_EVENTS = 100;
const MINUTE = 60_000;

export class Publisher {
  constructor({
    gladys,
    logger,
    now = Date.now,
    timers = globalThis,
    stateBudget = LIMITS.statesPerMinute,
    eventBudget = LIMITS.eventsPerMinute,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.stateBudget = stateBudget;
    this.eventBudget = eventBudget;
    /** featureId -> { state } | { text } */
    this.pending = new Map();
    /** [{ key, data }] scene events, oldest first */
    this.events = [];
    /** send times of the last minute */
    this.stateWindow = [];
    this.eventWindow = [];
    this.timer = undefined;
    this.flushing = undefined;
  }

  start() {
    this.stop();
    this.timer = this.timers.setInterval(() => {
      this.flush().catch((err) => this.logger?.warn(`Sending to Gladys failed: ${err.message}`));
    }, TIMINGS.flushInterval);
  }

  stop() {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** States in the publishStates format: only the last value of a feature is kept. */
  push(states) {
    for (const { device_feature_external_id: id, ...value } of states) {
      this.pending.set(id, value);
    }
  }

  /** A scene event: never merged with another one. */
  pushSceneEvent(key, data) {
    this.events.push({ key, data });
    if (this.events.length > MAX_QUEUED_EVENTS) {
      const dropped = this.events.shift();
      this.logger?.warn(`Too many scene events waiting: "${dropped.key}" dropped`);
    }
  }

  /** Forgets the pending values of a device (`<device>` or `<device>:<key>` ids). */
  forget(devicePrefix) {
    for (const id of this.pending.keys()) {
      if (id === devicePrefix || id.startsWith(`${devicePrefix}:`)) {
        this.pending.delete(id);
      }
    }
  }

  flush() {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = undefined;
      });
    }
    return this.flushing;
  }

  async doFlush() {
    const now = this.now();
    this.stateWindow = this.stateWindow.filter((t) => now - t < MINUTE);
    this.eventWindow = this.eventWindow.filter((t) => now - t < MINUTE);
    // One path failing (a 429 on the events) does not hold the other one.
    let failure;
    let events = 0;
    let states = 0;
    try {
      events = await this.flushEvents(now);
    } catch (err) {
      failure = err;
    }
    try {
      states = await this.flushStates(now);
    } catch (err) {
      failure ??= err;
    }
    if (failure) {
      throw failure;
    }
    return { states, events };
  }

  async flushEvents(now) {
    let sent = 0;
    while (this.events.length > 0 && this.eventWindow.length < this.eventBudget) {
      const { key, data } = this.events[0];
      try {
        await this.gladys.publishSceneEvent(key, data);
      } catch (err) {
        if (err?.status === 404 || err?.status === 400) {
          // An undeclared key or a refused payload never passes: drop it.
          this.events.shift();
          this.logger?.warn(`Scene event "${key}" refused: ${err.message}`);
          continue;
        }
        throw err;
      }
      this.events.shift();
      this.eventWindow.push(now);
      sent += 1;
    }
    return sent;
  }

  async flushStates(now) {
    const room = this.stateBudget - this.stateWindow.length;
    if (room <= 0 || this.pending.size === 0) {
      return 0;
    }
    const batch = [];
    for (const [id, value] of this.pending) {
      if (batch.length >= room) {
        break;
      }
      batch.push({ device_feature_external_id: id, ...value });
    }
    for (const entry of batch) {
      this.pending.delete(entry.device_feature_external_id);
    }
    let result;
    try {
      result = await this.gladys.publishChangedStates(batch, {
        heartbeat: TIMINGS.stateHeartbeat,
      });
    } catch (err) {
      // Keep the values for the next round, unless a newer one arrived meanwhile.
      for (const { device_feature_external_id: id, ...value } of batch) {
        if (!this.pending.has(id)) {
          this.pending.set(id, value);
        }
      }
      throw err;
    }
    const count = result?.count ?? batch.length;
    for (let i = 0; i < count; i += 1) {
      this.stateWindow.push(now);
    }
    return count;
  }
}
