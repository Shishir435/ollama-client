import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { agentCommandDisplay } from "@ollama-client/agent-runtime"
import {
  AGENT_RUN_STATUSES,
  AGENT_STEP_STATUSES,
  type AgentCommand,
  AgentCommandSchema,
  AgentDialogStateSchema
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

const hasKey = (path: string): boolean => {
  let node: unknown = en
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return false
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === "string"
}

/** Every field any command variant reads when it is labelled. */
const commandOf = (type: string, patch: Record<string, unknown> = {}) =>
  ({
    type,
    url: "https://example.com",
    tabId: 2,
    condition: "ready",
    key: "Enter",
    target: "header",
    query: "price",
    fields: [{}],
    queries: ["price"],
    toolName: "search",
    accept: true,
    direction: "down",
    ...patch
  }) as unknown as AgentCommand

/**
 * A plural is one key in every language and a different set of forms in
 * each: Russian needs `_few` and `_many` where English has none, and a panel
 * that counts steps in Russian with only `_one`/`_other` reads "5 шага".
 */
const PLURAL_FORMS = /_(zero|one|two|few|many|other)$/
const baseKeys = (keys: string[]): string[] =>
  [...new Set(keys.map((key) => key.replace(PLURAL_FORMS, "")))].sort()

describe("Agent locale coverage", () => {
  it("keeps every Agent key in all nine locales", () => {
    const expected = baseKeys(flatten(en.agent))
    for (const locale of [de, es, fr, hi, itLocale, ja, ru, zh]) {
      expect(baseKeys(flatten(locale.agent))).toEqual(expected)
    }
  })

  it("gives every Russian plural its few and many forms", () => {
    const keys = flatten(ru.agent)
    for (const key of keys.filter((entry) => entry.endsWith("_one"))) {
      const base = key.slice(0, -"_one".length)
      expect(keys).toContain(`${base}_few`)
      expect(keys).toContain(`${base}_many`)
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

  /**
   * The start prompt renders notices by key, and the keys are named in the
   * background, where no component's lint pass would notice one missing.
   */
  it("labels every notice the browser task's start prompt can show", () => {
    for (const key of [
      "agent.start_gate.after_page",
      "agent.start_gate.experimental_model",
      "agent.start_gate.other_tab",
      "agent.start_gate.supervised",
      "agent.privacy.remote_notice",
      "agent.privacy.remote_notice_screenshots"
    ]) {
      expect(hasKey(key), key).toBe(true)
    }
  })

  it("labels every step status the work log can show", () => {
    const labelled = Object.keys(en.agent.step_status)
    for (const status of AGENT_STEP_STATUSES) expect(labelled).toContain(status)
  })

  /**
   * The runtime names every command by key and the panel translates it. The
   * default branch used to build `agent.action.${type}` for anything it did
   * not special-case, and three commands had no label: a batched fill showed
   * `agent.action.fill_form` as its approval and its log row.
   */
  it("labels every command the model can issue", () => {
    const types = AgentCommandSchema.options.map(
      (option) => option.shape.type.value
    )
    const commands = types.flatMap((type) =>
      type === "scroll"
        ? ["up", "down", "left", "right"].map((direction) =>
            commandOf(type, { direction })
          )
        : type === "handle_dialog"
          ? [
              commandOf(type, { accept: true }),
              commandOf(type, { accept: false })
            ]
          : [commandOf(type)]
    )
    for (const command of commands) {
      const { key } = agentCommandDisplay(command)
      expect(hasKey(key), key).toBe(true)
    }
  })

  /**
   * Approvals, takeovers and the run's own questions are composed in the
   * runtime package as keys. A key named there and missing here renders as
   * its path in the one prompt the user must read, so every literal the
   * runtime writes is looked up, plus the dialog keys it assembles.
   */
  it("carries every display key the runtime can emit", () => {
    const sources = ["policy.ts", "controller.ts", "action-label.ts"].map(
      (file) =>
        readFileSync(
          resolve(process.cwd(), "packages/agent-runtime/src", file),
          "utf8"
        )
    )
    const literals = sources.flatMap((source) =>
      [...source.matchAll(/"(agent\.[a-z0-9_.]+)"/g)].map((match) => match[1])
    )
    expect(literals.length).toBeGreaterThan(10)
    const kinds = [...AgentDialogStateSchema.shape.type.options, "dialog"]
    const assembled = ["accept", "dismiss"].flatMap((direction) => [
      `agent.approval_text.${direction}_dialog`,
      `agent.approval_text.${direction}_dialog_origin`
    ])
    for (const key of [
      ...literals,
      ...assembled,
      ...kinds.map((kind) => `agent.dialog_kind.${kind}`)
    ]) {
      expect(hasKey(key), key).toBe(true)
    }
  })
})
