// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { LANGUAGES, REFRESH_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  email: '',
  password: '',
  language: 'fr',
  refresh_interval: REFRESH_INTERVAL.default,
};

/**
 * @returns {{ email: string, password: string, language: 'en' | 'fr',
 *   refreshInterval: number, missing: string[] }} `missing` lists the fields
 *   still to fill in
 */
export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const c = { ...DEFAULTS, ...given };
  const email = String(c.email ?? '').trim();
  const password = String(c.password ?? '');
  const language = LANGUAGES.includes(c.language) ? c.language : DEFAULTS.language;
  const interval = Number(c.refresh_interval);
  const missing = [];
  if (email === '') {
    missing.push('email');
  }
  if (password === '') {
    missing.push('password');
  }
  return {
    email,
    password,
    language,
    refreshInterval: Number.isFinite(interval)
      ? Math.max(REFRESH_INTERVAL.min, Math.min(REFRESH_INTERVAL.max, Math.round(interval)))
      : REFRESH_INTERVAL.default,
    missing,
  };
}
