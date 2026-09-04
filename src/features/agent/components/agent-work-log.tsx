import { CircleCheck, CircleDashed, CircleX, ShieldAlert } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/class-names"
import type { AgentWorkLogItem } from "../lib/presentation"

const iconFor = (status: AgentWorkLogItem["status"]) => {
  if (status === "verified") return CircleCheck
  if (status === "failed" || status === "rejected") return CircleX
  if (status === "uncertain") return ShieldAlert
  return CircleDashed
}

export const AgentWorkLog = ({ items }: { items: AgentWorkLogItem[] }) => {
  const { t } = useTranslation()
  if (items.length === 0) return null

  return (
    <section className="min-w-0" aria-labelledby="agent-work-log-title">
      <h2
        id="agent-work-log-title"
        className="mb-1.5 text-xs font-medium text-muted-foreground">
        {t("agent.work_log.title")}
      </h2>
      <ol className="flex min-w-0 flex-col gap-1" aria-live="polite">
        {items.map((item) => {
          const Icon = iconFor(item.status)
          return (
            <li
              key={item.id}
              className="min-w-0 overflow-hidden rounded-control border border-border/50 bg-background px-2 py-1.5">
              <div className="flex min-w-0 items-start gap-2">
                <Icon
                  className={cn(
                    "icon-xs mt-0.5 shrink-0",
                    item.status === "verified" && "text-status-success",
                    (item.status === "failed" || item.status === "rejected") &&
                      "text-destructive",
                    item.status === "uncertain" && "text-status-warning"
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xs">{item.label}</p>
                  {item.detail && (
                    <p className="mt-0.5 break-words text-2xs text-muted-foreground">
                      {item.detail}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-micro text-muted-foreground">
                  {t(`agent.step_status.${item.status}`)}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
