import { AgentFormFieldSchema } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { AGENT_DECISION_TOOL } from "../agent-model-port"

/**
 * The model is shown the batch field types in the tool schema, and the
 * contract accepts them in `AgentFormFieldSchema`. They were two hand-written
 * lists, and a type added to one and not the other is either a variant no
 * model is ever offered or one the parser refuses after the model chose it.
 */
describe("the decision tool's batch fields", () => {
  it("offer exactly the field types the contract accepts", () => {
    const parameters = AGENT_DECISION_TOOL.parameters as unknown as {
      properties: {
        fields: { items: { properties: { type: { enum: string[] } } } }
      }
    }
    const offered = parameters.properties.fields.items.properties.type.enum
    const accepted = AgentFormFieldSchema.options.map(
      (option) => option.shape.type.value as string
    )
    expect([...offered].sort()).toEqual([...accepted].sort())
  })
})
