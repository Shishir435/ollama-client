export type AgentControlIntent = "pause" | "stop"

const intents = new Map<string, AgentControlIntent>()

export const setAgentControlIntent = (
  requestId: string,
  intent: AgentControlIntent
): void => {
  intents.set(requestId, intent)
}

export const consumeAgentControlIntent = (
  requestId: string
): AgentControlIntent | undefined => {
  const intent = intents.get(requestId)
  intents.delete(requestId)
  return intent
}
