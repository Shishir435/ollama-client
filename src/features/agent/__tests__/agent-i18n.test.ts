import {
  AGENT_RUN_STATUSES,
  AGENT_STEP_STATUSES
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import de from "@/locales/de/translation.json"
import en from "@/locales/en/translation.json"
import es from "@/locales/es/translation.json"
import fr from "@/locales/fr/translation.json"
import hi from "@/locales/hi/translation.json"
import itLocale from "@/locales/it/translation.json"
import ja from "@/locales/ja/translation.json"
import ru from "@/locales/ru/translation.json"
import zh from "@/locales/zh/translation.json"

const flatten = (value: unknown, prefix = ""): string[] => {
  if (!value || typeof value !== "object") return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key)
  )
}

describe("Agent locale coverage", () => {
  it("keeps every Agent key in all nine locales", () => {
    const expected = flatten(en.agent).sort()
    for (const locale of [de, es, fr, hi, itLocale, ja, ru, zh]) {
      expect(flatten(locale.agent).sort()).toEqual(expected)
    }
  })

  /**
   * The panel builds this key from the status at runtime, so a status added
   * to the machine without a label shows the reader `agent.status.partial`
   * rather than a word. Nothing else would catch it: the key is never
   * written down for the locale linter to find.
   */
  it("labels every run status the machine can reach", () => {
    const labelled = Object.keys(en.agent.status)
    for (const status of AGENT_RUN_STATUSES) expect(labelled).toContain(status)
  })

  it("labels every step status the work log can show", () => {
    const labelled = Object.keys(en.agent.step_status)
    for (const status of AGENT_STEP_STATUSES) expect(labelled).toContain(status)
  })
})
