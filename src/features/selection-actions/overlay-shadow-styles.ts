export const buildShadowStyles = (appStyles: string): string => `
  ${appStyles}

  :host {
    --radius: 0.625rem;
  }
  #selection-actions-root {
    --sa-radius-lg: var(--radius-lg, var(--radius, 0.625rem));
    --sa-radius-md: var(--radius-md, calc(var(--radius, 0.625rem) - 2px));
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

  /* Tooltip overrides for shadow DOM */
  [data-slot="tooltip-content"] {
    box-sizing: border-box !important;
    border-radius: var(--radius-md, calc(var(--radius, 0.625rem) - 2px)) !important;
    background-color: var(--foreground) !important;
    color: var(--background) !important;
    font-size: 0.75rem !important;
    line-height: 1.4 !important;
    font-family: var(--font-sans, system-ui, sans-serif) !important;
    padding: 0.375rem 0.75rem !important;
    max-width: 18rem !important;
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
    font-size: 0.75rem;
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

  /* Shared button + input */
  .sa-button,
  .sa-input {
    box-sizing: border-box;
    height: var(--control-height-sm, 1.75rem);
    border: 1px solid transparent;
    border-radius: var(--sa-radius-md);
    background: transparent;
    color: var(--sa-fg);
    font: inherit;
  }
  .sa-button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 0.75rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .sa-button:hover:not(:disabled) {
    background: var(--sa-hover);
  }
  .sa-button:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
  .sa-button.primary {
    background: var(--accent);
    color: var(--accent-foreground);
    font-weight: 600;
  }
  .sa-toolbar .sa-button {
    width: var(--control-height-sm, 1.75rem);
    height: var(--control-height-sm, 1.75rem);
    padding: 0;
  }
  .sa-toolbar .sa-button.primary {
    width: var(--control-height-sm, 1.75rem);
    min-width: var(--control-height-sm, 1.75rem);
    padding: 0;
  }
  .sa-toolbar .sa-label {
    display: none;
  }
  .sa-button.outline {
    border-color: var(--sa-border);
    background: var(--sa-bg);
  }
  .sa-button.fill {
    background: var(--primary);
    color: var(--primary-foreground);
    border-color: var(--primary);
  }
  .sa-button.danger {
    color: var(--sa-danger);
  }
  .sa-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .sa-button svg,
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
    font-size: 0.75rem;
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
    width: 1.5rem;
    height: var(--control-height-sm, 1.75rem);
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
    font-size: 0.75rem;
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
    font-size: 0.75rem;
    color: var(--sa-muted);
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
  .sa-error {
    color: var(--sa-danger);
  }
  .sa-muted {
    color: var(--sa-muted);
  }

  /* Custom prompt form */
  .sa-custom-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }
  .sa-input {
    width: 100%;
    min-width: 0;
    padding: 0 0.5rem;
    border-color: var(--input, var(--sa-border));
    background: color-mix(in oklch, var(--input, var(--sa-border)) 20%, transparent);
  }
  .sa-input:focus-visible,
  .sa-input:focus {
    outline: none;
    border-color: var(--ring);
    box-shadow: 0 0 0 2px color-mix(in oklch, var(--ring) 30%, transparent);
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
  .sa-panel-actions .sa-button {
    min-width: 2.625rem;
    height: var(--control-height-sm, 1.75rem);
    padding: 0 0.625rem;
  }
  .sa-panel-actions .icon-only {
    width: 2.625rem;
    padding: 0;
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
    height: var(--control-height-sm, 1.75rem);
    padding: 0 0.625rem !important;
    justify-content: flex-start;
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
    font-size: 0.6875rem;
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
    font-size: 0.5rem;
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
    font-size: 0.6875rem;
    color: var(--sa-muted);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: color-mix(in oklch, var(--sa-hover) 50%, transparent);
    border-top: 1px solid var(--sa-border);
  }
`
