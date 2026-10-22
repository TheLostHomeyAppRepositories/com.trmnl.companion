# TRMNL companion for Homey

A [Homey](https://homey.app) app that pushes a snapshot of your smart home to a
[TRMNL](https://trmnl.com) e-ink display. It runs on the Homey itself, reads
devices and zones over the local API, and POSTs to your TRMNL plugin. No account
linking, no OAuth. The plugin setting's UUID is the only credential.

It pushes on a timer, every 5 minutes by default. You can also turn on pushing
whenever a device changes, which is off by default: TRMNL accepts a limited
number of pushes per hour, and a home with power metering emits device events
every few seconds, so it would spend the hour's allowance in minutes. When it is
on, change-driven pushes are spaced at least a minute apart.

It only ever reads. There is no code here that controls a device.

## Install

Search for **TRMNL** in the Homey App Store on your Homey, or install from
source with the [Homey CLI](https://apps.developer.homey.app/the-basics/getting-started):

```
npm install -g homey
homey login
homey app install
```

Then open the app's settings on your Homey and paste your push URL. Get it from
the **Homey** plugin in TRMNL, where it is called the Push URL:

```
https://trmnl.com/api/plugin_settings/<uuid>/data
```

A private plugin on the Webhook strategy (`/api/custom_plugins/<uuid>`) accepts
the same body, but that endpoint needs Developer Edition and caps the payload at
2 kB, which about twenty devices already exceed. Use the native plugin.

The settings page has a **Test push now** button and a diagnostics readout so
you can confirm the loop without leaving the page.

## No-install alternative: HomeyScript

If you would rather not install an app, `homeyscript/push.js` does the same
push from Athom's official [HomeyScript](https://homey.app/en-us/app/com.athom.homeyscript/HomeyScript/)
app: paste the script, set `PUSH_URL`, and trigger it from a Flow on an
interval. Same payload, no review process, no CLI. You lose the on-change
pushes and the diagnostics page, which is the trade.

## What it sends

One JSON snapshot per push:

```
source        "companion"
zone_names    { zoneId: zone name }
devices[]     name, zone, klass, available, power (W), temperature (°C),
              humidity (%), wind (km/h), energy (kWh),
              titles { field: localized label }, on, alarms ["smoke", ...],
              capabilities { capabilityId: { value, title } }
```

`capabilities` carries every capability the device reports, which is what lets a
screen show a battery level, an air quality reading or a washer program. Only the
value and Homey's own localized title travel; TRMNL derives the unit, the decimal
allowance and the render component from the capability id.

The named readings above it are the same numbers a second time, kept so a TRMNL
that predates the capability bag still renders. They can go once that is long
deployed.

The same shape the TRMNL Homey plugin's cloud poller produces, so recipes and
the [trmnl-liquid-components](https://github.com/usetrmnl/trmnl-liquid-components)
library render either source without caring which one supplied the data. Keep
`lib/snapshot.js` and the server's `Plugins::Homey::Snapshot` in sync. A field
added on one side only is dropped by the other.

## Tests

    npm test

Covers the snapshot builder, the push request, and the HomeyScript, which is run
against stubbed `Homey`, `log` and `fetch` globals the way HomeyScript supplies
them. One test asserts the app and the script emit the same device shape, since a
screen must not depend on which producer the user installed.

Run them with `node --test test/*.test.js` if you skip npm — `node --test test/`
tries to load the directory as a module and reports a failure that has nothing to
do with the tests.

## Releasing

You need the Homey CLI logged in to an Athom account in the TRMNL organization
on the [developer portal](https://tools.developer.homey.app). The app belongs to
the organization, so it is under **My Organizations**, not **My Apps**.

1. Check the build:

   ```
   npm test
   homey app validate --level publish
   ```

   The validator warns that `homey:manager:api` needs a more thorough review.
   That is expected, since the app reads every device.

2. Prove it on a real Homey. `homey app install` runs the app on the Homey
   itself. Point the push URL at a small HTTP server on your machine that logs
   each request body, set the interval to 1 minute and turn on push on change.
   Timed pushes should land a minute apart, and a changed reading should send
   one push with the new value within about a minute.

   Avoid `homey app run` for this: it runs the app in Docker on your machine,
   where it may not reach the Homey API (`Timeout after 10000ms`), and it
   uninstalls the app when you stop it. Write down the store app's settings
   first, because the dev install replaces it.

   A sensor that has stopped reporting keeps its old values. Check the reading's
   `lastUpdated` before you blame the app.

3. Bump the version and write the changelog for Homey owners, not developers.
   It shows in the App Store.

   ```
   homey app version patch --changelog "What changed, in words an owner understands."
   npm version <version> --no-git-tag-version
   git commit -am "Released <version>"
   git tag -a v<version> -m <version>
   git push origin main v<version>
   ```

   The Homey CLI updates `app.json` and `.homeychangelog.json` only, so keep
   `package.json` in step yourself.

4. Upload the build:

   ```
   HOMEY_HEADLESS=1 homey app publish
   ```

   `HOMEY_HEADLESS=1` skips the prompts and uses the version and changelog you
   committed. The build arrives in the portal as a draft and reaches no one yet.

5. Open the build page the CLI prints. It compares the build with the live one,
   so check that only what you meant to change has changed. Press **Publish to
   Test**, which gives a private install link, then **Submit for
   Certification** with **Automatically Publish after Approval** ticked. If
   Athom reviews the build, their reply appears on that page. As a verified
   author, our updates have gone live straight after submitting.

6. Put the store app back on your test Homey with the settings you wrote down,
   and watch the build's **Crashes** column for a day or two.

## Why plain JavaScript

The Homey CLI's TypeScript build can report success while packaging no runnable
`app.js`, which presents as an app that installs but never starts. This app is
plain JavaScript on purpose; if you convert it to TypeScript, verify the
packaged archive actually contains compiled output before trusting a green
build.

## License

MIT
