import { describe, expect, it } from "vitest"

import { MESSAGE_KEYS } from "@/lib/constants"
import {
  isRuntimeTransportAllowed,
  RUNTIME_TRANSPORT_DEFINITIONS
} from "../runtime-transport-registry"

const flattenLeaves = (value: unknown): string[] => {
  if (typeof value === "string") return [value]
  if (!value || typeof value !== "object") return []
  return Object.values(value).flatMap(flattenLeaves)
}

describe("runtime transport registry", () => {
  it("classifies every retained runtime message key", () => {
    const registered = new Set<string>(
      RUNTIME_TRANSPORT_DEFINITIONS.map((definition) => definition.type)
    )
    const missing = flattenLeaves(MESSAGE_KEYS).filter(
      (key) => !registered.has(key)
    )

    expect(missing).toEqual([])
  })

  it("has no duplicate transport definitions", () => {
    const identities = RUNTIME_TRANSPORT_DEFINITIONS.map(
      (definition) => `${definition.transport}:${definition.type}`
    )
    const duplicates = identities.filter(
      (identity, index) => identities.indexOf(identity) !== index
    )

    expect(duplicates).toEqual([])
  })

  it("keeps content scripts on the narrow selection/model-read surface", () => {
    const contentDefinitions = RUNTIME_TRANSPORT_DEFINITIONS.filter(
      (definition) =>
        definition.allowedSources.some((source) => source === "content-script")
    )
    const identities = contentDefinitions.map(
      (definition) => `${definition.transport}:${definition.type}`
    )

    expect(identities).toEqual([
      `message:${MESSAGE_KEYS.PROVIDER.GET_MODELS}`,
      `port:${MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION}`,
      `port-message:${MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION}`,
      `port-message:${MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION}`,
      `message:${MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT}`,
      `message:${MESSAGE_KEYS.BROWSER.LOAD_SELECTION_OVERLAY}`
    ])
  })

  it("denies unregistered content-script traffic", () => {
    expect(
      isRuntimeTransportAllowed(
        "message",
        MESSAGE_KEYS.APP.FLUSH_SQLITE,
        "content-script"
      )
    ).toBe(false)
    expect(
      isRuntimeTransportAllowed("message", "unknown-message", "content-script")
    ).toBe(false)
  })
})
