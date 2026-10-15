# MCZ Maestro (pellet stoves)

MCZ pellet stoves with **Maestro** or **Maestro+** technology are controlled
with the **MCZ MAESTRO** phone app, through the MCZ cloud. This integration
logs in to that cloud with your app account, like the app does, and brings
your stoves into Gladys: turn them on and off, set the temperature, the power
and the fans, switch the eco and silent modes, follow the temperatures, the
state and the alarms, and react to an alarm in a scene.

**Unofficial**: not affiliated with MCZ Group.

> **Development version (0.1).** Built on the cloud protocol of the Home
> Assistant integration used by many MCZ owners, and tested against answers
> shaped like those of real stoves, not yet against a real stove. Your
> feedback is welcome on the GitHub repository.

## Which stoves

- **Maestro+** stoves (Wi-Fi and Bluetooth, the "Maestro+ MCZ" app): air and
  hydro models such as Cute, Tecla, Ego, Star, Club, Mood, Jazz, Aki, Pad…
- First-generation **Maestro** stoves once moved to an account with the
  "MCZ Maestro – Upgrade" app.

**Not this integration**:

- MCZ stoves with **Easy Connect** (older Micronova module): use the
  **Micronova Agua IOT** integration, app "Easy Connect", "Easy Connect Plus"
  or "Easy Connect Poêle".
- Palazzetti stoves have their own Gladys integration.

## What you get

One Gladys device per stove of the account, with the features the model of
the stove offers:

| Feature           | In Gladys                                                                     |
| ----------------- | ----------------------------------------------------------------------------- |
| On/off            | thermostat mode: off / on                                                     |
| Setpoint          | thermostat setpoint, with the bounds of the model, by 0.5 °C                  |
| Heating           | operating state: the stove is producing heat or not                           |
| Room temperature  | temperature sensor (°C)                                                       |
| Smoke temperature | temperature sensor (°C)                                                       |
| State             | text: off, ignition, heating, cleaning, standby, shutting down, alarm…        |
| Alarm             | binary sensor: 1 while the stove is in alarm                                  |
| Last alarm        | text: the code of the last alarm and its meaning ("A01: Ignition failed")     |
| Power level       | a choice among the power levels (1 to 5)                                      |
| Fans              | one choice per fan (room fan, ducted fans): off, speed 1 to 5, auto, silent   |
| Eco mode          | switch: the Start & Stop mode (the stove stops and restarts on its own)       |
| Silent mode       | switch, on first-generation stoves (on Maestro+ it is the "silent" fan value) |
| Pellets low       | binary sensor, when the pellet level sensor of the stove is turned on         |

The state reads like "Heating (Potenza 3)": the phase first, the same for
every stove, then the text of the stove itself when it sends one.

The fans follow the work mode of the stove, like in the app: in **manual**
(and dynamic/auto) you choose their speed, in **comfort** and **overnight**
the stove drives them and Gladys says so if you try.

## Installation

1. Check that your stove works in the MCZ MAESTRO app on your phone.
2. In the configuration of the integration, type the **e-mail** and the
   **password** of that app.
3. Click **Test the connection**: the stoves of the account are listed.
4. Open the **Discovery** tab and add your stoves.

## Options

| Option                      | Default | Purpose                                                                      |
| --------------------------- | ------- | ---------------------------------------------------------------------------- |
| Language of the stove texts | French  | names of the features, state and alarm texts                                 |
| Refresh interval            | 60 s    | how often each stove is read (60 to 3600 s): each reading asks the MCZ cloud |

## Scenes

The **Stove alarm** trigger fires when a stove goes into alarm (failed
ignition, flame out, smoke too hot, flue blocked…), once per alarm. Leave the
stove empty to watch them all. The scene gets the name of the stove, the alarm
code ("A01"…) and its meaning, the state, and a ready-to-send sentence, for
example "Living room stove: stove alarm (A01: Ignition failed)" to send as a
notification.

The features work in scenes like any device: turn the stove on at 6:30, set
the setpoint when you leave, turn the eco mode on at night, check the room
temperature in a condition…

## How it works

- Gladys talks to the MCZ cloud (`s.maestro.mcz.it`) over the Internet, never
  to the stove directly: the stove must be online in the app. Each reading
  asks the cloud to reach the stove, then reads its state; one minute is the
  shortest interval, to stay polite with the MCZ cloud.
- The e-mail and the password stay in the Gladys configuration (the password
  is a secret field) and are only sent to the MCZ cloud.
- The commands follow the model of the stove, as the cloud describes it: only
  the features your stove has are offered. Gladys shows the new value at once
  and reads the stove again 5 seconds later to confirm it.
- On a Maestro+ the on/off command is a press of the power button: Gladys
  sends it only when the stove is in the other state.
- A refused login is retried after 15 minutes, or as soon as you save the
  configuration. The MCZ cloud has outages now and then: the integration
  shows the cloud as unreachable and connects again on its own.

### Local mode

The first-generation Maestro stoves also open their own Wi-Fi access point
with a local websocket (`ws://192.168.120.1:81`), and the Maestro+ stoves
talk Bluetooth to the app. Neither is used: Gladys runs the integration in a
container on your home network, which cannot join the stove's access point
nor use Bluetooth. Projects such as maestrogateway bridge the local
websocket to MQTT, if you need a cloud-free setup.

## Troubleshooting

- **"refused the e-mail or the password"**: check them in the MCZ MAESTRO
  app. An Easy Connect account does not work here (see above).
- **No stove**: the stove was added with another account. Log in to the app
  with the same e-mail.
- **A stove shown as unreachable, "not connected to the MCZ cloud"**: the
  stove lost its Wi-Fi or its power: check it in the app.
- **A fan setting is refused**: the stove is in comfort or overnight mode, or
  its silent mode is on: change it in the app or turn the silent mode off.
- **"Pellets low" never changes**: the stove may not report its pellet sensor
  to the cloud (the app notifies the empty tank through its own push
  messages). Tell us on GitHub what your stove does.

## Credits

The cloud protocol and the names of the stove commands come from the Home
Assistant integration [maestro_mcz](https://github.com/Robbe-B/maestro_mcz)
by Robbe-B and contributors (Apache License 2.0). The historic Maestro states
and alarm codes are documented by
[maestrogateway](https://github.com/Chibald/maestrogateway) (Chibald).
