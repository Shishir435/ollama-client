import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleX,
  MessageSquareWarning,
  ShieldAlert
} from "lucide-react"
import type { ReactNode } from "react"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/class-names"
import type { AgentWorkLogItem } from "../lib/presentation"

const iconFor = (status: AgentWorkLogItem["status"]) => {
  if (status === "verified") return CircleCheck
  if (status === "dialog_opened") return MessageSquareWarning
  if (status === "failed" || status === "rejected") return CircleX
  if (status === "uncertain") return ShieldAlert
  return CircleDashed
}

/**
 * How long a step took, in the reader's own units: "0.8 s", "12 s",
 * "1 min 5 s". Narrow unit display keeps it one short token at 400px.
 */
const formatDuration = (ms: number, language: string): string => {
  const unit = (value: number, name: "second" | "minute", digits = 0) =>
    new Intl.NumberFormat(language, {
      style: "unit",
      unit: name,
      unitDisplay: "narrow",
      maximumFractionDigits: digits
    }).format(value)
  if (ms < 10_000) return unit(Math.max(ms, 100) / 1_000, "second", 1)
  const seconds = Math.round(ms / 1_000)
  if (seconds < 60) return unit(seconds, "second")
  const rest = seconds % 60
  return rest === 0
    ? unit(Math.floor(seconds / 60), "minute")
    : `${unit(Math.floor(seconds / 60), "minute")} ${unit(rest, "second")}`
}

/**
 * A step's evidence disclosure.
 *
 * The open state lives here, seeded from the step's status, so a snapshot or
 * heartbeat rerender keeps the user's choice: the parent reasserting `open`
 * on every render reopened rows the user had collapsed. The parent keys by
 * step id and status, so a status move (an executing row that fails)
 * remounts and re-establishes the default.
 */
const StepDisclosure = ({
  openByDefault,
  heading,
  children
}: {
  openByDefault: boolean
  heading: ReactNode
  children: ReactNode
}) => {
  const [open, setOpen] = useState(openByDefault)
  return (
    <details
      className="group/step"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-w-0 cursor-pointer list-none items-start gap-2 rounded-control outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="icon-xs mt-0.5 shrink-0 -rotate-90 text-muted-foreground transition-transform group-open/step:rotate-0"
          aria-hidden="true"
        />
        {heading}
      </summary>
      {children}
    </details>
  )
}

export const AgentWorkLog = ({
  items,
  live,
  liveAt
}: {
  items: AgentWorkLogItem[]
  /**
   * What the run is doing right now, shown as the log's last row.
   *
   * A step joins the log only once it has a receipt, so a run that is
   * observing or deciding had nothing to show: the panel was a title above a
   * screen of nothing, at the one moment a person is watching it hardest.
   */
  live?: string
  liveAt?: number
}) => {
  const { t, i18n } = useTranslation()
  /** A settled card draws its own log, so one chat can hold several. */
  const titleId = useId()
  if (items.length === 0 && !live) return null

  return (
    <section className="mb-3 min-w-0" aria-labelledby={titleId}>
      <h2
        id={titleId}
        className="mb-1.5 text-xs font-medium text-muted-foreground">
        {t("agent.work_log.title")}
      </h2>
      <ol className="flex min-w-0 flex-col gap-1" aria-live="polite">
        {items.map((item, index) => {
          const Icon = iconFor(item.status)
          const hasDetails = Boolean(
            item.note || item.thinking || item.detail || item.detailLabel
          )
          const needsAttention = ["failed", "rejected", "uncertain"].includes(
            item.status
          )
          const active = [
            "planned",
            "approved",
            "executing",
            "executed"
          ].includes(item.status)
          const heading = (
            <>
              <span className="line-clamp-2 min-w-0 flex-1 wrap-break-word text-xs">
                {t(item.label.key, item.label.values)}
                {item.target && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {t("agent.work_log.target", { name: item.target })}
                    {item.row && ` — ${item.row}`}
                  </span>
                )}
              </span>
              <span className="sr-only">
                {t(`agent.step_status.${item.status}`)}
              </span>
              <span className="shrink-0 text-micro text-muted-foreground">
                {item.durationMs !== undefined && (
                  <>
                    <span>
                      {formatDuration(item.durationMs, i18n.language)}
                    </span>
                    {" · "}
                  </>
                )}
                <time dateTime={new Date(item.at).toISOString()}>
                  {new Date(item.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </time>
              </span>
            </>
          )
          const details = (
            <div className="mt-1 space-y-0.5 pl-5 text-2xs text-muted-foreground">
              {item.note && (
                <p className="wrap-break-word border-l-2 border-border pl-2">
                  {item.note}
                </p>
              )}
              {item.thinking && (
                <details className="group/reasoning">
                  <summary className="cursor-pointer list-none rounded-control outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
                    <ChevronDown
                      className="icon-xs mr-1 inline -rotate-90 transition-transform group-open/reasoning:rotate-0"
                      aria-hidden="true"
                    />
                    {t("agent.work_log.reasoning")}
                  </summary>
                  <p className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-line wrap-break-word border-l-2 border-border pl-2">
                    {item.thinking}
                  </p>
                </details>
              )}
              {item.detail && <p className="wrap-break-word">{item.detail}</p>}
              {item.detailLabel && (
                <p className="wrap-break-word">
                  {t(item.detailLabel.key, item.detailLabel.values)}
                </p>
              )}
            </div>
          )
          return (
            <li key={item.id} className="flex min-w-0 items-stretch gap-2">
              <div className="relative flex w-5 shrink-0 justify-center pt-1.5">
                {(index < items.length - 1 || live) && (
                  <span
                    className="absolute top-4 -bottom-1 w-px bg-border"
                    aria-hidden="true"
                  />
                )}
                <Icon
                  className={cn(
                    "icon-xs relative z-10 shrink-0 bg-surface-chat",
                    item.status === "verified" && "text-status-success",
                    (item.status === "failed" || item.status === "rejected") &&
                      "text-destructive",
                    (item.status === "uncertain" ||
                      item.status === "dialog_opened") &&
                      "text-status-warning"
                  )}
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0 flex-1 py-1">
                {hasDetails ? (
                  <StepDisclosure
                    key={`${item.id}:${item.status}`}
                    openByDefault={needsAttention || active}
                    heading={heading}>
                    {details}
                  </StepDisclosure>
                ) : (
                  <div className="flex min-w-0 items-start gap-2 pl-5">
                    {heading}
                  </div>
                )}
              </div>
            </li>
          )
        })}
        {live && (
          <li className="flex min-w-0 items-stretch gap-2">
            <div className="relative flex w-5 shrink-0 justify-center pt-1.5">
              <span
                className="size-2.5 animate-pulse rounded-full bg-app-agent ring-4 ring-app-primary-soft"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0 flex-1 py-1">
              <div className="flex min-w-0 items-start gap-2">
                <p className="min-w-0 flex-1 wrap-break-word text-xs font-medium">
                  {live}
                </p>
                {liveAt && (
                  <time
                    className="shrink-0 text-micro text-muted-foreground"
                    dateTime={new Date(liveAt).toISOString()}>
                    {new Date(liveAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </time>
                )}
              </div>
            </div>
          </li>
        )}
      </ol>
    </section>
  )
}
