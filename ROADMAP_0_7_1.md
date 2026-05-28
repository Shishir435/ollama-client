# Ollama Client 0.7.1 Plan

0.7.1 should be a stability and polish release. The goal is to make the 0.7.0 frontend, provider, docs, and storage work feel quieter and more reliable without starting another large redesign.

## Release Goals

- Reduce duplicate or noisy chat context UI.
- Improve provider status, routing, and error feedback.
- Keep generated docs and generated localization artifacts out of hand-edited source.
- Add focused tests around high-risk provider and storage behavior.
- Make contributor verification easier with one local command.

## Planned Work

### Chat UX Polish

- Review selected-text insertion, context previews, and composer spacing on narrow sidepanel widths.
- Keep selected text visible in the composer, but avoid duplicate preview cards.
- Add clearer empty, loading, and error states where the chat flow currently feels silent.
- Verify mobile and narrow sidepanel text wrapping for model controls, badges, buttons, and composer content.

### Provider Reliability

- Improve provider health/status feedback for Ollama, LM Studio, llama.cpp, OpenAI, vLLM, KoboldCPP, and LocalAI.
- Make OpenAI-compatible provider errors more actionable when endpoints are offline, unauthenticated, or missing models.
- Add tests for `ProviderFactory` routing, model/provider mapping conflicts, and Ollama fallback behavior.
- Ensure provider docs and generated provider matrix stay aligned with capability flags.

### Docs And Tooling

- Keep `docs-src/src/content/docs/about/changelog.md` and `docs-src/src/content/docs/concepts/provider-matrix.md` generated from root/source files.
- Keep `tools/generate-docs.ts` as the single docs generation entrypoint.
- Document docs source-of-truth rules for contributors.
- Use `pnpm verify` as the default pre-PR local quality gate.

### Settings Cleanup

- Continue extracting large settings sections into focused sub-components, especially embedding settings.
- Avoid redesigning the settings experience in 0.7.1; keep behavior and visual language stable.
- Add focused tests around settings flows that change provider routing, embedding config, and model mappings.

### Storage Safety

- Add more tests around SQLite primary storage, Dexie fallback, and backend pointer recovery.
- Add a small diagnostic helper or visible state for the active chat-history backend if it helps support debugging.
- Keep Dexie chat-history code until the SQLite cutover has soaked long enough to remove it safely.

## Out Of Scope For 0.7.1

- Full settings redesign.
- Large RAG pipeline rewrites.
- Removing Dexie chat-history fallback.
- Adding new providers unless they are low-risk and fully covered by docs/tests.
- Major visual redesigns after the 0.7.0 frontend revamp.

## Verification Target

Before release, run:

```bash
pnpm verify
pnpm docs:build
pnpm build
pnpm build:firefox
```

Run browser smoke checks when manifest, CSP, permissions, or packaging behavior changes:

```bash
pnpm verify:browser-smoke
pnpm verify:browser-automation
```
