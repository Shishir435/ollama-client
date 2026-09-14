import { CircleCheck, CircleDashed, CircleX, ShieldAlert } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/class-names"
import type { AgentWorkLogItem } from "../lib/presentation"

const iconFor = (status: AgentWorkLogItem["status"]) => {
  if (status === "verified") return CircleCheck
  if (status === "failed" || status === "rejected") return CircleX
  if (status === "uncertain") return ShieldAlert
  return CircleDashed
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
          const active = [
            "planned",
            "approved",
            "executing",
            "executed"
          ].includes(item.status)
          return (
            <li key={item.id} className="flex min-w-0 items-stretch gap-2">
              <div className="relative flex w-5 shrink-0 justify-center pt-2">
                {(index < items.length - 1 || live) && (
                  <span
                    className="absolute top-5 bottom-0 w-px bg-border"
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
              <div className="min-w-0 flex-1 border-b border-border-subtle py-1.5 last:border-b-0">
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="wrap-break-word text-xs">
                      {t(item.label.key, item.label.values)}
                    </p>
                    <span className="sr-only">
                      {t(`agent.step_status.${item.status}`)}
                    </span>
                    {/*
                    The control's own name, quoted so it reads as the page's
                    words rather than as part of the sentence above it.
                  */}
                    {item.target && (
                      <p className="mt-0.5 wrap-break-word text-2xs text-muted-foreground">
                        {t("agent.work_log.target", { name: item.target })}
                      </p>
                    )}
                    {/*
                    The model's own note for the step. It is why the run did
                    this, in its words, and it was durable long before it was
                    ever shown.
                  */}
                    {item.note && (
                      <p className="mt-1 wrap-break-word border-l-2 border-border pl-2 text-2xs text-muted-foreground">
                        {item.note}
                      </p>
                    )}
                    {item.detail && (
                      <p className="mt-0.5 wrap-break-word text-2xs text-muted-foreground">
                        {item.detail}
                      </p>
                    )}
                  </div>
                  <time
                    className="shrink-0 text-micro text-muted-foreground"
                    dateTime={new Date(item.at).toISOString()}>
                    {new Date(item.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </time>
                </div>
                {!live && last && active && controls}
              </div>
            </li>
          )
        })}
        {live && (
          <li className="flex min-w-0 items-stretch gap-2">
            <div className="relative flex w-5 shrink-0 justify-center pt-2">
              <span
                className="size-2.5 animate-pulse rounded-full bg-app-agent ring-4 ring-app-primary-soft"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0 flex-1 py-1.5">
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
