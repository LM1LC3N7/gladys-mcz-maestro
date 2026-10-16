# gladys-mcz-maestro

[Gladys Assistant](https://gladysassistant.com) external integration for
**MCZ pellet stoves with Maestro technology**: the Maestro+ stoves and the
first-generation Maestro stoves controlled with the MCZ MAESTRO app. It logs
in to the MCZ cloud like the app, offers each stove of the account in the
Discovery tab, reads it at the configured interval and sends the commands
back. **Unofficial, not affiliated with MCZ Group.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **In the Gladys store.** Install it from **Integrations**, or with **Install
> from GitHub** and `https://github.com/LM1LC3N7/gladys-mcz-maestro`. First
> version, tested against answers shaped like those of real stoves, not yet
> against a real stove. Feedback and bug reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-mcz-maestro/issues).

Older MCZ stoves with **Easy Connect** use the Micronova Agua IOT cloud: see
[gladys-agua-iot](https://github.com/LM1LC3N7/gladys-agua-iot). Palazzetti
stoves have their own integration (gladys-palazzetti).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (MaestroApp) ⇄ src/maestro.js ⇄ MCZ cloud (s.maestro.mcz.it)
                                  ├─ src/model.js      stove model -> commands by role (pure)
                                  ├─ src/stove.js      Status + State -> phase and values (pure)
                                  ├─ src/alarms.js     alarm codes and meanings (pure)
                                  ├─ src/devices.js    stove -> Gladys device and states (pure)
                                  └─ src/publisher.js  states and scene events within the Gladys limits
```

- **Login**: the e-mail and password of the MCZ MAESTRO app give a token,
  sent with the MCZ tenant id on every call, renewed when the cloud refuses
  it.
- **Discovery**: the stoves of the account, and the model of each one: its
  configurations and sensors say which commands the stove accepts (on/off,
  setpoint, power, fans per work mode, eco, silent) and their bounds.
- **Readings**: every refresh interval (one minute minimum), each stove in
  turn: ping, Status, State. Only the values that changed are sent, and only
  for the stoves the user added.
- **Commands**: the value of one sensor of one configuration of the model
  (`ActivateProgram`), the stove read again 5 s later. On Maestro+ the on/off
  command toggles: it is only sent when the stove is in the other state.
- **Alarms**: a stove that enters an alarm fires the `stove_alarm` scene
  trigger, once per alarm, with the code ("A01"…) and its meaning.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run against a fake MCZ cloud (`test/helpers/fakeCloud.js`) built on
three fictional stoves ([test/fixtures](test/fixtures/README.md)) and the
SDK's fake Gladys.

## Credits

The cloud protocol and the stove command names come from the Home Assistant
integration [maestro_mcz](https://github.com/Robbe-B/maestro_mcz) by Robbe-B
and contributors (Apache License 2.0), read as documentation; the historic
Maestro states and alarm codes from
[maestrogateway](https://github.com/Chibald/maestrogateway) (Chibald). The
ioBroker adapter [ioBroker.mcz-maestro](https://github.com/Datzaeasy/ioBroker.mcz-maestro)
confirmed the on/off toggle on a real stove. See [NOTICE](NOTICE).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store.

## License

Apache-2.0.
