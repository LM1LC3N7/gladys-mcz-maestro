# TODO — MCZ Maestro v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).

## Status

- [x] **Milestone 1 — core** (2026-10-15): login to the MCZ cloud (token,
      renewed on 401/403), stove list and models, commands resolved from the
      model (Maestro+ and first generation), on/off (toggle-safe), setpoint,
      power level, fans by work mode (speeds, auto, silent), eco, silent
      switch, room and smoke temperatures, state, alarm, last alarm,
      pellet sensor, `stove_alarm` trigger, polite polling, states and
      events within the Gladys budgets, transports (degraded when the stove
      is off the MCZ cloud), test button, docs en/fr. Tested against a fake
      cloud and three fictional stoves shaped like public diagnostics:
      **not yet against a real account**.
- [ ] **Milestone 2 — real accounts**: testers with a Maestro+ air stove, a
      Maestro+ hydro and an upgraded first-generation stove; check the
      points of "To check on a real stove" below; collect anonymized
      Model/Status/State answers as fixtures.
- [ ] **Milestone 3 — more features**: work mode select (`set_mod` /
      `mod_funz`: manual, auto/dynamic, overnight, comfort, turbo/power),
      alarm reset button (`Reset Allarme`), timer switch (`Crono`), hydro
      water/puffer/boiler temperatures and setpoints, second and third room
      setpoints, maintenance hours, exhaust fan and auger speeds, clock sync.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public.

## To check on a real stove

- The answer shapes: raw keys of Status/State (the public dumps are HA
  dataclass dumps in snake_case), `ModelConfigurations` of a Maestro+ air
  stove (no M2 air dump was found: its fan configurations come from the HA
  code, its silent preset from a Maestro+ hydro dump).
- `stato_stufa` on Maestro+ beyond -1…3, and on first-generation stoves (the
  HA integration reads 1 as "turning off", the historic table as an ignition
  check: this code follows the historic table).
- `last_alarm` formats ("A2" on a Maestro+, "A201" on a first-generation
  stove) and whether `IsInError` follows the alarm and its reset.
- Fan presets: the HA integration sends the preset name ("auto"), not its
  mapped value (6): does the cloud accept both? The silent preset (-1) on
  Maestro+ air stoves.
- Whether `Ping` refreshes the readings; first-generation stoves whose
  readings stay stale until a command (HA issue #114; the `PING STOVE`
  configuration may help).
- `sens_liv_pel` as the pellet level reading (HA issue #124 says the empty
  tank is pushed by the app's own notifications).
- The token lifetime and the behaviour under the MCZ outages (HA issues #189,
  #195, #207), DNS hiccups of the 10 s TTL chain (#220).

## Forum

No dedicated topic for this integration. Once the 10 integrations claimed on
2026-10-15 are published, a single recap message in the general thread
(/t/10385) lists each of them with its version and capabilities.

## Decisions

- **The REST cloud `s.maestro.mcz.it`**, the one the current Maestro+ MCZ app
  and the "MCZ Maestro – Upgrade" app use, and the HA integration since 2023
  (its issues show it working in 2025–2026, with outages). The historic
  socket.io cloud (`app.mcz.it:9000`, "chiedo"/"rispondo" frames, serial +
  MAC, no account) still answered a handshake on 2026-10-15 but only serves
  first-generation stoves never upgraded, through an app unsupported since
  2024: not supported (a possible fallback later).
- **Own client, no dependency** (`src/maestro.js`, ~200 lines on `fetch`):
  - no maintained library exists: PyPI has none, the HA integration vendors
    its client inside the component (Apache-2.0, read as documentation);
  - npm `iobroker.mcz-maestro` (MIT, REST) is an ioBroker adapter that
    hard-codes the GUIDs of one model, not a library;
  - `homebridge-mcz-maestro`, `node-red-contrib-mcz` (MIT) and the Jeedom,
    sowel and mcz-stove-gateway projects speak the old socket.io cloud;
  - `Chibald/maestrogateway` (GPL-3.0, 2022) is local-websocket only; only
    its state and alarm tables were used, as facts.
- **Model-driven commands**: every command is resolved by configuration and
  sensor name in the stove model (the HA integration's name table), with the
  `m1_` names for first-generation stoves; GUIDs are never hard-coded.
- **On/off on Maestro+ is a toggle**: sent only when the reading says the
  stove is in the other state, refused while the state is unknown; first
  generation sends its mapped values (1 on, 40 off).
- **Phases**: first generation reads `stato_stufa` with the historic table
  (0 off, 1–10 ignition, 11–15 power, 40–41 shutdown, 42–43 cleaning, 45–46
  standby, 50–69 alarm with its code); Maestro+ with the HA table (-1…3,
  refined by `fase_op`); `fase_op` alone, then the stove text, when there is
  no code. Standby and cleaning count as "on", only the heating phase as
  "producing heat".
- **Fans** follow the work mode like the HA integration: the configuration of
  the current mode (`mod_lav_att`), refused when that mode drives them
  (comfort, overnight); a stove without work modes (Maestro+ hydro) uses the
  fan's own configuration (`set_vent_room`, first generation `set_vN`). One
  select per fan: off, speeds, the presets of the model (auto, silent).
- **Silent**: a switch where the model has a `silent_enabled` sensor (first
  generation); on Maestro+ it is the "silent" fan preset (-1).
- **Pellet**: a "pellets low" binary only when `sens_liv_pellet` says the
  sensor is on, read from `sens_liv_pel` (to confirm).
- **Polling**: own timer (`should_poll: false`), 60 s by default and minimum
  (the HA integration polls every 30 s), each stove in turn: Ping, Status,
  State, like the app and the HA integration. A read 5 s after a command
  (HA: 3 s and 6 s). No automatic retry of a failed request: the next round
  is the retry. No stove answering at all = the cloud is down (status
  "unreachable", login again next round).
- A refused login waits 15 minutes before the next attempt (no account
  lock), saving the configuration retries at once.
- **Transports**: cloud; unreachable when the cloud or the stove read fails;
  unreachable + degraded with a message when the cloud says the stove is not
  connected (`IsConnected` of the Status answer; the State one says false on
  connected stoves).
- **Publisher** (like gladys-domoticz): last value per feature, sent within
  250 states/min, unchanged values skipped with a 30-minute heartbeat; scene
  events queued and all sent within 250/min.
- **Fixtures are fictional**: shaped like the public HA diagnostics of real
  stoves (field names, configuration names, mappings), with invented ids,
  serials and names; no third-party dump is copied.
- **Local modes are not a goal**: the first-generation access point websocket
  (`ws://192.168.120.1:81`) needs the container to join the stove's Wi-Fi,
  and Maestro+ Bluetooth is out of reach of a Gladys container.
