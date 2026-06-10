export const buildShadowStyles = (appStyles: string): string => `
  ${appStyles}

  /*
   * Inject ALL design tokens with concrete values on the root container.
   * This prevents host-page CSS variables (e.g. YouTube's --card) from
   * leaking in via CSS custom property inheritance.
   * font-size: 16px normalises rem units regardless of the host page's
   * root font-size (some sites set html { font-size: 62.5% }).
   */
  #selection-actions-root {
    font-size: 16px;

    /*
     * Pin Tailwind v4 CSS vars to absolute px values so rem-based host
     * pages (e.g. YouTube: html{font-size:62.5%}) don't shrink our UI.
     * --spacing fixes h-*, size-*, gap-*, px-*, py-* (all calc(var(--spacing)*N))
     * --text-xs fixes button/label font sizes
     * --radius fixes rounded-* variants
     */
    --spacing: 4px;
    --text-xs: 12px;
    --text-xs--line-height: 1.625;
    --text-sm: 14px;
    --text-sm--line-height: 1.4286;

    /* Radius */
    --radius: 10px;
    --radius-xs: 2px;
    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 10px;
    --radius-xl: 14px;

    /* Light mode tokens */
    --background: oklch(1 0 0);
    --foreground: oklch(0.141 0.005 285.823);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.141 0.005 285.823);
    --popover: oklch(1 0 0);
    --popover-foreground: oklch(0.141 0.005 285.823);
    --primary: oklch(0.21 0.006 285.885);
    --primary-foreground: oklch(0.985 0 0);
    --secondary: oklch(0.967 0.001 286.375);
    --secondary-foreground: oklch(0.21 0.006 285.885);
    --muted: oklch(0.967 0.001 286.375);
    --muted-foreground: oklch(0.552 0.016 285.938);
    --accent: oklch(0.967 0.001 286.375);
    --accent-foreground: oklch(0.21 0.006 285.885);
    --destructive: oklch(0.577 0.245 27.325);
    --destructive-foreground: oklch(0.985 0 0);
    --border: oklch(0.92 0.004 286.32);
    --input: oklch(0.92 0.004 286.32);
    --ring: oklch(0.705 0.015 286.067);

    /* sa- aliases */
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

  /* Dark mode: override only changed tokens */
  #selection-actions-root.dark {
    --background: oklch(0.141 0.005 285.823);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.21 0.006 285.885);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.21 0.006 285.885);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.92 0.004 286.32);
    --primary-foreground: oklch(0.21 0.006 285.885);
    --secondary: oklch(0.274 0.006 286.033);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.274 0.006 286.033);
    --muted-foreground: oklch(0.705 0.015 286.067);
    --accent: oklch(0.274 0.006 286.033);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.704 0.191 22.216);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 15%);
    --ring: oklch(0.552 0.016 285.938);
    --sa-shadow: 0 4px 24px oklch(0 0 0 / 0.36);
  }

  /* Tooltip overrides for shadow DOM */
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

  /* Toolbar */
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

  /* Toolbar label hidden (text shown in panel mode only) */
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

  /* Card overrides for the panel */
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

  /* Panel header */
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

  /* Result area */
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

  /* Markdown prose inside panel */
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

  /* Custom prompt form */
  .sa-custom-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }

  /* Panel footer actions */
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

  /* Toolbar more menu */
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

  /* Thinking / reasoning section */
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
    font-size: 8px;
    opacity: 0.6;
  }
  .sa-thinking-chevron-end {
    margin-left: auto;
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
`
