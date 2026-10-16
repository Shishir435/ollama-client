/**
 * The overlay's shadow-root stylesheet: the compiled app styles, then the
 * overlay's own values.
 *
 * Colors are not here. They come from src/theme-tokens.css, which
 * selection-overlay.css imports and which declares them on
 * `#selection-actions-root` inside the shadow root, so the app and the overlay
 * read one definition and a host page's custom properties (YouTube's `--card`,
 * or a `*` rule that reaches the host element) cannot leak in.
 *
 * What is here is pinned to px, because a host page can set its root font size
 * (`html { font-size: 62.5% }`) and every rem would follow it: the 16px base,
 * `--spacing` (h-*, size-*, gap-*, px-*, py-*), the text sizes, and the radii.
 * The control and panel radii are re-derived for the same reason, since the
 * shared tokens compute them from a rem `--radius`.
 *
 * Comments inside the template literal ship to every page, so they stay here.
 */
/**
 * Chrome ignores `@property` inside a shadow tree, so every Tailwind variable
 * registered there starts unset instead of at its initial value. Ring, shadow
 * and outline utilities compose several of them into one `box-shadow` or
 * `outline-style`; a single unset part invalidates the whole declaration and
 * a focused button draws nothing. Tailwind ships the same fallback for
 * browsers without `@property`, but gates it on a feature query Chrome does
 * not match. This restates each registration as a plain declaration in the
 * lowest layer, so any utility on the element still wins.
 */
export const registeredPropertyFallback = (appStyles: string): string => {
  const inherited: string[] = []
  const local: string[] = []
  for (const [, name, body] of appStyles.matchAll(
    /@property\s+(--[\w-]+)\s*\{([^}]*)\}/g
  )) {
    const initial = /initial-value:\s*([^;]+)/.exec(body)?.[1].trim()
    const isLength = /syntax:\s*["']<length>["']/.test(body)
    const value =
      initial === undefined
        ? "initial"
        : isLength && initial === "0"
          ? "0px"
          : initial
    const target = /inherits:\s*true/.test(body) ? inherited : local
    target.push(`${name}:${value}`)
  }
  if (inherited.length === 0 && local.length === 0) return ""
  const rules = [
    inherited.length > 0 ? `:host{${inherited.join(";")}}` : "",
    local.length > 0 ? `*,::before,::after,::backdrop{${local.join(";")}}` : ""
  ]
  return `@layer properties{${rules.join("")}}`
}

export const buildShadowStyles = (appStyles: string): string => `
  ${appStyles}
  ${registeredPropertyFallback(appStyles)}

  #selection-actions-root {
    font-size: 16px;
    --spacing: 4px;
    --text-xs: 12px;
    --text-xs--line-height: 1.625;
    --text-sm: 14px;
    --text-sm--line-height: 1.4286;
    --radius: 10px;
    --radius-xs: 2px;
    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 10px;
    --radius-xl: 14px;
    --radius-control: calc(var(--radius) - 1px);
    --radius-panel: calc(var(--radius) + 1px);
    --radius-chip: 999px;
    --sa-radius-lg: var(--radius-lg);
    --sa-radius-md: var(--radius-md);
    --sa-bg: var(--background);
    --sa-fg: var(--foreground);
    --sa-muted: var(--muted-foreground);
    --sa-border: var(--border);
    --sa-hover: var(--muted);
    --sa-accent: var(--primary);
    --sa-danger: var(--destructive);
    --sa-shadow: 0 4px 24px oklch(0.141 0.005 285.823 / 0.18);
  }

  #selection-actions-root.dark {
    --sa-shadow: 0 4px 24px oklch(0 0 0 / 0.36);
  }

  [data-slot="tooltip-content"] {
    box-sizing: border-box !important;
    border-radius: var(--radius-md) !important;
    background-color: var(--foreground) !important;
    color: var(--background) !important;
    font-size: 12px !important;
    line-height: 1.4 !important;
    font-family: system-ui, sans-serif !important;
    padding: 6px 12px !important;
    max-width: 288px !important;
    box-shadow: 0 4px 6px -1px oklch(0 0 0 / 0.12) !important;
  }
  .dark [data-slot="tooltip-content"] {
    background-color: var(--card) !important;
    color: var(--card-foreground) !important;
    border: 1px solid var(--border) !important;
    box-shadow: 0 4px 6px -1px oklch(0 0 0 / 0.28) !important;
  }
  [data-slot="tooltip-arrow"] {
    display: none !important;
  }

  .sa-toolbar {
    box-sizing: border-box;
    width: fit-content;
    max-width: calc(100vw - 16px);
    padding: 5px;
    position: relative;
    background: var(--sa-bg);
    color: var(--sa-fg);
    border: 1px solid var(--sa-border);
    border-radius: var(--sa-radius-lg);
    box-shadow: var(--sa-shadow);
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 12px;
    line-height: 1.4;
  }
  .sa-toolbar-strip {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: calc(100vw - 28px);
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }
  .sa-toolbar-strip::-webkit-scrollbar {
    display: none;
  }

  .sa-toolbar .sa-label {
    display: none;
  }

  .sa-drag-handle svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .sa-panel-card {
    width: min(470px, calc(100vw - 16px));
    gap: 0;
    padding: 0;
    box-shadow: var(--sa-shadow);
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 12px;
    line-height: 1.4;
  }
  .sa-card-header {
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--sa-border);
    gap: 0;
    display: block;
  }
  .sa-card-content {
    padding: 12px 16px 4px;
  }
  .sa-card-footer {
    padding: 0 16px 14px;
  }

  .sa-panel-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sa-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .sa-title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .sa-title {
    font-size: 15px;
    line-height: 1.25;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    max-width: 220px;
  }
  .sa-drag-handle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 28px;
    color: var(--sa-muted);
    cursor: grab;
    touch-action: none;
    flex-shrink: 0;
  }
  .sa-drag-handle:active {
    cursor: grabbing;
  }
  .sa-model-inline {
    appearance: none;
    -webkit-appearance: none;
    border: none;
    background: transparent;
    color: var(--sa-muted);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
    padding-right: 14px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0 center;
    background-size: 10px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sa-model-inline:focus {
    outline: none;
  }
  .sa-model-inline:focus-visible,
  .sa-action-select:focus-visible,
  .sa-thinking-header:focus-visible {
    outline: none;
    border-radius: var(--radius-xs);
    box-shadow: 0 0 0 1px var(--ring), 0 0 0 3px var(--focus-ring);
  }
  .sa-model-name {
    font-size: 12px;
    color: var(--sa-muted);
  }
  .sa-action-select {
    appearance: none;
    -webkit-appearance: none;
    border: none;
    background: transparent;
    color: var(--sa-fg);
    font: inherit;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.25;
    cursor: pointer;
    padding: 0 16px 0 0;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23555' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0 center;
    background-size: 10px;
    min-width: 0;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .sa-action-select:focus {
    outline: none;
  }
  .dark .sa-action-select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23aaa' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  }

  .sa-result {
    min-height: 96px;
    max-height: 240px;
    overflow: auto;
    padding: 10px 4px;
    border: 0;
    background: transparent;
    color: var(--sa-fg);
    font-size: 15px;
    line-height: 1.48;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .sa-result--md {
    white-space: normal;
  }
  .sa-error {
    color: var(--sa-danger);
  }
  .sa-notice {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.4;
  }

  .sa-markdown { font-size: 15px; line-height: 1.55; color: var(--sa-fg); overflow-wrap: anywhere; }
  .sa-markdown p { margin: 0 0 8px; }
  .sa-markdown p:last-child { margin-bottom: 0; }
  .sa-markdown ul, .sa-markdown ol { margin: 0 0 8px; padding-left: 20px; }
  .sa-markdown ul { list-style-type: disc; }
  .sa-markdown ol { list-style-type: decimal; }
  .sa-markdown li { margin-bottom: 3px; }
  .sa-markdown li p { margin: 0; }
  .sa-markdown strong { font-weight: 600; }
  .sa-markdown em { font-style: italic; }
  .sa-markdown h1, .sa-markdown h2, .sa-markdown h3,
  .sa-markdown h4, .sa-markdown h5, .sa-markdown h6 {
    font-weight: 700; margin: 10px 0 4px; line-height: 1.3;
  }
  .sa-markdown h1 { font-size: 17px; }
  .sa-markdown h2 { font-size: 16px; }
  .sa-markdown h3, .sa-markdown h4, .sa-markdown h5, .sa-markdown h6 { font-size: 15px; }
  .sa-markdown a { color: var(--sa-accent); text-decoration: underline; cursor: pointer; }
  .sa-markdown code {
    font-family: ui-monospace, monospace;
    font-size: 13px;
    background: var(--muted);
    padding: 1px 4px;
    border-radius: 4px;
  }
  .sa-markdown pre {
    background: var(--muted);
    border-radius: 6px;
    padding: 10px 12px;
    overflow-x: auto;
    margin: 0 0 8px;
  }
  .sa-markdown pre code {
    background: none;
    padding: 0;
    font-size: 13px;
  }
  .sa-markdown blockquote {
    border-left: 3px solid var(--sa-border);
    margin: 0 0 8px;
    padding: 2px 12px;
    color: var(--sa-muted);
  }
  .sa-markdown hr { border: none; border-top: 1px solid var(--sa-border); margin: 10px 0; }
  .sa-muted {
    color: var(--sa-muted);
  }

  .sa-custom-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }

  .sa-panel-actions {
    display: flex;
    flex-wrap: nowrap;
    justify-content: space-between;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    width: 100%;
  }
  .sa-panel-actions::-webkit-scrollbar {
    display: none;
  }
  .sa-action-group {
    display: flex;
    flex: 0 0 auto;
    flex-wrap: nowrap;
    gap: 8px;
  }
  .apply-group {
    margin-left: auto;
  }

  .sa-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 6px;
    width: min(220px, calc(100vw - 28px));
    padding: 5px;
    background: var(--sa-bg);
    color: var(--sa-fg);
    border: 1px solid var(--sa-border);
    border-radius: var(--sa-radius-lg);
    box-shadow: var(--sa-shadow);
    z-index: 1;
  }
  .sa-menu-item {
    width: 100% !important;
    justify-content: flex-start !important;
    text-align: left;
  }

  .sa-thinking-section {
    border: 1px solid var(--sa-border);
    border-radius: var(--sa-radius-md);
    margin-bottom: 8px;
    overflow: hidden;
  }
  .sa-thinking-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    background: var(--sa-hover);
    color: var(--sa-muted);
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    border: none;
    user-select: none;
  }
  .sa-thinking-header:hover {
    background: color-mix(in oklch, var(--sa-border) 60%, var(--sa-hover));
  }
  .sa-thinking-label {
    flex: 1;
    min-width: 0;
  }
  .sa-thinking-chevron {
    margin-left: auto;
    opacity: 0.6;
    flex-shrink: 0;
    transition: transform 150ms ease;
  }
  .sa-thinking-chevron[data-expanded="true"] {
    transform: rotate(90deg);
  }
  @keyframes sa-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }
  .sa-thinking-pulse {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--sa-accent);
    flex-shrink: 0;
    animation: sa-pulse 1.2s ease-in-out infinite;
  }
  .sa-thinking-body {
    max-height: 140px;
    overflow-y: auto;
    padding: 8px 10px;
    font-size: 11px;
    color: var(--sa-muted);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: color-mix(in oklch, var(--sa-hover) 50%, transparent);
    border-top: 1px solid var(--sa-border);
  }
  .sa-thinking-body .sa-markdown {
    font-size: 11px;
    line-height: 1.4;
    white-space: normal;
  }
  .sa-thinking-body .sa-markdown p {
    margin-bottom: 2px;
  }
  .sa-thinking-body .sa-markdown p:last-child {
    margin-bottom: 0;
  }
  .sa-thinking-body .sa-markdown li {
    margin-bottom: 0;
  }
  .sa-thinking-body .sa-markdown ul,
  .sa-thinking-body .sa-markdown ol {
    margin-bottom: 4px;
  }

  @media (prefers-reduced-motion: reduce) {
    #selection-actions-root *,
    #selection-actions-root *::before,
    #selection-actions-root *::after {
      animation: none !important;
      transition: none !important;
    }
  }
`
