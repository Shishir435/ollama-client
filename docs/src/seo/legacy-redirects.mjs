/**
 * Inbound URLs from the pre-Starlight IA, mapped to where they live now.
 *
 * Single source of truth for two consumers that must not disagree:
 *
 *   - `docs/astro.config.mjs`, which emits a meta-refresh page at each old path
 *     for browsers and crawlers,
 *   - `docs/src/lib/agent-routing.ts`, which answers a Markdown client before
 *     the filesystem is consulted and would otherwise call these paths unknown.
 *
 * They had already disagreed once: the Routing Middleware landed knowing only
 * `DOC_ORDER`, so `/architecture` with `Accept: text/markdown` returned a 404
 * for a path that plainly resolves in a browser. An alias only stops being an
 * alias when nothing links to it, so entries stay as long as the Chrome Web
 * Store listing, the README, or an existing search result can still point here.
 */
export const LEGACY_REDIRECTS = {
  "/architecture": "/concepts/architecture/",
  "/ollama-setup-guide": "/guides/provider-setup/",
  "/privacy-policy": "/legal/privacy-policy/"
}
