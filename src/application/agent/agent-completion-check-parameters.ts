import { MAX_AGENT_TEXT_CHARS } from "@ollama-client/contracts"

const name = { type: "string", minLength: 1, maxLength: 500 }
const control = {
  name,
  frameId: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  record: name
}

const predicate = (
  type: string,
  properties: Record<string, unknown>,
  required: string[]
) => ({
  type: "object",
  properties: { type: { type: "string", const: type }, ...properties },
  required: ["type", ...required],
  additionalProperties: false
})

/** Matches the Zod contract in tests without shipping its JSON-schema converter. */
export const AGENT_COMPLETION_CHECK_PARAMETERS = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  oneOf: [
    predicate(
      "field",
      {
        ...control,
        value: { type: "string", maxLength: MAX_AGENT_TEXT_CHARS }
      },
      ["name", "value"]
    ),
    predicate("checked", { ...control, checked: { type: "boolean" } }, [
      "name",
      "checked"
    ]),
    predicate(
      "selected",
      { ...control, value: { type: "string", maxLength: 2_000 } },
      ["name", "value"]
    ),
    predicate(
      "url",
      { url: { type: "string", maxLength: 2_048, format: "uri" } },
      ["url"]
    ),
    predicate("row", { record: name }, ["record"]),
    predicate(
      "record_state",
      { record: name, state: { type: "string", enum: ["saved", "submitted"] } },
      ["record", "state"]
    )
  ]
}
