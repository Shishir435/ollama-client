/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

/*
 * Fontsource packages are CSS-only: they ship no type declarations, and their
 * "." export maps to index.css. `astro/client` declares relative `*.css`
 * imports but not a bare specifier that resolves to a stylesheet, so a
 * side-effect import of one is reported as having no module or type
 * declarations. Declaring the namespace leaves the imports exactly as they are
 * — the bundler loads the font CSS either way; only the type lookup failed.
 */
declare module "@fontsource-variable/*"
