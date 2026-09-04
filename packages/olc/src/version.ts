/**
 * The version this build reports and updates from.
 *
 * A release archive ships `dist/` and `bin/` only, with no `package.json` beside
 * them, so an installed olc cannot read its version off disk. This literal is
 * the one copy that travels into the bundle, and
 * `config/__tests__/package-versions.test.ts` fails if it drifts from the
 * package it was built from.
 */
export const OLC_VERSION = "0.14.0"
