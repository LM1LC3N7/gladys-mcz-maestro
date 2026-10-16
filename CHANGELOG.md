# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- README: the store install note replaces the work-in-progress notice, and the
  Releasing section no longer says the store topic is still to be added.

## [0.1.1] - 2026-10-16

### Added

- Login to the MCZ Maestro cloud with the e-mail and the password of the
  MCZ MAESTRO app; the token is renewed when it expires.
- One Gladys device per stove of the account (Maestro+ and first-generation
  Maestro stoves), with the features its model offers: on/off (thermostat
  mode), setpoint within the bounds of the model, operating state, room and
  smoke temperatures, state text, alarm, last alarm code with its meaning,
  power level, fans (off, speeds, auto, silent) following the work mode of
  the stove, eco mode (Start & Stop), silent mode, pellets low.
- The on/off command of the Maestro+ stoves, a toggle, is only sent when the
  stove is in the other state.
- The "Stove alarm" scene trigger, once per alarm, with the alarm code, its
  meaning and a ready-to-send sentence.
- Refresh interval from 60 to 3600 seconds; only the changed values are sent,
  within the Gladys rate limits; the stove is read again 5 seconds after a
  command.
- Cloud transport badge per stove: unreachable when it cannot be read, with
  the reason when the stove itself is off the MCZ cloud.
- "Test the connection" button.

[Unreleased]: https://github.com/LM1LC3N7/gladys-mcz-maestro/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-mcz-maestro/releases/tag/v0.1.1
