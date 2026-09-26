# Bundled embeddings

Implemented from `release/0.14.0` in an isolated worktree; rebased onto the merged UX polish (`43767967`).

New installations select a bundled, quantized `Xenova/all-MiniLM-L6-v2` model. Upgrades keep the existing external embedding configuration and receive a dismissible migration offer in chat and embedding settings. External providers and model selection remain available. Chat generation still requires a chat provider.

## Runtime and packaging

- ONNX Runtime Web 1.30.0, WASM-only, one CPU thread, proxy workers disabled.
- Pure JavaScript `@huggingface/tokenizers` 0.2.0. Both asset-only dependencies are listed in Knip’s exclusions because WXT copies their files instead of importing them into application bundles.
- Model revision `751bff37182d3f1213fa05d7196b954e230abad9`. SHA-256 checksums in `tools/generate/prepare-bundled-embeddings.ts` pin every downloaded model asset.
- WXT downloads missing assets **at build time** into the ignored `.cache/bundled-embeddings` directory, verifies them, and copies them into every extension package. A populated cache permits offline builds. A missing or mismatched download fails the build.
- No CSP changes, remote code, runtime downloads, WebGPU or cross-encoder. Local extension URLs work for both manifest versions. The Firefox minimum is 114 because packaged inference uses [ES module workers](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/114).
- Chromium uses the existing persistence offscreen document, with a separate inference worker. Firefox uses its background page. Neither touches the SQLite worker. The worker starts on demand and releases model memory after two idle minutes.
- 384 dimensions; unpadded mean pooling and L2 normalization. Longer inputs use nonoverlapping windows of 254 content tokens plus special tokens, then a token-count-weighted average and normalization. No text tail is silently dropped. Windowing is inference batching, not a second text splitter; ingestion continues using the shared chunker.
- Model identity includes revision and pooling semantics, so same-dimensional external vectors cannot accidentally match native queries.
- MiniLM is primarily suitable for English. Users needing stronger multilingual retrieval can keep their preferred external embedding model.

## Migration safety and recovery

The `VectorDatabase` upgrade adds an index-state row and a staging table. The index-state row owns the active vector space and generation; external provider settings and the announcement preference remain in registered `chrome.storage` settings.

`embeddings.nativeCommand` starts a fingerprint snapshot of **all stored vectors** (files, pages and chat memory), then processes bounded batches of eight. It does not enable memory or collect additional browser data. Closing the page cancels the active request; already committed staged rows remain available through **Resume migration**. The next browser session uses the old index until the user resumes and the final transaction succeeds.

Original vectors are unchanged throughout inference. The final transaction checks every source row and the total row count before replacing vectors and switching future inference together. If ingestion, deletion or editing changed the corpus, the swap is refused and the UI requests a fresh attempt. Quota, worker and model failures preserve the original index. Temporary storage is required for source fingerprints and replacement vectors. Staging stores no second copy of document text. Keeping the current setup discards staging and dismisses the offer.

Search contexts invalidate caches and rebuild index projections when the committed generation changes. A late external vector write after the native switch is refused. Existing provider/model settings remain saved; switching back is explicit and requires rebuilding vectors for that external model.

## Verification

```sh
pnpm typecheck
pnpm lint:check
pnpm test:run
pnpm generate:resources
pnpm docs:build
pnpm package
pnpm package:firefox
pnpm bundle:check
pnpm bundle:check:firefox
pnpm exec tsx tools/verify/verify-bundled-embeddings.ts
pnpm exec tsx tools/verify/verify-firefox-bundled-embeddings.ts
```

The Chromium verification uses a disposable browser profile and a closed proxy, including loopback. It checks new-install routing, finite normalized vectors, relative semantic similarity, long input, a migration across page reload and the subsequent default. Output is written to `artifacts/bundled-embeddings/`.

The Firefox runner uses Selenium/geckodriver and a disposable profile. `FIREFOX_BIN` selects a browser binary. Runtime verification is separate from a successful Firefox package build.

### Local results

- Chrome 148: offline ingestion and semantic search passed; migration resumed across a page reload; no observed CSP violations. First embedding including owner RPC and model startup took about 0.22–0.35 seconds on this Mac (disk cache was not flushed).
- Chrome ZIP: 23.36 MB; Firefox ZIP: 24.21 MB. Model/runtime assets add roughly 20 MB compressed. Actual size gates were updated; content-script budgets were not relaxed.
- The full Vitest suite passed; type checking, localization generation and documentation build passed.
- Firefox MV2 builds and packages successfully. Runtime verification remains unconfirmed on this host: system Firefox 155 exits with “Could not find profile folder” before installing the extension, even with an explicit existing disposable profile; the cached automation Firefox times out connecting Marionette. These are browser startup failures, not evidence about ONNX compatibility.
