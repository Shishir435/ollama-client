import { describe, expect, it, vi } from "vitest"
import { createAgentChatConsent, mergeAgentGrants } from "../agent-chat-consent"

const area = () => {
  const items = new Map<string, unknown>()
  return {
    get: vi.fn(async (key: string) =>
      items.has(key) ? { [key]: items.get(key) } : {}
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) items.set(key, value)
    })
  }
}

describe("routine consent a chat carries", () => {
  it("keeps clicks, typing and searches, never a widened submission", async () => {
    const consent = createAgentChatConsent(area())
    await consent.remember("chat", [
      {
        origin: "https://a.example",
        effects: ["submission"],
        grantedAt: 1
      },
      {
        origin: "https://b.example",
        effects: ["activation", "submission"],
        grantedAt: 2,
        searches: true
      }
    ])
    expect(await consent.read("chat")).toEqual([
      {
        origin: "https://b.example",
        effects: ["activation"],
        grantedAt: 2,
        searches: true
      }
    ])
    expect(await consent.read("other")).toEqual([])
  })

  it("survives a fresh worker reading the same session store", async () => {
    const store = area()
    await createAgentChatConsent(store).remember("chat", [
      { origin: "https://a.example", effects: ["activation"], grantedAt: 1 }
    ])
    expect(await createAgentChatConsent(store).read("chat")).toHaveLength(1)
  })

  it("forgets one chat or all of them", async () => {
    const consent = createAgentChatConsent(area())
    const grant = {
      origin: "https://a.example",
      effects: ["activation" as const],
      grantedAt: 1
    }
    await consent.remember("one", [grant])
    await consent.remember("two", [grant])
    await consent.forget("one")
    expect(await consent.read("one")).toEqual([])
    expect(await consent.read("two")).toHaveLength(1)
    await consent.forget()
    expect(await consent.read("two")).toEqual([])
  })

  it("joins grants for one site and keeps search consent", () => {
    expect(
      mergeAgentGrants(
        [
          { origin: "https://a.example", effects: ["activation"], grantedAt: 1 }
        ],
        [
          {
            origin: "https://a.example",
            effects: ["form_mutation"],
            grantedAt: 3,
            searches: true
          }
        ]
      )
    ).toEqual([
      {
        origin: "https://a.example",
        effects: ["activation", "form_mutation"],
        grantedAt: 3,
        searches: true
      }
    ])
  })
})
