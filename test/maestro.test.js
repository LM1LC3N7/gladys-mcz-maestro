import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MaestroClient,
  MaestroConnectionError,
  MaestroUnauthorized,
  TENANT_ID,
} from '../src/maestro.js';
import { ACCOUNT, fakeCloud } from './helpers/fakeCloud.js';
import { loadStove } from './helpers/fixtures.js';

const M2 = loadStove('m2_air');

function setup({ stoves, password = ACCOUNT.password } = {}) {
  const cloud = fakeCloud({ stoves });
  const lines = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [level, (line) => lines.push(line)]),
  );
  const client = new MaestroClient({
    email: ACCOUNT.email,
    password,
    fetch: cloud.fetch,
    logger,
  });
  return { cloud, client, lines };
}

test('login: the credentials of the app, the MCZ tenant, then the token on every call', async () => {
  const { cloud, client } = setup();
  const nodes = await client.listStoves();
  const [login, list] = cloud.state.requests;
  assert.equal(login.host, 's.maestro.mcz.it');
  assert.equal(login.path, '/hlapi/v1.0/Authorization/Login');
  assert.equal(login.method, 'POST');
  assert.deepEqual(login.body, { username: ACCOUNT.email, password: ACCOUNT.password });
  assert.equal(login.headers.tenantid, TENANT_ID);
  assert.equal(login.headers['auth-token'], undefined);
  assert.equal(list.path, '/hlapi/v1.0/Nav/FirstVisibleObjectsPaginated');
  assert.deepEqual(list.body, {});
  assert.equal(list.headers['auth-token'], 'token-1');
  assert.equal(list.headers.tenantid, TENANT_ID);
  assert.deepEqual(
    nodes.map((n) => n.Name),
    ['Poêle salon'],
  );
});

test('the token is reused, and renewed once when the cloud says it expired', async () => {
  const { cloud, client } = setup();
  await client.status(M2.node.Id);
  await client.state(M2.node.Id);
  assert.equal(cloud.count('login'), 1);
  cloud.expireTokens();
  const status = await client.status(M2.node.Id);
  assert.equal(status.stato_stufa, 0);
  assert.equal(cloud.count('login'), 2);
  assert.deepEqual(cloud.routes().slice(-3), ['status', 'login', 'status']);
});

test('concurrent calls share one login', async () => {
  const { cloud, client } = setup();
  await Promise.all([client.status(M2.node.Id), client.state(M2.node.Id), client.ping(M2.node.Id)]);
  assert.equal(cloud.count('login'), 1);
});

test('refused credentials are MaestroUnauthorized, without the password in the message', async () => {
  const { client, lines } = setup({ password: 'wrong-password' });
  await assert.rejects(client.listStoves(), (err) => {
    assert.ok(err instanceof MaestroUnauthorized);
    assert.doesNotMatch(err.message, /wrong-password|stove\.owner/);
    return true;
  });
  assert.ok(lines.every((l) => !/wrong-password|token-/.test(l)));
});

test('a token refused twice is MaestroUnauthorized, not a loop', async () => {
  const { cloud, client } = setup();
  await client.login();
  cloud.state.failures.set('status', 403);
  await assert.rejects(client.status(M2.node.Id), MaestroUnauthorized);
  assert.equal(cloud.count('status'), 2);
  assert.equal(cloud.count('login'), 2);
});

test('network failures, timeouts and server errors are MaestroConnectionError', async () => {
  const { cloud, client } = setup();
  cloud.state.failures.set('login', 'network');
  await assert.rejects(client.login(), (err) => {
    assert.ok(err instanceof MaestroConnectionError);
    assert.match(err.message, /s\.maestro\.mcz\.it: ECONNREFUSED/);
    return true;
  });
  cloud.state.failures.set('login', 'timeout');
  await assert.rejects(client.login(), /timeout/);
  cloud.state.failures.set('login', 503);
  await assert.rejects(client.login(), (err) => err instanceof MaestroConnectionError);
  cloud.state.failures.delete('login');
  cloud.state.failures.set('status', 500);
  await assert.rejects(client.status(M2.node.Id), /HTTP 500/);
  cloud.state.failures.delete('status');
  assert.equal((await client.status(M2.node.Id)).IsConnected, true);
});

test('stove ids are URL-encoded: they hold "§" separators', async () => {
  const { cloud, client } = setup();
  await client.ping(M2.node.Id);
  await client.model(M2.node.ModelId);
  const [, ping, model] = cloud.state.requests;
  assert.match(ping.path, /^\/mcz\/v1\.0\/Program\/Ping\/7c201fd8-[^§]+%C2%A7/);
  assert.equal(ping.method, 'POST');
  assert.match(model.path, /^\/hlapi\/v1\.0\/Model\/.+%C2%A7/);
  assert.equal(model.method, 'GET');
});

test('activate: the program of one configuration, with the node model and sensor set', async () => {
  const { cloud, client } = setup();
  await client.activate(M2.node, 'cfg-m2-setpoint', [{ sensorId: 'sns-m2-set-amb1', value: 21.5 }]);
  const command = cloud.state.commands[0];
  assert.equal(command.id, M2.node.Id);
  assert.deepEqual(command, {
    id: M2.node.Id,
    ModelId: M2.node.ModelId,
    ConfigurationId: 'cfg-m2-setpoint',
    SensorSetTypeId: M2.node.SensorSetTypeId,
    Commands: [{ SensorId: 'sns-m2-set-amb1', Value: 21.5 }],
  });
});

test('the stove list keeps only nodes with an id and a serial number', async () => {
  const cloud = fakeCloud({ stoves: ['m2_air', 'm1_air'] });
  const client = new MaestroClient({ ...ACCOUNT, fetch: cloud.fetch });
  cloud.state.stoves.get(loadStove('m1_air').node.Id).fixture.node.UniqueCode = '';
  const nodes = await client.listStoves();
  assert.deepEqual(
    nodes.map((n) => n.UniqueCode),
    ['2509150000001'],
  );
});

test('unexpected answers are connection errors, not crashes', async () => {
  const fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/Login')) {
      return new Response(JSON.stringify({ Token: 't' }), { status: 200 });
    }
    return new Response('<html>maintenance</html>', { status: 200 });
  };
  const client = new MaestroClient({ ...ACCOUNT, fetch });
  await assert.rejects(client.listStoves(), MaestroConnectionError);
  await assert.rejects(client.model('m'), MaestroConnectionError);
  await assert.rejects(client.status('s'), MaestroConnectionError);
});

test('a login answer without a token is a refusal', async () => {
  const fetch = async () => new Response(JSON.stringify({ Message: 'nope' }), { status: 200 });
  const client = new MaestroClient({ ...ACCOUNT, fetch });
  await assert.rejects(client.login(), MaestroUnauthorized);
});
