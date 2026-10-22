'use strict';

const Homey = require('homey');
const { fetchSnapshot } = require('./lib/snapshot');
const { pushSnapshot } = require('./lib/pusher');
const { listenForChanges, changePushDelay } = require('./lib/changes');
const { HomeyAPI } = require('homey-api');

const DEFAULT_INTERVAL_MIN = 5;
const INIT_RETRY_MS = 30_000;

// Runs ON the Homey Pro. Reads the home via the local API (no cloud, no OAuth),
// normalizes it to the TRMNL Snapshot contract (lib/snapshot.js), and POSTs it to
// the configured TRMNL URL on a timer, and optionally when a device changes.
//
// NOTE: onInit never awaits the HomeyAPI — it wires the timer/settings and hands
// off to initializeApi() off the await path, which retries every 30s until the
// client comes up. A slow or unavailable bridge must never hang onInit.
//
// Authored in plain JavaScript (not TypeScript): on this setup the Homey CLI's TS
// build reported success but shipped no runnable JS (app main never instantiated,
// api module undefined). Plain JS is copied verbatim and runs, so we author in JS.
module.exports = class TrmnlCompanionApp extends Homey.App {
  async onInit() {
    // React to setting changes and push on a timer; push() no-ops until API ready.
    this.homey.settings.on('set', () => {
      this.startInterval();
      this.subscribeToChanges();
      this.push();
    });
    this.startInterval();

    this.homey.flow.getActionCard('send_home').registerRunListener(async () => {
      const result = await this.pushNow();
      if (!result.ok) throw new Error(result.error);
    });

    // Bring up the HomeyAPI OFF the await path so a slow bridge never hangs onInit.
    this.homey.setTimeout(() => this.initializeApi(), 10);
  }

  // Build the HomeyAPI client with retry; on success push once and subscribe to
  // realtime updates. Never awaited by onInit — reschedules itself on failure.
  async initializeApi() {
    try {
      this.api = await HomeyAPI.createAppAPI({ homey: this.homey });
      this.push();
      this.subscribeToChanges();
    } catch (err) {
      this.error('createAppAPI failed, retrying:', err.message);
      this.homey.setTimeout(() => this.initializeApi(), INIT_RETRY_MS);
    }
  }

  // On-demand backend probe (settings page -> api.js). Self-contained: connects
  // the HomeyAPI itself so it works even before initializeApi() has succeeded.
  async diag() {
    const out = {
      apiReady: Boolean(this.api),
      pushUrlSet: Boolean(this.homey.settings.get('push_url')),
    };
    try {
      const api = this.api || (await HomeyAPI.createAppAPI({ homey: this.homey }));
      const devices = await api.devices.getDevices();
      out.deviceCount = Object.keys(devices || {}).length;
      out.connectOk = true;
    } catch (err) {
      out.connectOk = false;
      out.connectError = err.message;
    }
    return out;
  }

  // On-demand full snapshot + push (settings page "Test push now").
  async pushNow() {
    const url = this.homey.settings.get('push_url');
    if (!url) return { ok: false, error: 'No push URL set — save one first.' };
    try {
      const api = this.api || (await HomeyAPI.createAppAPI({ homey: this.homey }));
      const snapshot = await fetchSnapshot(api);
      await pushSnapshot(url, snapshot);
      return { ok: true, deviceCount: snapshot.devices.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // Only when opted in: it opens a realtime subscription per device. Turning it
  // off later leaves the listeners in place until restart; scheduleChangePush ignores them.
  subscribeToChanges() {
    if (!this.api || !this.pushOnChange() || this.subscribed) return;
    this.subscribed = true;
    listenForChanges(this.api.devices, () => this.scheduleChangePush())
      .then(() => this.log('Realtime device updates subscribed'))
      .catch((err) => {
        this.subscribed = false;
        this.error('Realtime subscribe failed (interval pushes continue):', err.message);
      });
  }

  async onUninit() {
    if (this.interval) this.homey.clearInterval(this.interval);
    if (this.changePush) this.homey.clearTimeout(this.changePush);
  }

  startInterval() {
    if (this.interval) this.homey.clearInterval(this.interval);
    this.interval = this.homey.setInterval(() => this.push(), this.intervalMinutes() * 60_000);
  }

  // Never push a pending push back: a home that reports every second would never push.
  scheduleChangePush() {
    if (!this.pushOnChange() || this.changePush) return;
    this.changePush = this.homey.setTimeout(() => {
      this.changePush = null;
      this.push();
    }, changePushDelay(this.lastPushAt));
  }

  // Never throws — logs success or failure.
  async push() {
    if (!this.api) return;
    const url = this.homey.settings.get('push_url');
    if (!url) return;
    try {
      const snapshot = await fetchSnapshot(this.api);
      await pushSnapshot(url, snapshot);
      this.lastPushAt = Date.now();
      this.log(`push OK ${snapshot.devices.length} devices`);
    } catch (err) {
      this.error('push failed:', err.message);
    }
  }

  intervalMinutes() {
    return Number(this.homey.settings.get('interval_minutes')) || DEFAULT_INTERVAL_MIN;
  }

  pushOnChange() {
    return this.homey.settings.get('push_on_change') === true;
  }
};
