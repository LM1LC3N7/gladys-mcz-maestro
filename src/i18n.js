// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, feature names, stove
// states, alarms, scene events), in English and French.
// -----------------------------------------------------------------------------

import { ALARMS } from './alarms.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const list = (names) => names.map((n) => `"${n}"`).join(', ');

export const T = {
  notConfigured: {
    en: 'Type the e-mail and the password of your MCZ MAESTRO app account.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte de l’application MCZ MAESTRO.',
  },
  connecting: {
    en: 'Connecting to the MCZ cloud…',
    fr: 'Connexion au cloud MCZ…',
  },
  connected: (count) => ({
    en: `Connected to the MCZ cloud: ${plural(count, 'stove', 'stoves')}. Open Discovery to add them.`,
    fr: `Connecté au cloud MCZ : ${plural(count, 'poêle', 'poêles')}. Ouvrez Découverte pour les ajouter.`,
  }),
  noStove: {
    en: 'Connected to the MCZ cloud, but this account has no stove. Is it the account of the MCZ MAESTRO app?',
    fr: 'Connecté au cloud MCZ, mais ce compte n’a aucun poêle. Est-ce bien le compte de l’application MCZ MAESTRO ?',
  },
  refused: {
    en: 'The MCZ cloud refused the e-mail or the password: check them in the MCZ MAESTRO app. Next attempt in 15 minutes, or when you save the configuration.',
    fr: 'Le cloud MCZ a refusé l’e-mail ou le mot de passe : vérifiez-les dans l’application MCZ MAESTRO. Nouvel essai dans 15 minutes, ou à l’enregistrement de la configuration.',
  },
  unreachable: (reason, seconds) => ({
    en: `The MCZ cloud is unreachable (${reason}). Next attempt in ${seconds} s.`,
    fr: `Le cloud MCZ est injoignable (${reason}). Nouvel essai dans ${seconds} s.`,
  }),
  stoveOffline: {
    en: 'The stove is not connected to the MCZ cloud (Wi-Fi or power off?)',
    fr: 'Le poêle n’est pas connecté au cloud MCZ (Wi-Fi ou courant coupé ?)',
  },
  test: {
    ok: (names) =>
      names.length === 0
        ? {
            en: 'Login OK, but this account has no stove.',
            fr: 'Connexion OK, mais ce compte n’a aucun poêle.',
          }
        : {
            en: `Login OK: ${plural(names.length, 'stove', 'stoves')} (${list(names)}).`,
            fr: `Connexion OK : ${plural(names.length, 'poêle', 'poêles')} (${list(names)}).`,
          },
    refused: {
      en: 'The MCZ cloud refused the e-mail or the password: check them in the MCZ MAESTRO app.',
      fr: 'Le cloud MCZ a refusé l’e-mail ou le mot de passe : vérifiez-les dans l’application MCZ MAESTRO.',
    },
    failed: (reason) => ({
      en: `The MCZ cloud did not answer as expected (${reason}).`,
      fr: `Le cloud MCZ n’a pas répondu comme prévu (${reason}).`,
    }),
  },
};

/** Device texts, in the language chosen in the configuration. */
const TEXTS = {
  en: {
    features: {
      mode: 'On/off',
      setpoint: 'Setpoint',
      operating: 'Heating',
      room: 'Room temperature',
      smoke: 'Smoke temperature',
      status: 'State',
      alarm: 'Alarm',
      'last-alarm': 'Last alarm',
      power: 'Power level',
      'fan-1': 'Room fan',
      'fan-2': 'Ducted fan 1',
      'fan-3': 'Ducted fan 2',
      eco: 'Eco mode (Start & Stop)',
      silent: 'Silent mode',
      pellet: 'Pellets low',
    },
    modes: { off: 'Off', heating: 'On' },
    phases: {
      off: 'Off',
      ignition: 'Ignition',
      heating: 'Heating',
      cleaning: 'Cleaning',
      standby: 'Standby',
      shutdown: 'Shutting down',
      alarm: 'Alarm',
      offline: 'Not connected',
      unknown: 'State',
    },
    level: (n) => `Power ${n}`,
    fan: { off: 'Off', speed: (n) => `Speed ${n}`, auto: 'Auto', silent: 'Silent' },
    noAlarm: 'None',
    lastAlarm: (code, label) => (label ? `${code}: ${label}` : code),
    alarm: (code, label) => `Alarm ${[code, label].filter(Boolean).join(': ')}`.trim(),
    summary: (name, code, label) =>
      `${name}: stove alarm${code || label ? ` (${[code, label].filter(Boolean).join(': ')})` : ''}`,
    stove: 'Stove',
  },
  fr: {
    features: {
      mode: 'Marche/arrêt',
      setpoint: 'Consigne',
      operating: 'Chauffe',
      room: 'Température ambiante',
      smoke: 'Température des fumées',
      status: 'État',
      alarm: 'Alarme',
      'last-alarm': 'Dernière alarme',
      power: 'Puissance',
      'fan-1': 'Ventilateur ambiant',
      'fan-2': 'Ventilation canalisée 1',
      'fan-3': 'Ventilation canalisée 2',
      eco: 'Mode éco (Start & Stop)',
      silent: 'Mode silence',
      pellet: 'Granulés bas',
    },
    modes: { off: 'Arrêt', heating: 'Marche' },
    phases: {
      off: 'Éteint',
      ignition: 'Allumage',
      heating: 'Chauffe',
      cleaning: 'Nettoyage',
      standby: 'Veille',
      shutdown: 'Extinction',
      alarm: 'Alarme',
      offline: 'Non connecté',
      unknown: 'État',
    },
    level: (n) => `Puissance ${n}`,
    fan: { off: 'Arrêt', speed: (n) => `Vitesse ${n}`, auto: 'Auto', silent: 'Silence' },
    noAlarm: 'Aucune',
    lastAlarm: (code, label) => (label ? `${code} : ${label}` : code),
    alarm: (code, label) => `Alarme ${[code, label].filter(Boolean).join(' : ')}`.trim(),
    summary: (name, code, label) =>
      `${name} : alarme du poêle${code || label ? ` (${[code, label].filter(Boolean).join(' : ')})` : ''}`,
    stove: 'Poêle',
  },
};

export const texts = (language) => TEXTS[language] ?? TEXTS.en;

/** The meaning of an MCZ alarm code ("A01"…), or null when unknown. */
export function alarmLabel(code, language) {
  const key = String(code ?? '')
    .trim()
    .toUpperCase();
  const alarm = ALARMS[key];
  return alarm ? (alarm[language] ?? alarm.en) : null;
}
