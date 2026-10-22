'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSnapshot, fetchSnapshot } = require('../lib/snapshot');

const devices = {
  d1: {
    name: 'Floor lamp',
    zone: 'z1',
    class: 'light',
    available: true,
    capabilitiesObj: {
      onoff: { value: true, title: 'Aangezet' },
      measure_power: { value: 11, title: 'Vermogen' },
      measure_battery: { value: 37 },
      alarm_motion: { value: false },
    },
  },
  d2: { name: 'Ghost', zone: 'z9', class: 'other', available: false, capabilitiesObj: null },
};
const zones = { z1: { name: 'Living room' } };

test('carries every capability the device reports', () => {
  const [lamp] = buildSnapshot(devices, zones).devices;
  assert.deepEqual(Object.keys(lamp.capabilities).sort(), ['alarm_motion', 'measure_battery', 'measure_power', 'onoff']);
});

test('keeps the title Homey localized on the device', () => {
  const [lamp] = buildSnapshot(devices, zones).devices;
  assert.equal(lamp.capabilities.measure_power.title, 'Vermogen');
});

test('sends no title where the device supplied none, so TRMNL falls back to its catalog', () => {
  const [lamp] = buildSnapshot(devices, zones).devices;
  assert.deepEqual(lamp.capabilities.measure_battery, { value: 37 });
});

test('keeps the flat readings a TRMNL older than the capability bag still needs', () => {
  const [lamp] = buildSnapshot(devices, zones).devices;
  assert.equal(lamp.power, 11);
  assert.equal(lamp.on, true);
});

test('reports a device with no capabilities at all rather than dropping it', () => {
  const ghost = buildSnapshot(devices, zones).devices.find((device) => device.name === 'Ghost');
  assert.deepEqual(ghost.capabilities, {});
  assert.equal(ghost.available, false);
});

test('names an unzoned device rather than leaving the room blank', () => {
  const ghost = buildSnapshot(devices, zones).devices.find((device) => device.name === 'Ghost');
  assert.equal(ghost.zone, 'Unzoned');
});

test('fetches live device values, not the cached ones', async () => {
  const api = {
    devices: {
      getDevices: async ({ $cache = true } = {}) => ({
        d1: { name: 'Meter', zone: 'z1', capabilitiesObj: { measure_power: { value: $cache ? 10 : 99 } } },
      }),
    },
    zones: { getZones: async () => zones },
  };
  const [meter] = (await fetchSnapshot(api)).devices;
  assert.equal(meter.power, 99);
});
