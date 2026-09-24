import type { AgentDisplayText } from "@ollama-client/contracts"
import type { TFunction } from "i18next"

import { agentDisplayValues, agentPlainText } from "./presentation"

/** A value naming a key: translated first, then interpolated under its stem. */
const KEY_SUFFIX = "Key"

const translatedValues = (
  t: TFunction,
  values: AgentDisplayText["values"]
): Record<string, string | number> | undefined => {
  const flattened = agentDisplayValues(values)
  if (!flattened) return undefined
  const out: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(flattened)) {
    if (!name.endsWith(KEY_SUFFIX) || name === KEY_SUFFIX) {
      out[name] = value
      continue
    }
    /** Only this build's own vocabulary is looked up; anything else is dropped. */
    if (typeof value === "string" && value.startsWith("agent.")) {
      out[name.slice(0, -KEY_SUFFIX.length)] = t(value)
    }
  }
  return out
}

/**
 * The sentences a runtime request names, said in the panel's language.
 *
 * A record written before the runtime carried keys has only its English, and
 * that is shown as it stands — flattened and bounded like any other text
 * the panel did not compose.
 */
export const agentDisplayString = (
  t: TFunction,
  parts: readonly AgentDisplayText[] | undefined,
  fallback: string,
  limit: number
): string =>
  parts?.length
    ? parts
        .map((part) => t(part.key, translatedValues(t, part.values)))
        .join(" ")
    : agentPlainText(fallback, limit)
