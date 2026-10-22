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

const MINUTE = 60_000;
const settings = { push_url: 'https://trmnl.test/data', interval_minutes: 5 };
const flushPush = () => new Promise(setImmediate);

function startedApp() {
  const TrmnlCompanionApp = loadApp();
  const app = new TrmnlCompanionApp();
  app.homey = {
    settings: { get: (key) => settings[key] },
    setTimeout, clearTimeout,
  };
  app.api = { devices: { getDevices: async () => ({}) }, zones: { getZones: async () => ({}) } };
  app.log = () => {};
  app.error = (...args) => assert.fail(args.join(' '));
  app.scheduleTimedPush();
  return app;
}

test('waits a full interval after any push before the timed push', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchStub = t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200 }));
  const app = startedApp();

  t.mock.timers.tick(4 * MINUTE);
  await app.push();
  t.mock.timers.tick(MINUTE);
  await flushPush();

  assert.equal(fetchStub.mock.callCount(), 1);
});

test('keeps pushing on the timer when no other push happens', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchStub = t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200 }));
  startedApp();

  for (let minute = 0; minute < 10; minute += 1) {
    t.mock.timers.tick(MINUTE);
    await flushPush();
  }

  assert.equal(fetchStub.mock.callCount(), 2);
});

test('drops a waiting change push when the timed push sends first', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchStub = t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200 }));
  settings.push_on_change = true;
  t.after(() => { delete settings.push_on_change; });
  const app = startedApp();

  t.mock.timers.tick(5 * MINUTE - 1000);
  app.scheduleChangePush();
  t.mock.timers.tick(1000);
  await flushPush();
  t.mock.timers.tick(MINUTE);
  await flushPush();

  assert.equal(fetchStub.mock.callCount(), 1);
});
