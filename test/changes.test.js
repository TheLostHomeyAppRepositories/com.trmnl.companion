'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { listenForChanges, changePushDelay } = require('../lib/changes');

function fakeDevice(capabilityIds) {
  const listeners = {};
  return {
    capabilitiesObj: Object.fromEntries(capabilityIds.map((id) => [id, {}])),
    makeCapabilityInstance: (id, listener) => { listeners[id] = listener; },
    report: (id, value) => listeners[id]?.(value),
  };
}

function fakeDevicesManager(devices) {
  const manager = new EventEmitter();
  manager.connect = async () => {};
  manager.getDevices = async () => devices;
  return manager;
}

async function countChanges(manager) {
  let changes = 0;
  await listenForChanges(manager, () => { changes += 1; });
  return () => changes;
}

test('reports a new capability value', async () => {
  const meter = fakeDevice(['measure_power']);
  const changes = await countChanges(fakeDevicesManager({ d1: meter }));
  meter.report('measure_power', 99);
  assert.equal(changes(), 1);
});

test('reports a new value from a device added later', async () => {
  const manager = fakeDevicesManager({});
  const lamp = fakeDevice(['onoff']);
  const changes = await countChanges(manager);
  manager.emit('device.create', lamp);
  lamp.report('onoff', true);
  assert.equal(changes(), 1);
});

test('reports a changed device, such as a rename', async () => {
  const manager = fakeDevicesManager({});
  const changes = await countChanges(manager);
  manager.emit('device.update', {});
  assert.equal(changes(), 1);
});

test('waits for the rest of a burst after a quiet spell', () => {
  assert.equal(changePushDelay(0, 600_000), 3000);
});

test('holds a change until a minute after the last push', () => {
  assert.equal(changePushDelay(100_000, 110_000), 50_000);
});
