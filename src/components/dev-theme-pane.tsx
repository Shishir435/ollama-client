import { useEffect, useMemo, useRef, useState } from "react"

type ThemeToken = {
  key: string
  label: string
  group: "Surfaces" | "Controls"
}

type OklchValue = {
  l: number
  c: number
  h: number
  a?: number
}

type DragState = {
  startX: number
  startY: number
  x: number
  y: number
}

const DEV_THEME_STORAGE_KEY = "dev-theme-token-overrides"

const THEME_TOKENS: ThemeToken[] = [
  { key: "--background", label: "Background", group: "Surfaces" },
  { key: "--card", label: "Card", group: "Surfaces" },
  { key: "--popover", label: "Popover", group: "Surfaces" },
  { key: "--surface-sidebar", label: "Sidebar", group: "Surfaces" },
  { key: "--surface-chat", label: "Chat", group: "Surfaces" },
  { key: "--surface-composer", label: "Composer", group: "Surfaces" },
  { key: "--surface-message", label: "Message", group: "Surfaces" },
  { key: "--primary", label: "Primary", group: "Controls" },
  { key: "--secondary", label: "Secondary", group: "Controls" },
  { key: "--muted", label: "Muted", group: "Controls" },
  { key: "--border", label: "Border", group: "Controls" },
  { key: "--border-strong", label: "Border strong", group: "Controls" },
  { key: "--input", label: "Input", group: "Controls" },
  { key: "--ring", label: "Ring", group: "Controls" }
]

const getRootStyle = () => getComputedStyle(document.documentElement)

const readTokenValue = (key: string) =>
  getRootStyle().getPropertyValue(key).trim()

const parseOklch = (value: string): OklchValue | null => {
  const match = value.match(
    /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%?)?\)$/
  )

  if (!match) return null

  return {
    l: Number(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
    a: match[4] ? Number(match[4]) : undefined
  }
}

const formatOklch = ({ l, c, h, a }: OklchValue) => {
  const base = `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${Math.round(h)})`
  return typeof a === "number"
    ? base.replace(")", ` / ${Math.round(a)}%)`)
    : base
}

const readTokenParams = () => {
  const params: Record<string, OklchValue> = {}
  for (const token of THEME_TOKENS) {
    const parsed = parseOklch(readTokenValue(token.key))
    if (parsed) params[token.key] = parsed
  }
  return params
}

const applyOverrides = (overrides?: Record<string, string>) => {
  for (const token of THEME_TOKENS) {
    const value = overrides?.[token.key]
    if (value) {
      document.documentElement.style.setProperty(token.key, value)
    } else {
      document.documentElement.style.removeProperty(token.key)
    }
  }
}

const sliderBackground = (value: OklchValue, channel: keyof OklchValue) => {
  if (channel === "l") {
    return `linear-gradient(90deg, oklch(0 ${value.c} ${value.h}), oklch(1 ${value.c} ${value.h}))`
  }

  if (channel === "c") {
    return `linear-gradient(90deg, oklch(${value.l} 0 ${value.h}), oklch(${value.l} 0.4 ${value.h}))`
  }

  if (channel === "h") {
    return `linear-gradient(90deg, oklch(${value.l} ${value.c} 0), oklch(${value.l} ${value.c} 60), oklch(${value.l} ${value.c} 120), oklch(${value.l} ${value.c} 180), oklch(${value.l} ${value.c} 240), oklch(${value.l} ${value.c} 300), oklch(${value.l} ${value.c} 360))`
  }

  return "linear-gradient(90deg, transparent, currentColor)"
}

const DevThemePanel = ({
  onClose,
  onReset,
  onCopy,
  params,
  updateToken
}: {
  onClose: () => void
  onReset: () => void
  onCopy: () => void
  params: Record<string, OklchValue>
  updateToken: (
    key: string,
    channel: keyof OklchValue,
    nextValue: number
  ) => void
}) => {
  const [position, setPosition] = useState({ x: 20, y: 90 })
  const dragRef = useRef<DragState | null>(null)

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      x: position.x,
      y: position.y
    }
  }

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragRef.current
    if (!dragState) return

    const nextX = dragState.x + event.clientX - dragState.startX
    const nextY = dragState.y + event.clientY - dragState.startY
    setPosition({
      x: Math.min(Math.max(8, nextX), window.innerWidth - 340),
      y: Math.min(Math.max(8, nextY), window.innerHeight - 96)
    })
  }

  const stopDrag = () => {
    dragRef.current = null
  }

  const groupedTokens = useMemo(
    () => ({
      Surfaces: THEME_TOKENS.filter((token) => token.group === "Surfaces"),
      Controls: THEME_TOKENS.filter((token) => token.group === "Controls")
    }),
    []
  )

  return (
    <div
      className="fixed z-2147483647 max-h-[min(44rem,calc(100vh-1rem))] w-[min(21rem,calc(100vw-1rem))] overflow-hidden border border-border bg-popover text-popover-foreground shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        borderRadius: "var(--radius-panel)"
      }}>
      <div
        className="flex cursor-move select-none items-center justify-between border-border border-b bg-muted px-3 py-2 text-sm"
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}>
        <span className="font-medium">Theme Lab</span>
        <button
          type="button"
          className="grid size-7 place-items-center rounded-control text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}>
          x
        </button>
      </div>

      <div className="max-h-[calc(min(44rem,100vh-1rem)-3rem)] overflow-y-auto p-3">
        <div className="mb-3 grid grid-cols-7 gap-1">
          {THEME_TOKENS.map((token) => (
            <div
              key={token.key}
              className="h-5 border border-border"
              style={{
                background: formatOklch(params[token.key]),
                borderRadius: "var(--radius-control)"
              }}
              title={`${token.label}: ${formatOklch(params[token.key])}`}
            />
          ))}
        </div>

        {Object.entries(groupedTokens).map(([group, tokens]) => (
          <section key={group} className="mb-4">
            <h3 className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              {group}
            </h3>
            <div className="space-y-3">
              {tokens.map((token) => {
                const value = params[token.key]
                return (
                  <div
                    key={token.key}
                    className="border border-border bg-card p-2"
                    style={{ borderRadius: "var(--radius-panel)" }}>
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="size-5 shrink-0 border border-border"
                        style={{
                          background: formatOklch(value),
                          borderRadius: "var(--radius-control)"
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-sm">
                        {token.label}
                      </span>
                      <code className="text-muted-foreground text-xs">
                        {formatOklch(value)}
                      </code>
                    </div>
                    {(["l", "c", "h"] as const).map((channel) => (
                      <label
                        key={channel}
                        className="grid grid-cols-[1rem_1fr_4.25rem] items-center gap-2 text-xs">
                        <span className="font-medium text-muted-foreground uppercase">
                          {channel}
                        </span>
                        <input
                          type="range"
                          min={channel === "h" ? 0 : 0}
                          max={
                            channel === "l" ? 1 : channel === "c" ? 0.4 : 360
                          }
                          step={channel === "h" ? 1 : 0.001}
                          value={value[channel]}
                          className="h-2 w-full appearance-none rounded-chip accent-primary"
                          style={{
                            background: sliderBackground(value, channel)
                          }}
                          onChange={(event) =>
                            updateToken(
                              token.key,
                              channel,
                              Number(event.target.value)
                            )
                          }
                        />
                        <input
                          type="number"
                          min={channel === "h" ? 0 : 0}
                          max={
                            channel === "l" ? 1 : channel === "c" ? 0.4 : 360
                          }
                          step={channel === "h" ? 1 : 0.001}
                          value={value[channel]}
                          className="h-7 rounded-control border border-border bg-background px-1 text-right text-xs"
                          onChange={(event) =>
                            updateToken(
                              token.key,
                              channel,
                              Number(event.target.value)
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        <div className="sticky bottom-0 grid grid-cols-2 gap-2 bg-popover pt-2">
          <button
            type="button"
            className="h-8 rounded-control bg-secondary px-2 font-medium text-secondary-foreground text-xs hover:bg-accent"
            onClick={onCopy}>
            Copy vars
          </button>
          <button
            type="button"
            className="h-8 rounded-control bg-secondary px-2 font-medium text-secondary-foreground text-xs hover:bg-accent"
            onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}

export const DevThemePane = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [params, setParams] = useState<Record<string, OklchValue>>({})
  const [isOptionsPage, setIsOptionsPage] = useState(false)
  const overridesRef = useRef<Record<string, string>>({})

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return

    const optionsPage = window.location.pathname.endsWith("/options.html")
    setIsOptionsPage(optionsPage)

    const loadOverrides = async () => {
      const stored = await chrome.storage.local.get(DEV_THEME_STORAGE_KEY)
      overridesRef.current = stored[DEV_THEME_STORAGE_KEY] ?? {}
      applyOverrides(overridesRef.current)
      setParams(readTokenParams())
    }

    void loadOverrides()

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[DEV_THEME_STORAGE_KEY]) return
      overridesRef.current = changes[DEV_THEME_STORAGE_KEY].newValue ?? {}
      applyOverrides(overridesRef.current)
      setParams(readTokenParams())
    }

    chrome.storage.onChanged.addListener(onStorageChanged)
    return () => chrome.storage.onChanged.removeListener(onStorageChanged)
  }, [])

  const updateToken = (
    key: string,
    channel: keyof OklchValue,
    nextValue: number
  ) => {
    setParams((current) => {
      const next = {
        ...current,
        [key]: {
          ...current[key],
          [channel]: nextValue
        }
      }
      const formatted = formatOklch(next[key])
      overridesRef.current = {
        ...overridesRef.current,
        [key]: formatted
      }
      document.documentElement.style.setProperty(key, formatted)
      void chrome.storage.local.set({
        [DEV_THEME_STORAGE_KEY]: overridesRef.current
      })
      return next
    })
  }

  const copyVars = async () => {
    const css = THEME_TOKENS.map(
      (token) => `  ${token.key}: ${formatOklch(params[token.key])};`
    ).join("\n")
    await navigator.clipboard.writeText(css)
  }

  const reset = () => {
    overridesRef.current = {}
    applyOverrides(overridesRef.current)
    setParams(readTokenParams())
    void chrome.storage.local.remove(DEV_THEME_STORAGE_KEY)
  }

  if (
    process.env.NODE_ENV !== "development" ||
    !isOptionsPage ||
    Object.keys(params).length === 0
  ) {
    return null
  }

  return (
    <>
      <button
        type="button"
        className="fixed right-3 bottom-3 z-2147483647 grid size-10 place-items-center rounded-chip border border-border bg-popover text-popover-foreground shadow-2xl hover:bg-accent"
        onClick={() => setIsOpen((open) => !open)}
        title="Theme Lab">
        T
      </button>
      {isOpen && (
        <DevThemePanel
          onClose={() => setIsOpen(false)}
          onCopy={copyVars}
          onReset={reset}
          params={params}
          updateToken={updateToken}
        />
      )}
    </>
  )
}
