import { createHash } from "node:crypto"
/** Pin endpoint identity without exporting an address or credentials. */
export const endpointFingerprint = (endpoint) => {
  const url = new URL(endpoint)
  return createHash("sha256")
    .update(`${url.protocol}//${url.host}${url.pathname}`)
    .digest("hex")
}
/** Exact non-secret request controls actually sent upstream, by inference phase. */
export const recordQualificationSettings = (inputs, request, effort) => {
  if (!inputs.qualification || !request?.messages) return
  const tools = request.tools ?? []
  const phase = tools.some((tool) => tool.function?.name === "agent_decision")
    ? "decision"
    : tools.some((tool) => tool.function?.name === "agent_plan")
      ? "planning"
      : tools.some((tool) => tool.function?.name === "agent_completion_review")
        ? "review"
        : "chat"
  const settings = { phase, model: request.model }
  for (const key of [
    "temperature",
    "top_p",
    "max_tokens",
    "max_completion_tokens",
    "seed",
    "reasoning_effort",
    "stream",
    "tool_choice",
    "parallel_tool_calls"
  ]) {
    const value = key === "reasoning_effort" && effort ? effort : request[key]
    if (value !== undefined) settings[key] = value
  }
  inputs.qualification.requestSettings ??= []
  if (
    !inputs.qualification.requestSettings.some(
      (known) => JSON.stringify(known) === JSON.stringify(settings)
    )
  )
    inputs.qualification.requestSettings.push(settings)
}
