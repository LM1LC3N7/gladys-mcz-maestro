// -----------------------------------------------------------------------------
// A fake MCZ Maestro cloud, as a `fetch` function: the routes, headers, status
// codes and answer shapes the Home Assistant integration relies on, the stoves
// of the fixtures, tokens that expire, and commands applied to the stove
// readings like the stove would. Every request is recorded.
// -----------------------------------------------------------------------------

import { TENANT_ID } from '../../src/maestro.js';
import { loadStove } from './fixtures.js';

export const ACCOUNT = { email: 'stove.owner@example.com', password: 'S3cret-pellets!' };

export function fakeCloud({ stoves = ['m2_air'] } = {}) {
  const state = {
    requests: [],
    commands: [],
    /** HTTP status forced on a route ('login', 'status'…), or 'network' / 'timeout'. */
    failures: new Map(),
    /** HTTP status forced on every call about one stove (by its id). */
    stoveFailures: new Map(),
    tokens: new Set(),
    counter: 0,
    /** id -> { fixture, status, state } */
    stoves: new Map(),
    /** Called with each command, may change the readings like a stove would. */
    onCommand: null,
  };
  for (const name of stoves) {
    const fixture = loadStove(name);
    state.stoves.set(fixture.node.Id, {
      fixture,
      status: structuredClone(fixture.status),
      state: structuredClone(fixture.state),
    });
  }

  const answer = (status, body) =>
    new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });

  const ROUTES = [
    ['POST', /^\/hlapi\/v1\.0\/Authorization\/Login$/, () => 'login'],
    ['POST', /^\/hlapi\/v1\.0\/Nav\/FirstVisibleObjectsPaginated$/, () => 'stoves'],
    ['GET', /^\/hlapi\/v1\.0\/Model\/([^/]+)$/, () => 'model'],
    ['POST', /^\/mcz\/v1\.0\/Program\/Ping\/([^/]+)$/, () => 'ping'],
    ['GET', /^\/mcz\/v1\.0\/Appliance\/([^/]+)\/(Status|State)$/, (m) => m[2].toLowerCase()],
    ['POST', /^\/mcz\/v1\.0\/Program\/ActivateProgram\/([^/]+)$/, () => 'activate'],
  ];

  /** [route name, id of the path (decoded)] */
  const route = (method, path) => {
    for (const [verb, pattern, name] of ROUTES) {
      const m = pattern.exec(path);
      if (m && verb === method) {
        return [name(m), m[1] === undefined ? undefined : decodeURIComponent(m[1])];
      }
    }
    return ['unknown'];
  };

  async function fetch(url, init = {}) {
    const { pathname, host } = new URL(url);
    const headers = init.headers ?? {};
    const body = init.body ? JSON.parse(init.body) : undefined;
    const [name, id] = route(init.method, pathname);
    state.requests.push({ method: init.method, host, path: pathname, route: name, headers, body });
    const forced = state.failures.get(name);
    if (forced === 'network') {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (forced === 'timeout') {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    if (forced) {
      return answer(forced, { Message: 'forced' });
    }
    if (id !== undefined && state.stoveFailures.has(id)) {
      return answer(state.stoveFailures.get(id), { Message: 'forced' });
    }
    if (headers.tenantid !== TENANT_ID) {
      return answer(400, { Message: 'missing tenant' });
    }
    if (name === 'login') {
      if (body?.username !== ACCOUNT.email || body?.password !== ACCOUNT.password) {
        return answer(401, { Message: 'Invalid credentials' });
      }
      state.counter += 1;
      const token = `token-${state.counter}`;
      state.tokens.add(token);
      return answer(200, { Token: token });
    }
    if (!state.tokens.has(headers['auth-token'])) {
      return answer(401, { Message: 'Unauthorized' });
    }
    const stove = id === undefined ? undefined : state.stoves.get(id);
    switch (name) {
      case 'stoves':
        return answer(
          200,
          [...state.stoves.values()].map((s) => ({
            Node: s.fixture.node,
            AccessControl: { Id: `ac-${s.fixture.node.Id}`, Roles: 'Owner' },
          })),
        );
      case 'model': {
        const owner = [...state.stoves.values()].find((s) => s.fixture.node.ModelId === id);
        return owner ? answer(200, owner.fixture.model) : answer(404, { Message: 'no model' });
      }
      case 'ping':
        return stove ? answer(200, true) : answer(404, { Message: 'no stove' });
      case 'status':
      case 'state':
        return stove ? answer(200, stove[name]) : answer(404, { Message: 'no stove' });
      case 'activate': {
        if (!stove) {
          return answer(404, { Message: 'no stove' });
        }
        state.commands.push({ id, ...body });
        state.onCommand?.(stove, body);
        return answer(200, { Result: 'OK' });
      }
      default:
        return answer(404, { Message: 'not found' });
    }
  }

  return {
    fetch,
    state,
    /** Changes the readings of a stove, as the stove itself would. */
    set(id, values, part = 'both') {
      const stove = state.stoves.get(id);
      if (part !== 'state') {
        Object.assign(stove.status, values);
      }
      if (part !== 'status') {
        Object.assign(stove.state, values);
      }
    },
    routes() {
      return state.requests.map((r) => r.route);
    },
    count(name) {
      return state.requests.filter((r) => r.route === name).length;
    },
    expireTokens() {
      state.tokens.clear();
    },
  };
}
