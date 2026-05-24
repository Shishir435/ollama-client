# Frontend Revamp Plan for 0.7.0

Date: 2026-05-24

This document focuses only on the frontend and design-system foundation for the 0.7.0 stabilization release. The goal is not to redesign the product visually. The goal is to make the UI more robust, shadcn-preset compatible, easier to maintain, and harder to accidentally break.

## Current Frontend Assessment

The frontend is in a pretty good place for a project of this scope. It has:

- A curated `src/components/ui/` primitive set instead of a random full shadcn dump.
- Tailwind v4 with CSS variables in `src/globals.css`.
- `components.json` configured for shadcn with aliases, Lucide icons, TSX, CSS variables, and `base-mira`.
- Compact UI density that fits a sidepanel/options workflow better than a marketing-page design.
- Shared settings wrappers such as `SettingsCard`, `SettingsFormField`, `SettingsSwitch`, `SelectRow`, and settings navigation.
- Regression tests for two historically fragile controls: `FormNumberInput` and `FormSlider`.
- Strong i18n coverage through `react-i18next`; most user-facing text already flows through translation keys.
- A mostly semantic color system: app code generally uses `bg-background`, `text-muted-foreground`, `bg-card`, `border-border`, `status-*`, and `sidebar-*` instead of raw colors.

The issue is not that the design system is bad. The issue is that it is not governed tightly enough. Some generated shadcn/Base UI primitives are edited directly, some product-specific behavior lives in feature components, repeated layout values such as `space-y-8`, `space-y-6`, `grid gap-6 lg:grid-cols-2`, and `mx-auto space-y-4` are scattered through settings pages, and some preset-survival patches live in global CSS. That makes the frontend vulnerable whenever the shadcn preset is re-applied or a primitive is refreshed.

## The Big Frontend Problem

The app currently has three layers that are partially mixed together:

1. **Generated primitives**
   `src/components/ui/*`, mostly shadcn/Base UI style components.

2. **Product-level application components**
   `src/components/settings/*`, chat controls, model controls, provider controls, etc.

3. **Feature-specific form behavior**
   React Hook Form wiring, numeric parsing, slider value normalization, debounced saving, provider-specific validation.

The input/slider/number breakages are symptoms of this layering problem. A shadcn preset reinstall can update the primitive, but the app depends on behavior that is not guaranteed by the preset: React Hook Form propagation, cursor behavior, value coercion, number parsing, and hidden range input attributes.

There is a second, quieter problem: the app has many good repeated UI patterns, but they are repeated as class strings rather than named primitives. Examples found in the current frontend:

- page wrappers: `space-y-8`, `mx-auto space-y-4`, `container max-w-5xl py-6 lg:py-8`
- two-column settings grids: `grid gap-6 lg:grid-cols-2`
- compact inner settings groups: `space-y-4`, `space-y-6`
- field descriptions: `text-xs text-muted-foreground`
- status cards/alerts with soft status colors
- icon-leading list rows
- empty/loading/error states
- diagnostics/stat cards
- badge/chip rows
- destructive action areas
- source/context preview cards in chat

These should become named app primitives. That will make the UI more consistent and make future changes safer.

## 0.7.0 Frontend Principle

For 0.7.0, the frontend should follow one rule:

> shadcn primitives should be replaceable; app wrappers should be stable.

That means generated components can change, but product behavior should live in local wrappers with tests.

## Recommended Layering

### Layer 1: `src/components/ui/`

Purpose:

- Low-level visual primitives.
- Shadcn/Base UI compatible.
- Minimal app logic.
- Safe to refresh from shadcn with a controlled diff.

Rules:

- Do not put React Hook Form logic here.
- Do not put provider/model/RAG concepts here.
- Keep class names token-driven.
- Keep modifications small and documented.
- Treat direct edits as "owned overrides" and test the behavior.

### Layer 2: `src/components/forms/`

Add this new layer.

Purpose:

- Stable app-owned form controls.
- React Hook Form compatible.
- Value parsing/coercion lives here.
- Numeric, slider, select, switch, textarea, and debounced-save behavior becomes reusable.

Recommended components:

- `ControlledTextInput`
- `ControlledNumberInput`
- `ControlledSlider`
- `ControlledSwitch`
- `ControlledSelect`
- `ControlledTextarea`
- `NumberStepper`
- `SettingField`

This layer should use `src/components/ui/*` internally, but feature code should prefer this layer for forms.

### Layer 3: `src/components/layout/`

Add this new layer.

Purpose:

- App shell and repeatable layout primitives.
- Page-level spacing and width rules.
- Replaces repeated `space-y-*`, `container max-w-*`, and common grid class strings.

Recommended components:

- `AppShell`
- `PageHeader`
- `PageBody`
- `PageStack`
- `SectionStack`
- `TwoColumnGrid`
- `ResponsiveGrid`
- `Toolbar`
- `InlineActions`

Rules:

- Layout components should not know about providers, models, RAG, or chat.
- They should encode spacing and responsive behavior.
- They should accept `className`, but feature code should not need to repeat core spacing classes.

### Layer 4: `src/components/settings/`

Purpose:

- Settings layout and domain-neutral settings composition.
- Cards, rows, labels, descriptions, status areas, footer actions.

Recommended additions:

- `SettingsSection`
- `SettingsRow`
- `SettingsField`
- `SettingsInlineControl`
- `SettingsDangerZone`
- `SettingsDiagnosticsPanel`
- `SettingsPageShell`
- `SettingsTabPanel`
- `SettingsCardGrid`
- `SettingsActionRow`
- `SettingsValueBadge`

### Layer 5: `src/components/feedback/`

Add this new layer.

Purpose:

- Status, loading, empty, progress, and diagnostics UI.
- Replaces one-off status/empty/error blocks across settings, search, providers, embeddings, and chat.

Recommended components:

- `StatusCallout`
- `EmptyState`
- `LoadingState`
- `ErrorState`
- `ProgressRow`
- `MetricTile`
- `DiagnosticsList`
- `HealthBadge`
- `CapabilityBadge`

This layer should build on `StatusAlert`, `Progress`, `MiniBadge`, and tokenized `STATUS_STYLES`.

### Layer 6: `src/features/*`

Purpose:

- Feature behavior only.
- Model/provider/RAG-specific copy, validation config, and state transitions.

Rules:

- Feature components should not know how to fix Base UI/shadcn quirks.
- Feature components should not hand-roll number parsing.
- Feature components should not manually re-create settings row/card patterns.

## App-Owned Primitives To Add Beyond `src/components/ui/`

This is the practical inventory for 0.7.0. These are not shadcn primitives; they are product primitives. They should live outside `src/components/ui/` so preset updates do not touch them.

### Layout Primitives

| Primitive | Purpose | Replaces |
|---|---|---|
| `PageShell` / `AppShell` | Full-height page with header/sidebar/content regions | repeated `h-screen flex flex-col overflow-hidden bg-background` |
| `PageHeader` | Title, description, and header actions | ad hoc settings/options headers |
| `PageBody` | Centered scrollable content width and padding | `container max-w-5xl py-6 lg:py-8 px-4 sm:px-6 lg:px-8 mx-auto` |
| `PageStack` | Top-level page vertical rhythm | repeated `space-y-8` |
| `SectionStack` | Card/internal section rhythm | repeated `space-y-4` / `space-y-6` |
| `TwoColumnGrid` | Common settings grid | `grid gap-6 lg:grid-cols-2` |
| `CompactGrid` | Dense form grids | `grid gap-4 sm:grid-cols-2`, `grid grid-cols-2 gap-4` |
| `InlineActions` | Button groups with wrapping and alignment | repeated `flex items-center gap-2`, `flex justify-end gap-2` |
| `Toolbar` | Header/search/action rows | chat header, settings header, dialog toolbars |

### Settings Primitives

| Primitive | Purpose | Notes |
|---|---|---|
| `SettingsPageShell` | Sidebar/mobile nav/content wrapper | Pulls structure out of `settings-page.tsx` |
| `SettingsTabPanel` | Standard wrapper for each tab | Replaces each `tabContent` item wrapping itself in `space-y-8` |
| `SettingsCardGrid` | Responsive grid of settings cards | Keeps `gap-6 lg:grid-cols-2` consistent |
| `SettingsSection` | Unframed titled section inside a card or page | Use when a card would be too heavy |
| `SettingsRow` | Label/description + right-side control | For switches, selects, buttons |
| `SettingsField` | Label/description/error + stacked control | Successor to `SettingsFormField` |
| `SettingsActionRow` | Input + action button rows | Knowledge set create/rename, URL exclusions |
| `SettingsDangerZone` | Destructive grouped actions | Reset, delete, clear vectors |
| `SettingsDiagnosticsPanel` | Read-only stats + repair actions | Storage/RAG/provider diagnostics |
| `SettingsValueBadge` | Small monospace/current-value display | Slider values, config values |

### Form Primitives

| Primitive | Purpose | Notes |
|---|---|---|
| `ControlledNumberInput` | RHF-safe numeric field | Fixes number persistence issues globally |
| `ControlledSlider` | RHF-safe slider | Fixes `[number]` conversion and display |
| `ControlledSwitch` | RHF-safe switch | Standard label/error behavior |
| `ControlledSelect` | RHF-safe select | Standard placeholder/value behavior |
| `ControlledTextarea` | RHF-safe textarea | Supports autosize later |
| `NumberStepper` | Numeric field with +/- buttons | Good for sidepanel/narrow settings |
| `SliderField` | Slider with value badge and min/max labels | Replaces hand-built slider blocks |
| `TextField` | Text input with description/error | For simple controlled text |
| `PromptTextareaField` | Larger textarea for prompt templates/system prompts | Standard min-height, monospace option |

### Feedback and State Primitives

| Primitive | Purpose | Replaces |
|---|---|---|
| `StatusCallout` | Info/warning/success/danger message | `StatusAlert` can evolve into this |
| `EmptyState` | Empty/search/no-data screen | repeated centered icon/title/description blocks |
| `LoadingState` | Spinner + label | repeated loader blocks |
| `ErrorState` | Error message + retry/action | one-off destructive blocks |
| `ProgressRow` | Label, percent, progress bar | embedding rebuild/backfill progress |
| `MetricTile` | Small stat display | storage, session, context, model metrics |
| `HealthBadge` | Healthy/warning/error/offline status | provider/embedding/model health |
| `CapabilityBadge` | Supported/unsupported/beta capability | provider capability UI |

### Data Display Primitives

| Primitive | Purpose |
|---|---|
| `InfoList` | Label/value pairs like model metadata |
| `MetadataChip` | Small icon + label + value |
| `SourcePreviewCard` | RAG/web/page source preview |
| `ContextPreview` | Truncated context with expand/copy |
| `FilePreviewCard` | Uploaded file row/card |
| `ProviderCard` | Provider identity + status + actions |
| `ModelCard` | Model identity + metadata + actions |
| `CommandListItem` | Consistent command/select list row |

### Chat-Specific Primitives

These should stay feature-owned under `src/features/chat/components/`, but the pattern should still be deliberate:

- `ChatPanelShell`
- `ChatHeaderBar`
- `MessageBubble`
- `MessageToolbar`
- `MessageMetaRow`
- `ContextSourceButton`
- `SourcePopover`
- `ComposerShell`
- `ComposerToolbar`
- `AttachmentStrip`
- `DragDropOverlay`
- `SearchResultCard`

The chat UI has unique behavior and density, so it does not need to become generic. But it should still use layout, feedback, and token primitives where possible.

## shadcn Compatibility Strategy

The current `components.json`:

```json
{
  "style": "base-mira",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/globals.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

This is broadly correct for Tailwind v4 and shadcn. Keep it.

The improvement is process, not config:

- Maintain a short list of shadcn-owned files in `src/components/ui/`.
- Maintain a short list of app-owned wrappers outside `src/components/ui/`.
- When applying a preset or adding a component, review only the generated primitive diff.
- Do not reapply a preset directly over app-owned wrappers.
- Add regression tests for every primitive that has behavior beyond styling.

## Known Fragile Area: Slider and Number Input

### Current problem

The comments in `FormNumberInput` already describe the issue: the shadcn `Input` is a Base UI primitive, and spreading `register()` from React Hook Form did not reliably propagate changes. The field looked editable, but form state did not update, so debounced saves did not happen.

`FormSlider` uses `useController`, which is the right pattern.

There is also a global CSS patch:

```css
/* shadcn overwrites these per reinstall — keep them here so they survive */
[data-slot="slider"],
[data-slot="slider"] *,
[data-slot="switch"],
input[type="range"],
input[type="number"] {
  cursor: pointer;
}
```

This is practical, but it is a warning sign. Global CSS is being used as the "survive preset reinstall" layer.

### Recommended fix

Move all form-control behavioral guarantees into app-owned wrappers:

- `ControlledNumberInput` owns `number | undefined | in-progress string` behavior.
- `ControlledSlider` owns `number <-> [number]` conversion.
- `ControlledSlider` owns min/max/step/default normalization.
- `ControlledNumberInput` owns empty-string behavior.
- `ControlledNumberInput` exposes a `commitMode`: `"change" | "blur"`.
- `NumberStepper` can combine an input and +/- icon buttons for fields that break easily on mobile or with tiny sidepanel widths.

Keep `src/components/ui/input.tsx` and `src/components/ui/slider.tsx` dumb and preset-compatible.

### Tests to require

For `ControlledNumberInput`:

- default value renders
- typing updates form state
- empty input becomes `undefined`
- invalid intermediate text does not overwrite persisted config
- min/max validation renders error
- blur can clamp or reject, depending on field config

For `ControlledSlider`:

- default value renders
- drag/change updates form state
- hidden range input has min/max/step/value
- undefined form value falls back safely
- disabled state blocks interaction and uses correct cursor

## Design Tokens

`src/globals.css` already defines a useful token set:

- background/foreground
- card/popover
- primary/secondary/muted/accent/destructive
- status colors
- border tiers
- chart colors
- sidebar colors
- radius scale

This is good. The main improvement is to make token usage more intentional.

Recommended 0.7 token policy:

- Use semantic tokens, not raw colors, in app code.
- Avoid one-off `hsl(...)`, `oklch(...)`, and arbitrary color utilities outside `globals.css`.
- Keep status colors as tokens: success, warning, info, danger.
- Add token comments that describe usage, not taste.
- Keep docs-site theme tokens separate unless intentionally shared.

Potential additions:

- `--surface-raised`
- `--surface-subtle`
- `--surface-selected`
- `--text-subtle`
- `--text-disabled`
- `--focus-ring`
- `--control-height-sm`
- `--control-height-md`
- `--control-height-lg`

The control-height tokens would help prevent the recurring "preset broke density" problem.

## Dark and Light Mode Policy

shadcn's variable model is the right approach for this app. Components should not decide light/dark colors directly. They should use semantic tokens and let `:root` and `.dark` in `src/globals.css` swap the values.

Current good patterns:

- `bg-background text-foreground`
- `bg-card text-card-foreground`
- `bg-popover text-popover-foreground`
- `text-muted-foreground`
- `border-border`
- `bg-primary text-primary-foreground`
- `bg-destructive/10 text-destructive`
- `bg-status-success/10 text-status-success`
- `bg-sidebar text-sidebar-foreground`

Rules for 0.7.0:

- Prefer semantic utilities over `dark:*` variants.
- Use `dark:*` only when the token system cannot express a state, such as prose inversion or a primitive-specific browser quirk.
- Do not add raw `hsl(...)`, `oklch(...)`, or hex values in components.
- Do not create feature-specific colors inline. Add semantic tokens or use `STATUS_STYLES`.
- Treat `feature-1` through `feature-4` as welcome/marketing accent colors, not general app-state colors.
- Keep gradients rare. The sidepanel welcome screen can be more expressive, but settings, chat, and diagnostics should stay operational and token-based.
- Add a small token usage guide near `globals.css` or in docs so contributors know which token to reach for.

Recommended semantic mapping:

| Situation | Use |
|---|---|
| Main app background | `bg-background text-foreground` |
| Raised surface/card | `bg-card text-card-foreground border-border` |
| Muted panel | `bg-muted/30 text-muted-foreground` |
| Hover row | `hover:bg-accent/50` or `hover:bg-muted/50` |
| Selected row | `bg-accent text-accent-foreground` |
| Primary action | `bg-primary text-primary-foreground` |
| Secondary/quiet action | `variant="outline"` or `variant="ghost"` |
| Destructive action | `variant="destructive"` or `STATUS_STYLES.danger` |
| Success/warning/info/danger state | `STATUS_STYLES` or `status-*` tokens |
| Sidebar/nav | `sidebar-*` tokens |

## Spacing and Density Policy

The app is sidepanel-first and settings-heavy, so consistent density matters more than visual drama.

Current repeated values:

- `space-y-8` for tab/page stacks
- `space-y-6` for dense settings groups
- `space-y-4` for card content and smaller groups
- `grid gap-6 lg:grid-cols-2` for settings pages
- `grid gap-4 sm:grid-cols-2` and `grid grid-cols-2 gap-4` for form clusters
- `mx-auto space-y-4` for local feature wrappers

Recommended policy:

- `PageStack`: `space-y-8`
- `SectionStack`: `space-y-6`
- `FieldStack`: `space-y-4`
- `ControlStack`: `space-y-2`
- `SettingsCardGrid`: `grid gap-6 lg:grid-cols-2`
- `FormGrid`: `grid gap-4 sm:grid-cols-2`
- `DenseFormGrid`: `grid grid-cols-2 gap-4`

Do not keep repeating these as raw class strings in feature files. Encode them in layout/settings primitives so a density change can be made once.

## Internationalization Policy

i18n is mostly independent of the design-system refactor, but it affects component API design.

What is independent:

- shadcn preset compatibility
- Tailwind tokens
- dark/light variable behavior
- primitive styling
- React Hook Form wiring

What i18n affects:

- component props must accept `ReactNode`, not only `string`, for labels/descriptions/actions
- long translations need wrapping, truncation, or responsive layout
- buttons cannot assume English-length labels
- badges should stay short or have translated fallbacks
- form validation messages must come from feature config or translation keys
- date/time/count formatting should not be handcrafted with English word order

Rules for 0.7.0:

- Shared components should accept `React.ReactNode` for `title`, `label`, `description`, `emptyText`, and `actionLabel` unless there is a strong reason to require `string`.
- Avoid hardcoded English in shared primitives. Defaults like confirm/cancel can use `useTranslation`, as `ConfirmActionDialog` already does.
- Avoid building translated sentences with string concatenation. Use interpolation keys.
- Avoid manually pluralizing in components. Use i18next plural forms where possible.
- Test narrow layouts with longer languages, especially German, French, Spanish, Hindi, Japanese, and Chinese.
- Do not put translation keys inside `src/components/ui/`; generated primitives should stay text-agnostic.

Recommended examples:

- Good: `<SettingsField label={t("...")} description={t("...")}>`
- Good: `<SettingsField label={<Trans i18nKey="..." components={[...]} />}>`
- Risky: `` `${count} ${t("items")} ${t("ago")}` ``
- Risky: fixed-width button text without wrapping/truncation rules

## Component Inventory Policy

The current `src/components/ui/` inventory is reasonable:

- accordion, alert, alert-dialog
- badge, mini-badge
- button
- card
- collapsible
- command
- dialog, sheet, popover, dropdown-menu, tooltip
- input, input-group, textarea, select, slider, switch, toggle, tabs
- label, separator, skeleton, progress, scroll-area, sonner, kbd, error-boundary

Do not add new primitives casually.

Before adding a primitive:

1. Check whether an existing primitive plus a product wrapper is enough.
2. Add the generated primitive to `src/components/ui/`.
3. Add app behavior outside `src/components/ui/`.
4. Add at least one usage or do not merge it.
5. Add tests if it has value transformation, focus behavior, keyboard behavior, or async state.

## Form System Revamp

0.7.0 should include a small form-system cleanup because the app is settings-heavy.

Recommended structure:

```text
src/components/forms/
  controlled-number-input.tsx
  controlled-slider.tsx
  controlled-switch.tsx
  controlled-select.tsx
  controlled-textarea.tsx
  number-stepper.tsx
  form-field-error.tsx
  index.ts
```

Then update model/provider/embedding settings to use these wrappers.

Expected benefits:

- Preset updates stop breaking form persistence.
- React Hook Form integration is tested once.
- Feature components become smaller.
- Number parsing is consistent across model params, RAG settings, embedding settings, and context settings.
- Sliders can get one shared accessible display pattern.

## Settings UI Revamp

Settings are currently powerful but dense. That is not automatically bad for this product, but the structure should become more consistent.

Recommended settings patterns:

- **Section header:** title, description, optional status/action.
- **Setting row:** label/description on left, control on right for simple settings.
- **Stacked field:** label/description above control for sliders, textareas, complex controls.
- **Diagnostics panel:** read-only status, copyable technical details, repair buttons.
- **Danger zone:** destructive reset/delete actions.

The current `SettingsCard` is useful, but avoid nesting too many cards. For 0.7.0, use cards for top-level settings groups only, not every internal row.

Current code to target first:

- `src/options/components/settings-page.tsx`: repeated tab wrappers and page shell structure.
- `src/features/context/components/context-settings.tsx`: repeated page stack, status/progress patterns, and two-column grids.
- `src/features/knowledge/components/rag-settings.tsx`: repeated slider fields, action rows, and knowledge-set form blocks.
- `src/features/model/components/model-parameters-section.tsx`: model param grids and form controls.
- `src/features/model/components/provider-settings.tsx`: large settings component with provider status/action patterns.
- `src/features/model/components/embedding-settings.tsx` and `embedding-config/*`: diagnostics, limits, search, and database management patterns.

The first milestone should not rewrite all settings. It should create the primitives, migrate one or two high-value areas, and prove the shape.

## Visual Design Review

The current design direction is appropriate:

- compact
- utilitarian
- restrained
- sidepanel-friendly
- not overly decorative

What I would improve:

- More consistent spacing between settings sections.
- More consistent empty/loading/error states.
- Stronger provider/model identity in the chat header and model menu.
- Fewer large cards inside settings pages.
- More status-first UI: healthy, warning, failed, needs setup.
- Better mobile/narrow width behavior for settings controls.
- More consistent action hierarchy: primary actions should be rare, outline/ghost actions should handle most operational controls, destructive actions should be visually clear and grouped.
- More consistent icon sizing: use `size-3`, `size-3.5`, `size-4`, and `size-5` through named component variants rather than per-file taste.
- More consistent value displays: numbers, dimensions, token counts, model sizes, and scores should use shared metric/chip components.

Do not turn this into a marketing-style UI. This is an operational tool. It should feel dependable, not flashy.

## Button and Action Policy

Buttons are a major part of the perceived design system because this app has many operational actions.

Current `Button` variants are good enough:

- `default`
- `outline`
- `secondary`
- `ghost`
- `destructive`
- `link`

Current sizes are also useful:

- `xs`, `sm`, `default`, `lg`
- `icon-xs`, `icon-sm`, `icon`, `icon-lg`

0.7.0 rules:

- Use `default` only for the main action in a local surface.
- Use `outline` for secondary operational actions.
- Use `ghost` for toolbar/icon actions.
- Use `destructive` only for delete/reset/clear operations.
- Prefer icon-only buttons for compact repeated actions, with tooltips and `aria-label`.
- Avoid custom button heights in feature code unless a wrapper owns the pattern.
- Avoid mixing `size-*` icon classes per callsite; let button size variants handle icon defaults.

Common app-owned button wrappers to consider:

- `IconTooltipButton`
- `CopyActionButton`
- `RefreshActionButton`
- `DeleteActionButton`
- `OpenExternalButton`
- `SaveStatusButton` or `SaveIndicator`

Do not create wrappers for every single action. Create wrappers only where behavior repeats: tooltip, busy state, confirm flow, copy feedback, or status coloring.

## Card, Row, and List Policy

Cards should mean "bounded group" or "repeated item", not "default wrapper for all spacing."

Rules:

- Use `SettingsCard` for top-level settings groups.
- Use `SettingsSection` inside a card instead of nested cards.
- Use `SettingsRow` for simple label/control rows.
- Use `ListRow` or `CommandListItem` for repeated selectable rows.
- Use `StatusCallout` for warnings/errors instead of a card styled like an alert.
- Use `MetricTile` for stats instead of hand-styled mini cards.

Current candidates for extraction:

- reset module rows
- provider cards
- model list rows
- knowledge-set rows
- source/context preview rows
- semantic search result rows
- storage stats tiles
- database management action rows

## Accessibility Requirements

For 0.7.0, every form wrapper should guarantee:

- label association via `htmlFor`/`id`
- visible focus state
- keyboard operation
- disabled state
- error text association where practical
- hit targets large enough for sidepanel use
- no text overflow in compact widths

Specific to slider:

- visible value
- keyboard arrow support through the primitive
- min/max/step attributes verified by tests
- accessible label

Specific to number input:

- valid `inputMode` when useful
- min/max/step
- no accidental wheel changes if that becomes a real user issue
- blur behavior documented

## Preset Update Workflow

Use this process whenever refreshing shadcn/preset components:

1. Create a branch.
2. Apply the preset/component update.
3. Review diffs only under `src/components/ui/` and `src/globals.css`.
4. Re-run:
   - `pnpm lint:check`
   - `pnpm typecheck`
   - `pnpm test:run`
5. Run targeted component tests:
   - form number input
   - form slider
   - button variants
   - select/combobox if touched
6. Manually check:
   - model settings
   - embedding settings
   - provider settings
   - chat input
   - options page narrow width
7. Do not accept the preset diff if it changes product behavior in feature components.

## Concrete 0.7.0 Frontend Tasks

### P0

- Create `src/components/forms/`.
- Move `FormNumberInput` behavior into a generic `ControlledNumberInput`.
- Move `FormSlider` behavior into a generic `ControlledSlider`.
- Update model settings to use the new generic wrappers.
- Add regression tests for generic wrappers.
- Document which files are shadcn-owned vs app-owned.
- Create `src/components/layout/` with `PageStack`, `SectionStack`, `TwoColumnGrid`, and `PageBody`.
- Replace the repeated `space-y-8` tab wrappers in `settings-page.tsx` with a `SettingsTabPanel`.
- Add an i18n rule to shared component props: labels/descriptions accept `ReactNode`.

### P1

- Add control-height tokens or utility classes for app density.
- Replace global cursor patches with component-level classes where practical.
- Keep only truly global fallback styles in `globals.css`.
- Split large settings components around product sections, not visual fragments.
- Add settings row/section primitives.
- Add `StatusCallout`, `EmptyState`, `LoadingState`, `ProgressRow`, and `MetricTile`.
- Migrate `ContextSettings` status/progress blocks to feedback primitives.
- Migrate `RAGSettings` sliders to `SliderField` / `ControlledSlider`.
- Add light/dark visual checks for settings and chat surfaces.

### P2

- Add visual smoke tests or Playwright screenshots for:
  - sidepanel chat
  - options/model settings
  - embedding settings
  - provider settings
- Add a small local component playground page if useful for development.
- Add a design-system docs page under docs or internal markdown.
- Add long-translation visual checks using a language with longer labels.
- Add provider/model/source card primitives if repeated patterns remain after P0/P1.

## What Not To Do in 0.7.0

- Do not replace the entire visual system.
- Do not add a new UI library.
- Do not make `src/components/ui/` a dumping ground for product components.
- Do not hand-roll every primitive.
- Do not add more settings controls before the form layer is stable.
- Do not treat shadcn preset compatibility as "never edit generated files." Some edits are fine, but they need ownership and tests.
- Do not sprinkle more raw `space-y-*` page rhythm values through feature files.
- Do not use `dark:*` as the normal way to theme components.
- Do not hardcode English fallback text in shared primitives.

## Success Criteria

The frontend revamp is successful when:

- Reapplying or adding a shadcn component does not break model parameter saving.
- Slider and number input behavior is covered by app-owned wrapper tests.
- Feature settings code is smaller and mostly declarative.
- `src/components/ui/` remains preset-compatible and low-logic.
- `src/components/forms/` owns form behavior.
- `src/components/layout/` owns common page/grid/stack rhythm.
- `src/components/settings/` owns settings layout.
- Shared components remain i18n-safe for long translated labels.
- Dark/light behavior comes from tokens, not per-component color branches.
- Repeated settings layout values such as `space-y-8` and `grid gap-6 lg:grid-cols-2` are represented by primitives.
- Narrow sidepanel/options layouts remain usable.
- The UI feels the same, just more reliable.

## Final Recommendation

For 0.7.0, treat the frontend revamp as infrastructure, not a redesign.

The visual direction is already good enough to build on. The urgent work is to make the design system survivable: stable wrappers, clear ownership boundaries, stronger tests around fragile controls, and a repeatable shadcn update workflow.

Once that foundation exists, the rest of the 0.7.0 stabilization work becomes easier: onboarding, provider clarity, RAG observability, and storage diagnostics can all use the same reliable settings and form components.
