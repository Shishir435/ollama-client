/** Shared reading of a runtime's token counts. */
import type { TurnUsage } from "../backends/types.js"

/** Whether a count says anything; an all-zero one is the same as none. */
export const hasUsage = (usage: TurnUsage): boolean =>
  usage.promptTokens > 0 || usage.completionTokens > 0
