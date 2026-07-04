import { ChevronDown, CircleCheck, CircleX, LoaderCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import type { AgentStep } from "@/types/agent"

const duration = (step: AgentStep): string | undefined =>
  step.completedAt
    ? `${Math.max(0, step.completedAt - step.startedAt)}ms`
    : undefined

const AgentStepCard = ({ step }: { step: AgentStep }) => {
  const [open, setOpen] = useState(step.status !== "done")
  const { t } = useTranslation()

  useEffect(() => {
    setOpen(step.status !== "done")
  }, [step.status])

  const Icon =
    step.status === "error"
      ? CircleX
      : step.status === "done"
        ? CircleCheck
        : LoaderCircle

  return (
    <li className="rounded-control border border-border/40 bg-background/55">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <Icon
          className={cn(
            "icon-xs shrink-0",
            step.status === "error"
              ? "text-destructive"
              : step.status === "done"
                ? "text-status-success"
                : "animate-spin text-app-primary motion-reduce:animate-none"
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {step.label}
        </span>
        {step.origin && (
          <span className="max-w-32 truncate text-2xs text-muted-foreground">
            {step.origin}
          </span>
        )}
        {duration(step) && (
          <span className="text-2xs text-muted-foreground">
            {duration(step)}
          </span>
        )}
        <ChevronDown
          className={cn(
            "icon-xs transition-transform motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
      </button>
      {open && step.result && (
        <div className="border-t border-border/30 px-2 py-1.5 text-muted-foreground">
          {step.result}
        </div>
      )}
      <span className="sr-only">{t(`agent.step_status.${step.status}`)}</span>
    </li>
  )
}

export const AgentRunTimeline = ({ steps }: { steps: AgentStep[] }) => {
  const { t } = useTranslation()
  const ref = useRef<HTMLOListElement>(null)
  const [autoFollow, setAutoFollow] = useState(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow live step mutations
  useEffect(() => {
    if (!autoFollow || !ref.current) return
    ref.current.scrollTop = ref.current.scrollHeight
  }, [autoFollow, steps])

  if (steps.length === 0) return null

  return (
    <div className="mb-2">
      <div className="mb-1 text-2xs font-medium text-muted-foreground">
        {t("agent.timeline.title")}
      </div>
      <ol
        ref={ref}
        className="scroll-fade-y flex max-h-52 flex-col gap-1 overflow-y-auto"
        aria-label={t("agent.timeline.title")}
        aria-live="polite"
        onScroll={(event) => {
          const node = event.currentTarget
          setAutoFollow(
            node.scrollHeight - node.scrollTop - node.clientHeight < 24
          )
        }}>
        {steps.map((step) => (
          <AgentStepCard key={step.id} step={step} />
        ))}
      </ol>
    </div>
  )
}
