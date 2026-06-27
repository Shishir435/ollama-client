---
title: Frontend Design System
description: App-owned frontend primitives, shadcn ownership boundaries, token policy, and visual QA checklist.
---

This project treats shadcn/Base UI components as replaceable low-level primitives. Product behavior lives in app-owned wrappers so preset refreshes do not break settings persistence, density, or translated UI.

## Ownership

| Layer | Path | Owner | Rules |
|---|---|---|---|
| Generated primitives | `src/components/ui/` | shadcn/Base UI plus documented local overrides | Keep low-logic. Do not add provider, model, RAG, or React Hook Form behavior. |
| Form behavior | `src/components/forms/` | App | Own value parsing, React Hook Form integration, number/slider conversion, and behavior tests. |
| Layout rhythm | `src/components/layout/` | App | Own page width, stacks, grids, toolbars, and repeated spacing. |
| Settings composition | `src/components/settings/` | App | Own settings rows, fields, sections, action rows, diagnostics, and dangerous actions. |
| Feedback states | `src/components/feedback/` | App | Own empty, loading, error, progress, metric, health, and status UI. |
| Data display | `src/components/data-display/` | App | Own repeated provider, model, source, file, metadata, and info-list patterns. |
| Feature UI | `src/features/*` | Feature | Own domain copy, state, validation config, and feature-specific workflows only. |

## Form Rules

- Prefer `ControlledNumberInput`, `ControlledSlider`, `ControlledTextInput`, `ControlledTextarea`, `ControlledSelect`, and `ControlledSwitch` over wiring `src/components/ui/*` directly into React Hook Form.
- Use `SettingsFormField`, `SettingsSelectField`, or `SettingsSliderField` when the control needs label, description, value badge, or validation text.
- Keep parsing and conversion out of feature components. Feature components should pass values and handlers, not know Base UI event shapes.
- Any app-owned form primitive that transforms values needs tests.

## Layout Rules

- Use `PageStack` for top-level tab/page rhythm.
- Use `SectionStack` for grouped settings surfaces.
- Use `FieldStack` for stacked fields inside cards.
- Use `ControlStack` for label/control micro-layouts.
- Use `TwoColumnGrid`, `FormGrid`, and `DenseFormGrid` instead of repeating raw grid strings.
- Use `Toolbar`, `InlineActions`, and `SettingsActionRow` for action groups that must wrap on narrow widths.

## Token Rules

- Use semantic tokens: `bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-status-success/10`, and `STATUS_STYLES`.
- Use `dark:*` only for primitive quirks or prose inversion where tokens cannot express the state.
- Keep raw `hsl(...)`, `oklch(...)`, and hex values inside token files unless the value belongs to syntax highlighting or external content.
- Use control density helpers when a component needs explicit height: `control-h-sm`, `control-h-md`, `control-h-lg`, plus matching `control-min-h-*` utilities.
- Use `icon-micro`, `icon-xs`, `icon-sm`, `icon-md`, `icon-lg`, `icon-xl`, `icon-2xl`, or `icon-3xl` on icons. Raw `size-*`, `h-*`, and `w-*` icon dimensions are not allowed.
- Use the named typography scale (`text-micro`, `text-2xs`, `text-xs`, `text-sm`, `text-base`) instead of arbitrary `text-[Npx]` values.
- Use `rounded-control` for controls and compact rows, `rounded-panel` for framed surfaces, `rounded-chip` for pills, and `rounded-message` for chat messages. Do not introduce raw `rounded-md` or `rounded-lg`.
- Use `TooltipActionButton` for icon-only actions. Trigger adapters may render a low-level `Button`, but the action still needs the shared tooltip wrapper.
- `src/components/__tests__/design-system-contract.test.ts` enforces typography, radius, icon-size, primitive SVG, and icon-button rules.

## i18n Rules

- Shared component props for `title`, `label`, `description`, `emptyText`, and actions should accept `React.ReactNode`.
- Do not concatenate translated sentence fragments.
- Long translated labels must wrap or truncate intentionally; never assume English-length text.
- Generated primitives in `src/components/ui/` should stay text-agnostic.

## Preset Update Checklist

1. Apply the shadcn preset or primitive update on a branch.
2. Review diffs under `src/components/ui/` and `src/globals.css` first.
3. Confirm no feature behavior moved into generated primitives.
4. Run `pnpm lint:check`, `pnpm typecheck`, and `pnpm test:run`.
5. Run targeted tests for number inputs, sliders, selects, switches, and any touched primitive.
6. Manually check model settings, embedding settings, provider settings, chat input, and narrow options width in both light and dark mode.

## Visual QA Checklist

- Options page: settings sidebar, mobile tabs, model settings, provider settings, embedding settings.
- Sidepanel: chat header, composer, message rendering, search dialog, empty states.
- Themes: light, dark, and system mode.
- Long text: use a language with longer labels and verify buttons, rows, cards, and badges do not overlap.
- Density: controls should remain compact without relying on raw per-file heights.
