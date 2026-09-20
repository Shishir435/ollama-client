import { AgentObserveRequestSchema } from "@/lib/browser-agent/control-port"

const envelope = document.querySelector<HTMLTextAreaElement>("#envelope")
const validate = document.querySelector<HTMLButtonElement>("#validate")
const result = document.querySelector<HTMLElement>("#result")

validate?.addEventListener("click", () => {
  if (!envelope || !result) return
  try {
    const parsed = AgentObserveRequestSchema.parse(JSON.parse(envelope.value))
    result.textContent = JSON.stringify(parsed, null, 2)
  } catch {
    result.textContent = "Rejected invalid Agent control request"
  }
})
