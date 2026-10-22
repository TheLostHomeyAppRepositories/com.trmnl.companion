'use strict';

const CHANGE_BURST_WAIT_MS = 3000;
// TRMNL rate-limits this endpoint per hour, and a busy home reports values every
// few seconds, so change-driven pushes stay at least this far apart.
const MIN_CHANGE_PUSH_GAP_MS = 60_000;

// New capability values reach only listeners made with makeCapabilityInstance, not device.update.
async function listenForChanges(devicesManager, onChange) {
  const listenToCapabilities = (device) => {
    for (const id of Object.keys(device.capabilitiesObj ?? {})) device.makeCapabilityInstance(id, onChange);
  };

  await devicesManager.connect();
  Object.values(await devicesManager.getDevices()).forEach(listenToCapabilities);
  devicesManager.on('device.create', listenToCapabilities);
  devicesManager.on('device.update', onChange);
}

const changePushDelay = (lastPushAt, now = Date.now()) =>
  Math.max(CHANGE_BURST_WAIT_MS, (lastPushAt ?? 0) + MIN_CHANGE_PUSH_GAP_MS - now);

module.exports = { listenForChanges, changePushDelay };
