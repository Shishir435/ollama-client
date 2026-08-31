# Repository tooling

Run commands from the repository root with pnpm. The package scripts are the
public interface; moving a runner does not change its command name.

## Ownership

| Directory | Responsibility |
| --- | --- |
| `checks/` | Static resource, bundle-budget and compatibility checks |
| `generate/` | Derived locale, documentation and OpenAPI artifacts; includes the OpenAPI template |
| `verify/` | Maintained browser, persistence and clean-checkout verification |
| `benchmarks/` | Performance measurements, not correctness gates |
| `experiments/` | Historical owner/topology probes retained until replacement evidence permits retirement |
| `setup/` | Optional developer machine setup; never run by builds or CI |

Keep checks separate from builds. A `check:*` command consumes inputs already
on disk; `check:generated` regenerates locale assets to detect tracked drift.
A `verify:*` command may coordinate prerequisites. Browser recovery runners
consume their documented builds and never build implicitly.

## Daily development and Git hooks

| Command | Prerequisites and effects |
| --- | --- |
| `pnpm dev` / `pnpm dev:firefox` | Generate locales and start the extension dev server |
| `pnpm test:related -- <files>` | Run tests related to the supplied changed files; no build |
| `pnpm check:static` | Typecheck, lint, format, dead-code, translation, generated-resource and compatibility checks |
| `pnpm verify` | Static checks followed by the full unit/integration suite; no browser or docs build |
| `pnpm verify:ci` | The same static checks plus full coverage, including React `.tsx` implementations |
| `pnpm verify:ci-parity` | Install the frozen lockfile and run `verify:ci` in a disposable checkout of committed HEAD; may need network; excludes uncommitted work |

Pre-commit formats/lints staged supported files, runs related tests, then
performs one full typecheck. Pre-push audits production dependencies and runs
`verify`. Neither hook builds browser packages or documentation. CI and
explicit release verification own the expensive build and browser gates.
Never bypass hooks. CI uses `check:static` and shards `test:coverage`, then
merges reports to enforce the same coverage thresholds as `verify:ci`.
Clean-checkout parity does not reproduce browser tests, packaging, hosted CI,
OS differences, or a fresh registry security audit.

## Coverage scope

Coverage reports include both `.ts` and `.tsx` implementations. The existing
TypeScript floors remain unchanged: 80% lines, 78% statements, 75% functions,
67% branches. React implementations now have a separate enforced baseline:
47% lines, 46% statements, 44% functions, 41% branches. The first full run on
2026-08-31 measured 47.96%, 46.47%, 44.42%, and 41.19% respectively.

These React floors expose previously unmeasured code; they are not a claim of
adequate component coverage. Raise them as behavior-focused component tests
are added. Do not exclude components or lower the TypeScript floors to make
the combined report pass. Global totals remain visible in the report, while
both source groups have independent gates. Sharded CI enforces these gates
only after merging the reports.

## Browser and release verification

| Command | Prerequisites and effects |
| --- | --- |
| `pnpm build:browsers` | Build Chrome and Firefox production artifacts once each |
| `pnpm check:browser-smoke` | Check existing production manifests/assets; missing builds fail; never builds |
| `pnpm verify:browser-smoke` | Build both production targets, then check their manifests/assets |
| `pnpm verify:local-browsers` | Browser smoke workflow plus the full unit/integration suite |
| `pnpm verify:browser-automation` | Browser smoke workflow plus local browser/UI checks; see runner environment options for Ollama |
| `pnpm e2e` | Build Chrome production and benchmark artifacts, then run critical Chromium tests |
| `pnpm e2e:build:release` | Build production and benchmark artifacts for both browsers once each |
| `pnpm e2e:release:run` | Consume those four builds; run critical Chromium, worker recovery, and Chrome/Firefox migration gates |
| `pnpm e2e:release` | Build all four targets and run the release browser gates |
| `pnpm verify:release` | Static checks + coverage, all four builds, manifest/bundle checks, docs build, and release browser gates; each browser target builds once |

Browser gates need the corresponding installed browsers. Chromium automation
uses Playwright; the Firefox migration gate uses Firefox and geckodriver.
Headful Linux runs need a display or Xvfb. Recovery runners document additional
environment flags in their module headers. Reports go under `artifacts/`.
Release CI separately audits the distributable OLC package on Linux/Windows
and retains the exact extension ZIPs used for publishing.

## Generation, benchmarks, and experiments

- `generate:resources` validates source locales and writes extension assets.
  `public/_locales` is tracked; selection locale assets are generated/ignored.
- `docs:generate` writes derived documentation and OpenAPI artifacts.
  `docs:build` runs generation first. Edit source catalogs/contracts/docs,
  not generated pages. The output site is `docs/dist/`.
- `bundle:report` reports existing production build sizes. `bundle:check` and
  `bundle:check:firefox` enforce budgets without rebuilding.
- `benchmark:persistence` and `benchmark:performance` run Node measurements.
  `benchmark:browser` needs the corresponding benchmark builds; see its header
  for browser selection and measurement limitations.
- `spike:*` commands retain experimental checks and separate spike builds.
  They are not release gates. Do not remove them solely because a newer runner
  exists; verify its scenario coverage and compatibility-ledger evidence first.
- `setup/ollama-env.sh` changes local Ollama configuration only when explicitly
  invoked by a developer; read the script before using it.

## Adding or moving a tool

Keep the command alias in `package.json`, update imports and path-relative
assets, and update this guide. Maintained JavaScript/TypeScript tools are
linted and formatted by Biome; TypeScript tools are included in typechecking.
Keep package-owned build scripts inside their package (for example OLC).
Share helpers only when multiple maintained runners need the same behavior.
