# Test fixtures

Three **fictional** stoves, written in the answer shapes of the MCZ Maestro
cloud as the Home Assistant integration
[maestro_mcz](https://github.com/Robbe-B/maestro_mcz) parses them (Apache
License 2.0), and as the public diagnostics of its users show them
(configuration and sensor names, types, bounds, variants and mappings, the
Status and State fields). The ids, serial numbers, names and values are
invented; no diagnostics dump is copied. Each file holds:

- `node`: an entry of `/hlapi/v1.0/Nav/FirstVisibleObjectsPaginated` (its
  `Node`), ids in the `<tenant>§<zero guid>§<guid>` form of the cloud;
- `model`: the answer of `/hlapi/v1.0/Model/<ModelId>`, trimmed to the
  configurations the integration uses, plus a "pro" one it ignores;
- `status`, `state`: the answers of `/mcz/v1.0/Appliance/<Id>/Status` and
  `/State`.

| File       | Stove                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `m2_air`   | Maestro+ air stove, 3 fans: `com_on_off` toggle, fans by work mode with auto and silent presets, eco, pellet sensor |
| `m1_air`   | first-generation stove on the new cloud, 1 fan: `m1_` sensors, on 1 / off 40, silent switch, "Potenza 5"            |
| `m2_hydro` | Maestro+ hydro: no work modes (fan `set_vent_room`), " Start&Stop", no power level, last alarm "A2"                 |
