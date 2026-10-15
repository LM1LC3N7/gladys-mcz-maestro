import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERATIONS, commandsOf, findSensor, onOffValue, switchValue } from '../src/model.js';
import { loadStove } from './helpers/fixtures.js';

const m2 = commandsOf(loadStove('m2_air').model);
const m1 = commandsOf(loadStove('m1_air').model);
const hydro = commandsOf(loadStove('m2_hydro').model);

test('the generation comes from the sensor names of the model', () => {
  assert.equal(m2.generation, GENERATIONS.M2);
  assert.equal(m1.generation, GENERATIONS.M1);
  assert.equal(hydro.generation, GENERATIONS.M2);
  assert.equal(commandsOf({ ModelConfigurations: [] }).generation, null);
  assert.equal(m2.name, 'Air Stove - 3 Fan');
});

test('on/off: a toggle on Maestro+, mapped values on the first generation', () => {
  assert.equal(m2.power.type, 'boolean');
  assert.equal(m2.power.configurationId, 'cfg-m2-power');
  assert.equal(onOffValue(m2.power, true), true);
  assert.equal(onOffValue(m2.power, false), true, 'a press of the power button, both ways');
  assert.equal(m1.power.name, 'm1_stato_stufa');
  assert.equal(onOffValue(m1.power, true), 1);
  assert.equal(onOffValue(m1.power, false), 40);
  assert.equal(onOffValue({ type: 'int', mappings: {} }, true), null);
});

test('setpoint, power level and eco with the bounds of the model', () => {
  assert.deepEqual([m2.setpoint.min, m2.setpoint.max, m2.setpoint.type], [5, 35, 'double']);
  assert.deepEqual([hydro.setpoint.min, hydro.setpoint.max], [15, 40]);
  assert.deepEqual([m2.level.min, m2.level.max], [1, 5]);
  assert.equal(m1.level.name, 'm1_potenza_att');
  assert.equal(hydro.level, null, 'this hydro model has no Set_pot');
  assert.equal(hydro.eco.configuration, 'Start&Stop', 'found despite the leading space');
  assert.equal(switchValue(m1.eco, true), true);
  assert.equal(switchValue({ type: 'int', mappings: { on: 1, off: 0 } }, false), 0);
});

test('fans: one per sensor, the work modes that set it, speeds and presets', () => {
  assert.deepEqual(
    m2.fans.map((f) => [f.n, f.speeds, f.presets, Object.keys(f.modes)]),
    [
      [1, 5, ['auto', 'silent'], ['manual', 'auto', 'overnight', 'comfort']],
      [2, 5, ['auto', 'silent'], ['manual', 'auto']],
      [3, 5, ['auto', 'silent'], ['manual', 'auto']],
    ],
  );
  const [fan] = m1.fans;
  assert.equal(m1.fans.length, 1);
  assert.equal(fan.speeds, 5, '"auto" is 6 on the 0–6 range of set_v1: not a speed');
  assert.deepEqual(fan.presets, ['auto'], 'the numeric variants of set_v1 are speeds');
  assert.equal(fan.fixed.configuration, 'set_v1');
  assert.equal(fan.modes.comfort.enabled, false);
  assert.equal(hydro.fans[0].fixed.configuration, 'set_vent_room');
  assert.deepEqual(hydro.fans[0].modes, {});
});

test('the silent mode is a switch on the first generation only', () => {
  assert.deepEqual(
    m1.silent.map((s) => s.configuration),
    ['Manuale', 'Dynamic', 'set_v1'],
  );
  assert.equal(m2.silent, null, 'a fan preset on Maestro+');
  assert.equal(hydro.silent, null);
});

test('findSensor ignores case and spaces, and needs both ids', () => {
  const model = {
    ModelConfigurations: [
      {
        ConfigurationName: ' set_AMB_temp ',
        ConfigurationId: 'c1',
        Configurations: [{ SensorName: 'SET_AMB1', SensorId: 's1', Type: 'Double', Min: '5,5' }],
      },
      {
        ConfigurationName: 'Set_pot',
        Configurations: [{ SensorName: 'set_pot_man', SensorId: 's2' }],
      },
    ],
  };
  const sensor = findSensor(model, 'Set_amb_temp', 'set_amb1');
  assert.equal(sensor.sensorId, 's1');
  assert.equal(sensor.type, 'double');
  assert.equal(sensor.min, 5.5);
  assert.equal(sensor.max, null);
  assert.equal(findSensor(model, 'Set_pot', 'set_pot_man'), null, 'no ConfigurationId');
  assert.equal(findSensor(null, 'x', 'y'), null);
});
