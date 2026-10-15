// -----------------------------------------------------------------------------
// The MCZ Maestro cloud: the only network access of the integration.
//
// The REST API the MCZ MAESTRO app has used since the 2023 cloud
// (s.maestro.mcz.it), as documented by the Home Assistant integration
// Robbe-B/maestro_mcz (its maestro/controller, Apache-2.0):
//   - POST /hlapi/v1.0/Authorization/Login { username, password } -> { Token };
//   - every other call carries the token in an `auth-token` header and the
//     fixed `tenantid` of the MCZ tenant; a 401 or 403 means the token expired;
//   - POST /hlapi/v1.0/Nav/FirstVisibleObjectsPaginated {} -> the stoves
//     ([{ Node: { Id, Name, UniqueCode, ModelId, SensorSetTypeId… } }]);
//   - GET /hlapi/v1.0/Model/<ModelId> -> the commands the model accepts, by
//     configuration (SensorId, type, bounds, value mappings);
//   - POST /mcz/v1.0/Program/Ping/<Id>, then GET /mcz/v1.0/Appliance/<Id>/Status
//     and /State -> the stove readings (flat objects);
//   - POST /mcz/v1.0/Program/ActivateProgram/<Id> { ModelId, ConfigurationId,
//     SensorSetTypeId, Commands: [{ SensorId, Value }] } -> a command.
//
// The password, the token and the headers are never logged nor put in an
// error message.
// -----------------------------------------------------------------------------

import { TIMINGS } from './constants.js';

export const BASE_URL = 'https://s.maestro.mcz.it';
/** The MCZ tenant of the cloud, sent by the app with every request. */
export const TENANT_ID = '7c201fd8-42bd-4333-914d-0f5822070757';

export const PATHS = {
  LOGIN: '/hlapi/v1.0/Authorization/Login',
  STOVES: '/hlapi/v1.0/Nav/FirstVisibleObjectsPaginated',
  MODEL: '/hlapi/v1.0/Model/',
  PING: '/mcz/v1.0/Program/Ping/',
  APPLIANCE: '/mcz/v1.0/Appliance/',
  ACTIVATE: '/mcz/v1.0/Program/ActivateProgram/',
};

export class MaestroError extends Error {}
/** The cloud refused the e-mail or the password. */
export class MaestroUnauthorized extends MaestroError {}
/** The cloud could not be reached, or did not answer as expected. */
export class MaestroConnectionError extends MaestroError {}

/** An id the cloud gave, safe to put in a URL path. */
const segment = (id) => encodeURIComponent(String(id ?? ''));

export class MaestroClient {
  /**
   * @param {object} options
   * @param {string} options.email
   * @param {string} options.password
   * @param {string} [options.baseUrl]
   * @param {typeof fetch} [options.fetch]
   * @param {object} [options.logger]
   */
  constructor({ email, password, baseUrl = BASE_URL, fetch = globalThis.fetch, logger }) {
    this.email = email;
    this.password = password;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetch;
    this.logger = logger;
    this.token = null;
    /** The login under way, shared by the requests that wait for it. */
    this.loggingIn = null;
  }

  /** One HTTP request; never logs its headers nor its body. */
  async request(method, path, { body, token } = {}) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      tenantid: TENANT_ID,
    };
    if (token) {
      headers['auth-token'] = token;
    }
    let response;
    try {
      response = await this.fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMINGS.httpTimeout),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new MaestroConnectionError(`${new URL(this.baseUrl).host}: ${reason}`);
    }
    const text = await response.text().catch(() => '');
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    this.logger?.debug?.(
      `${method} ${path.split('/').slice(0, 5).join('/')} -> ${response.status}`,
    );
    return { status: response.status, data };
  }

  /** Logs in with the e-mail and the password of the MCZ MAESTRO app. */
  login() {
    this.loggingIn ??= this.doLogin().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  async doLogin() {
    this.token = null;
    const { status, data } = await this.request('POST', PATHS.LOGIN, {
      body: { username: this.email, password: this.password },
    });
    if (status === 400 || status === 401 || status === 403 || status === 404) {
      throw new MaestroUnauthorized(`login refused (HTTP ${status})`);
    }
    if (status !== 200) {
      throw new MaestroConnectionError(`login failed (HTTP ${status})`);
    }
    const token = data?.Token ?? data?.token;
    if (typeof token !== 'string' || token === '') {
      throw new MaestroUnauthorized('login answered without a token');
    }
    this.token = token;
  }

  /**
   * An authenticated call: logs in first when needed, and once more when the
   * token expired (401/403). Never repeated otherwise: a command sent twice
   * could toggle the stove back.
   */
  async call(method, path, body) {
    if (!this.token) {
      await this.login();
    }
    let answer = await this.request(method, path, { body, token: this.token });
    if (answer.status === 401 || answer.status === 403) {
      await this.login();
      answer = await this.request(method, path, { body, token: this.token });
      if (answer.status === 401 || answer.status === 403) {
        throw new MaestroUnauthorized(`access refused (HTTP ${answer.status})`);
      }
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new MaestroConnectionError(`HTTP ${answer.status}`);
    }
    return answer.data;
  }

  /** The stoves of the account: the `Node` of each entry, with a serial number. */
  async listStoves() {
    const data = await this.call('POST', PATHS.STOVES, {});
    if (!Array.isArray(data)) {
      throw new MaestroConnectionError('unexpected answer to the stove list');
    }
    return data.map((entry) => entry?.Node).filter((node) => node?.Id && node?.UniqueCode);
  }

  /** The commands of a stove model (configurations and sensors). */
  async model(modelId) {
    const data = await this.call('GET', PATHS.MODEL + segment(modelId));
    if (!Array.isArray(data?.ModelConfigurations)) {
      throw new MaestroConnectionError('unexpected answer to the stove model');
    }
    return data;
  }

  /** Asks the cloud to reach the stove, like the app does before reading it. */
  async ping(stoveId) {
    await this.call('POST', PATHS.PING + segment(stoveId));
  }

  async status(stoveId) {
    return this.object(await this.call('GET', `${PATHS.APPLIANCE}${segment(stoveId)}/Status`));
  }

  async state(stoveId) {
    return this.object(await this.call('GET', `${PATHS.APPLIANCE}${segment(stoveId)}/State`));
  }

  object(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new MaestroConnectionError('unexpected answer to a stove reading');
    }
    return data;
  }

  /**
   * Sends commands to a stove: values of the sensors of ONE configuration of
   * its model.
   * @param {{ Id: string, ModelId: string, SensorSetTypeId: string }} stove the node
   * @param {string} configurationId
   * @param {Array<{ sensorId: string, value: unknown }>} commands
   */
  async activate(stove, configurationId, commands) {
    await this.call('POST', PATHS.ACTIVATE + segment(stove.Id), {
      ModelId: stove.ModelId,
      ConfigurationId: configurationId,
      SensorSetTypeId: stove.SensorSetTypeId,
      Commands: commands.map(({ sensorId, value }) => ({ SensorId: sensorId, Value: value })),
    });
  }
}
