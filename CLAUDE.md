# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its
only runtime dependency (HTTP is Node's `fetch`). It logs in to the **MCZ
Maestro cloud** (`s.maestro.mcz.it`, the REST API of the MCZ MAESTRO app)
with the account of the app, and turns the MCZ pellet stoves of the account
(Maestro+ and first-generation Maestro) into Gladys devices, states,
commands and a `stove_alarm` scene trigger. Unofficial, not affiliated with
MCZ Group.

Written from the Home Assistant integration `Robbe-B/maestro_mcz` (Apache-2.0)
read as protocol documentation (its `maestro/controller` and
`maestro/models/models.py`), and the historic Maestro tables of
`Chibald/maestrogateway` (GPL-3.0: facts only, no code). Keep the NOTICE up
to date when porting more.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          MaestroApp: login, discovery, refresh loop, commands,
                    alarm trigger, transports, connection status
src/maestro.js      the only network access: the MCZ cloud (token, stoves,
                    model, ping, Status/State, ActivateProgram)
src/model.js        stove model -> the commands it accepts, by role (pure)
src/stove.js        Status + State -> phase, values; fan/silent commands (pure)
src/alarms.js       MCZ alarm codes, normalized, with their meaning (pure)
src/devices.js      stove -> Gladys device and states (pure)
src/publisher.js    states and scene events within the Gladys rate limits
src/config.js       config_schema normalized
src/constants.js    manifest keys, feature keys, limits, timings
src/i18n.js         runtime texts (en/fr)
test/fixtures/      three fictional stoves in the cloud answer shapes
test/helpers/       a fake MCZ cloud (fetch); Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `stove:<UniqueCode lowercased>` (the
  serial number, as the HA integration keys its devices), feature =
  `<device>:<key>` with the keys of `FEATURES` (constants.js).
- Manifest keys are frozen: the config keys, `test_connection`, `stove_alarm`
  and its fields and variables.
- **Never hard-code configuration or sensor GUIDs**: they differ between
  models; commands are resolved from the model by configuration and sensor
  name (model.js).
- **The Maestro+ on/off command toggles** (`com_on_off` = `true` presses the
  power button): send it only when the stove is in the other state, and never
  retry a command automatically.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network. Gladys: 300 states/min, 300 scene events/min
  (`src/publisher.js` keeps a margin).
- The SDK's `publishTransports` accepts a `message` only with `degraded: true`.
- Gladys value enums (thermostat mode, operating state) come from core
  `server/utils/constants.js`; the SDK does not export them.
- Never log or put in a status message the password, the e-mail, the token
  or a request header (test/maestro.test.js checks it).
- Poll politely: one minute minimum, one stove after the other, one login
  per token.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in
  sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
