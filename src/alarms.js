// -----------------------------------------------------------------------------
// The MCZ alarm codes and what they mean (pure).
//
// The codes are those of the MCZ stove manuals and of the historic Maestro
// states (50–67 = alarms A01…A23, as the maestrogateway project lists them);
// the texts are written here, in English and French.
// -----------------------------------------------------------------------------

export const ALARMS = {
  A01: { en: 'Ignition failed', fr: 'Échec de l’allumage' },
  A02: { en: 'Flame went out', fr: 'Extinction anormale de la flamme' },
  A03: { en: 'Pellet tank too hot', fr: 'Surchauffe du réservoir à granulés' },
  A04: { en: 'Smoke temperature too high', fr: 'Température des fumées trop élevée' },
  A05: {
    en: 'Pressure switch: flue blocked or wind',
    fr: 'Pressostat : conduit obstrué ou vent',
  },
  A06: { en: 'Insufficient draught', fr: 'Tirage insuffisant' },
  A08: { en: 'Smoke fan fault', fr: 'Défaut de l’extracteur de fumées' },
  A09: { en: 'Smoke probe fault', fr: 'Défaut de la sonde de fumées' },
  A10: { en: 'Igniter fault', fr: 'Défaut de la résistance d’allumage' },
  A11: { en: 'Auger motor fault', fr: 'Défaut du motoréducteur' },
  A12: { en: 'Auger motor controller fault', fr: 'Défaut de la commande du motoréducteur' },
  A13: { en: 'Control board too hot', fr: 'Surchauffe de la carte électronique' },
  A14: { en: 'Active sensor fault', fr: 'Défaut du capteur Active' },
  A15: { en: 'Supply voltage too low', fr: 'Tension d’alimentation trop basse' },
  A17: { en: 'Auger jammed', fr: 'Vis sans fin bloquée' },
  A18: { en: 'Water temperature too high', fr: 'Température de l’eau trop élevée' },
  A19: { en: 'Water probe fault', fr: 'Défaut de la sonde d’eau' },
  A20: { en: 'Auxiliary probe fault', fr: 'Défaut de la sonde auxiliaire' },
  A21: { en: 'Water pressure switch', fr: 'Pressostat d’eau' },
  A22: { en: 'Room probe fault', fr: 'Défaut de la sonde d’ambiance' },
  A23: { en: 'Brazier closing fault', fr: 'Défaut de fermeture du brasier' },
};

/** First-generation `stato_stufa` alarm states -> their code. */
const ALARM_STATES = {
  50: 'A01',
  51: 'A02',
  52: 'A03',
  53: 'A04',
  54: 'A05',
  55: 'A06',
  56: 'A09',
  57: 'A11',
  58: 'A13',
  59: 'A14',
  60: 'A18',
  61: 'A19',
  62: 'A20',
  63: 'A21',
  64: 'A22',
  65: 'A23',
  66: 'A12',
  67: 'A17',
};

/** The alarm code of a first-generation `stato_stufa`, or null. */
export function alarmFromState(code) {
  return ALARM_STATES[code] ?? null;
}

/**
 * The `last_alarm` of a reading as a code: "A2" (seen on a Maestro+) is
 * "A02" like in the manuals; any other text is kept as the stove sent it
 * ("A201" was seen on a first-generation stove).
 */
export function normalizeAlarm(value) {
  const raw = String(value ?? '').trim();
  if (raw === '' || /^(none|null|0)$/i.test(raw)) {
    return null;
  }
  const short = /^([AE])0*(\d)$/i.exec(raw);
  if (short) {
    return `${short[1].toUpperCase()}0${short[2]}`;
  }
  return raw.toUpperCase().slice(0, 20);
}
