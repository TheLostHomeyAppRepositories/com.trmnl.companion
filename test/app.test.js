'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// app.js needs the Homey runtime modules, which exist only on a Homey.
function loadApp() {
  const originalLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'homey') return { App: class {} };
    if (request === 'homey-api') return { HomeyAPI: {} };
    return originalLoad.call(this, request, ...rest);
  };
  try {
    return require('../app');
  } finally {
    Module._load = originalLoad;
  }
}

// homey-api answers from its cache once devices.connect() ran, and that cache
// never sees new capability values.
const deviceWithPower = (power) => ({ d1: { name: 'Meter', zone: 'z1', capabilitiesObj: { measure_power: { value: power } } } });
const connectedApi = {
  devices: { getDevices: async ({ $cache = true } = {}) => deviceWithPower($cache ? 10 : 99) },
  zones: { getZones: async () => ({ z1: { name: 'Hall' } }) },
};

async function pushedPower(run) {
  const TrmnlCompanionApp = loadApp();
  const app = new TrmnlCompanionApp();
  app.api = connectedApi;
  app.homey = { settings: { get: (key) => (key === 'push_url' ? 'https://trmnl.test/data' : undefined) } };
  app.log = () => {};
  app.error = (...args) => assert.fail(args.join(' '));

  const bodies = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200 };
  };
  try {
    await run(app);
  } finally {
    global.fetch = originalFetch;
  }
  return bodies[0].devices[0].power;
}

test('the timed push sends live values, not the cached ones', async () => {
  assert.equal(await pushedPower((app) => app.push()), 99);
});

test('the test push sends live values, not the cached ones', async () => {
  assert.equal(await pushedPower((app) => app.pushNow()), 99);
});
