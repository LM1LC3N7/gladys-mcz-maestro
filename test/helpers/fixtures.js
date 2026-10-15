// -----------------------------------------------------------------------------
// The stove fixtures (see test/fixtures/README.md).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

/** @returns {{ node: object, model: object, status: object, state: object }} */
export function loadStove(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
}
