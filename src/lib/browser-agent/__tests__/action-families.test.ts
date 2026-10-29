import { AgentCommandSchema } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { PAGE_TOOL_AGENT_ACTIONS } from "../page-tool-effect"
import {
  DIALOG_AGENT_ACTIONS,
  DOM_MUTATION_AGENT_ACTIONS,
  FORM_FILL_AGENT_ACTIONS,
  NAVIGATION_AGENT_ACTIONS,
  READ_ONLY_AGENT_ACTIONS
} from "../resolved-effect"

/**
 * The effect port routes a command by the family that lists it, and throws
 * "Unsupported Agent action" for one that no family does. A command added to
 * the contract and not to a list would pass every unit test of the code that
 * handles it and fail only when a model first chose it, so the two are tied
 * here: every command the contract can carry is in exactly one family, and no
 * family names a command the contract does not have.
 */
describe("action families", () => {
  const families: Record<string, readonly string[]> = {
    read_only: READ_ONLY_AGENT_ACTIONS,
    navigation: NAVIGATION_AGENT_ACTIONS,
    dom_mutation: DOM_MUTATION_AGENT_ACTIONS,
    form_fill: FORM_FILL_AGENT_ACTIONS,
    dialog: DIALOG_AGENT_ACTIONS,
    page_tool: PAGE_TOOL_AGENT_ACTIONS
  }
  const commands = AgentCommandSchema.options.map(
    (option) => option.shape.type.value as string
  )

  it("puts every command the contract carries in exactly one family", () => {
    for (const command of commands) {
      const owners = Object.entries(families)
        .filter(([, list]) => list.includes(command))
        .map(([family]) => family)
      expect({ command, owners: owners.length }).toEqual({
        command,
        owners: 1
      })
    }
  })

  it("lists no command the contract does not carry", () => {
    for (const [family, list] of Object.entries(families))
      for (const command of list)
        expect({ family, command, known: commands.includes(command) }).toEqual({
          family,
          command,
          known: true
        })
  })
})
