import { describe, expect, it, vi } from "vitest"

const getDisabledConnectorIds = vi.hoisted(() => vi.fn())
vi.mock("@/lib/repositories/chat-history", () => ({
  getDisabledConnectorIds,
  getSession: vi.fn()
}))
vi.mock("@/lib/tools", () => ({
  getToolRegistry: () => ({
    listDefinitions: async () => [
      { name: "current_tab" },
      { name: "mail_send", connectorId: "c_mail" },
      { name: "notes_append", connectorId: "c_notes" }
    ]
  })
}))

import { getSessionDisabledConnectorIds } from "../handle-chat-with-model"

describe("getSessionDisabledConnectorIds", () => {
  it("reads the chat's stored choice", async () => {
    getDisabledConnectorIds.mockResolvedValueOnce(["c_mail"])
    expect(await getSessionDisabledConnectorIds("s1")).toEqual(["c_mail"])
  })

  it("switches every connector off when the choice cannot be read", async () => {
    getDisabledConnectorIds.mockRejectedValueOnce(new Error("owner gone"))
    expect(await getSessionDisabledConnectorIds("s1")).toEqual([
      "c_mail",
      "c_notes"
    ])
  })
})
