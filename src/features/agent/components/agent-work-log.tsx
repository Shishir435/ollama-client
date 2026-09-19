import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleX,
  ShieldAlert
} from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/class-names"
import type { AgentWorkLogItem } from "../lib/presentation"

const iconFor = (status: AgentWorkLogItem["status"]) => {
  if (status === "verified") return CircleCheck
  if (status === "failed" || status === "rejected") return CircleX
  if (status === "uncertain") return ShieldAlert
  return CircleDashed
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
  liveAt,
  controls
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
  controls?: ReactNode
}) => {
  const { t } = useTranslation()
  if (items.length === 0 && !live) return null

  return (
    <section className="mb-3 min-w-0" aria-labelledby="agent-work-log-title">
      <h2
        id="agent-work-log-title"
        className="mb-1.5 text-xs font-medium text-muted-foreground">
        {t("agent.work_log.title")}
      </h2>
      <ol className="flex min-w-0 flex-col gap-1" aria-live="polite">
        {items.map((item, index) => {
          const Icon = iconFor(item.status)
          const last = index === items.length - 1
          const hasDetails = Boolean(item.target || item.note || item.detail)
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
              <span className="min-w-0 flex-1 wrap-break-word text-xs">
                {t(item.label.key, item.label.values)}
              </span>
              <span className="sr-only">
                {t(`agent.step_status.${item.status}`)}
              </span>
              <time
                className="shrink-0 text-micro text-muted-foreground"
                dateTime={new Date(item.at).toISOString()}>
                {new Date(item.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </time>
            </>
          )
          const details = (
            <div className="mt-1 space-y-0.5 pl-5 text-2xs text-muted-foreground">
              {item.target && (
                <p className="wrap-break-word">
                  {t("agent.work_log.target", { name: item.target })}
                </p>
              )}
              {item.note && (
                <p className="wrap-break-word border-l-2 border-border pl-2">
                  {item.note}
                </p>
              )}
              {item.detail && <p className="wrap-break-word">{item.detail}</p>}
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
                    item.status === "uncertain" && "text-status-warning"
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
                {!live && last && active && controls}
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
              {controls}
            </div>
          </li>
        )}
      </ol>
    </section>
  )
}
