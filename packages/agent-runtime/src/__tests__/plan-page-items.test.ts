import type {
  AgentElement,
  AgentEvidenceRecord,
  AgentObservation,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import {
  AgentEvidenceRecordSchema,
  AgentTaskRequirementSchema,
  MAX_AGENT_REQUIREMENT_ITEMS
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { boundAgentEvidence } from "../evidence-ledger"
import {
  agentPageItemsCarried,
  agentPlanWithPageLinks,
  agentTabOpensPageItem
} from "../plan-page-items"

const PAGE = "https://shop.test/compare"

const link = (
  ref: string,
  name: string,
  href: string,
  overrides: Partial<AgentElement> = {}
): AgentElement => ({
  ref,
  frameId: 0,
  role: "link",
  name,
  tag: "a",
  href,
  visible: true,
  enabled: true,
  editable: false,
  sensitive: false,
  ...overrides
})

const page = (elements: AgentElement[]): AgentObservation => ({
  snapshotId: "s1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "d1",
  url: PAGE,
  origin: "https://shop.test",
  title: "Compare",
  frames: [
    {
      frameId: 0,
      documentId: "d1",
      origin: "https://shop.test",
      url: PAGE,
      access: "ok",
      snapshotId: "s1",
      generation: 1
    }
  ],
  elements,
  visibleText: "",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  },
  dialogs: [],
  capturedAt: 1
})

const openEvery: AgentTaskRequirement = {
  id: "r1",
  text: "Open every source link in a separate tab.",
  kind: "change",
  source: "open every source link in a separate tab",
  origin: "user"
}

const sources = page([
  link("e1", "Offer 1", "https://shop.test/a/source/1"),
  link("e2", "Offer 2", "https://shop.test/a/source/2"),
  link("e3", "Help", "https://shop.test/help"),
  link("e4", "Top", `${PAGE}#top`),
  link("e5", "Compare", PAGE)
])

describe("agentPlanWithPageLinks", () => {
  it("names the qualified links the starting page shows", () => {
    const planned = agentPlanWithPageLinks([openEvery], sources)
    expect(planned).toEqual([
      {
        ...openEvery,
        items: ["Offer 1", "Offer 2"],
        itemLinks: [
          "https://shop.test/a/source/1",
          "https://shop.test/a/source/2"
        ],
        itemsFrom: "page"
      }
    ])
    expect(AgentTaskRequirementSchema.safeParse(planned?.[0]).success).toBe(
      true
    )
  })

  it("keeps every link, minus the page itself and its fragments, with no qualifier", () => {
    const planned = agentPlanWithPageLinks(
      [{ ...openEvery, text: "Open all the links in new tabs." }],
      sources
    )
    expect(planned?.[0].items).toEqual(["Offer 1", "Offer 2", "Help"])
  })

  it("filters by a qualifier the link's name carries", () => {
    const planned = agentPlanWithPageLinks(
      [{ ...openEvery, text: "Read each review link." }],
      page([
        link("e1", "Reviews for Kettle", "https://shop.test/p/1"),
        link("e2", "Kettle specs", "https://shop.test/p/2")
      ])
    )
    expect(planned?.[0].items).toEqual(["Reviews for Kettle"])
  })

  it("reads the quantifier off the user's quoted words when the text drops it", () => {
    const planned = agentPlanWithPageLinks(
      [{ ...openEvery, text: "Open the sources in tabs." }],
      sources
    )
    expect(planned?.[0].items).toEqual(["Offer 1", "Offer 2"])
  })

  it("binds nothing when link names repeat", () => {
    expect(
      agentPlanWithPageLinks(
        [{ ...openEvery, text: "Open every link." }],
        page([
          link("e1", "Read more", "https://shop.test/post/1"),
          link("e2", "Read more", "https://shop.test/post/2")
        ])
      )
    ).toBeUndefined()
  })

  it("binds nothing when no link carries the qualifier", () => {
    expect(
      agentPlanWithPageLinks(
        [{ ...openEvery, text: "Open every invoice link." }],
        sources
      )
    ).toBeUndefined()
  })

  it("binds nothing past the item cap", () => {
    const many = page(
      Array.from({ length: MAX_AGENT_REQUIREMENT_ITEMS + 1 }, (_, index) =>
        link(`e${index}`, `Source ${index}`, `https://shop.test/s/${index}`)
      )
    )
    expect(agentPlanWithPageLinks([openEvery], many)).toBeUndefined()
  })

  it("never widens scope: planned items, later entries and other words stay", () => {
    const planned: AgentTaskRequirement = {
      ...openEvery,
      items: ["Offer 1"]
    }
    const later: AgentTaskRequirement = { ...openEvery, id: "r2", since: 2 }
    const unquantified: AgentTaskRequirement = {
      ...openEvery,
      id: "r3",
      text: "Open the source link for Offer 1.",
      source: "open the source link for Offer 1"
    }
    expect(
      agentPlanWithPageLinks([planned, later, unquantified], sources)
    ).toBeUndefined()
  })

  it("leaves out links a constraint excludes, hidden links and child frames", () => {
    const observation = page([
      link("e1", "Offer 1", "https://shop.test/a/source/1"),
      link("e2", "Archive source", "https://shop.test/a/source/archive"),
      link("e3", "Ad source", "https://ads.test/source", { frameId: 4 }),
      link("e4", "Sensitive source", "https://shop.test/source/s", {
        sensitive: true
      })
    ])
    const planned = agentPlanWithPageLinks([openEvery], observation, [
      { id: "c1", text: "Exclude Archive source", kind: "exclude" }
    ])
    expect(planned?.[0].items).toEqual(["Offer 1"])
  })

  it("keeps names alone when links differ only by query", () => {
    const planned = agentPlanWithPageLinks(
      [openEvery],
      page([
        link("e1", "Source A", "https://shop.test/source?id=1"),
        link("e2", "Source B", "https://shop.test/source?id=2")
      ])
    )
    expect(planned?.[0]).toMatchObject({
      items: ["Source A", "Source B"],
      itemsFrom: "page"
    })
    expect(planned?.[0].itemLinks).toBeUndefined()
  })
})

describe("agentPageItemsCarried", () => {
  const paged: AgentTaskRequirement = {
    ...openEvery,
    items: ["Offer 1", "Offer 2"],
    itemLinks: ["https://shop.test/a/source/1", "https://shop.test/a/source/2"],
    itemsFrom: "page"
  }

  it("keeps provenance on an amended entry whose items are unchanged", () => {
    const restated = { ...openEvery, items: ["Offer 1", "Offer 2"] }
    expect(agentPageItemsCarried([paged], [restated])).toEqual([paged])
  })

  it("drops it once the items changed", () => {
    const widened = { ...openEvery, items: ["Offer 1", "Offer 2", "Offer 3"] }
    expect(agentPageItemsCarried([paged], [widened])).toEqual([widened])
  })
})

describe("page item provenance in contracts", () => {
  it("refuses links that are not one per page item", () => {
    expect(
      AgentTaskRequirementSchema.safeParse({
        ...openEvery,
        items: ["Offer 1"],
        itemLinks: ["https://shop.test/a/source/1"]
      }).success
    ).toBe(false)
    expect(
      AgentTaskRequirementSchema.safeParse({
        ...openEvery,
        items: ["Offer 1", "Offer 2"],
        itemsFrom: "page",
        itemLinks: ["https://shop.test/a/source/1"]
      }).success
    ).toBe(false)
  })
})

describe("tab receipts", () => {
  const tab = (
    id: string,
    overrides: Partial<AgentEvidenceRecord> = {}
  ): AgentEvidenceRecord => ({
    id,
    kind: "verified_effect",
    validity: "historical",
    source: {
      tabId: 7,
      frameId: 0,
      documentId: "d".repeat(36),
      snapshotId: "s".repeat(36),
      generation: 1,
      origin: "https://shop.test"
    },
    observedAt: 1,
    verificationKind: "tab",
    ...overrides
  })

  it("match a page item by destination", () => {
    const paged: AgentTaskRequirement = {
      ...openEvery,
      items: ["Offer 1", "Offer 2"],
      itemLinks: [
        "https://shop.test/a/source/1",
        "https://shop.test/a/source/2"
      ],
      itemsFrom: "page"
    }
    const opened = tab("run:1:effect", {
      requirementId: "r1",
      destination: "https://shop.test/a/source/2"
    })
    expect(AgentEvidenceRecordSchema.safeParse(opened).success).toBe(true)
    expect(agentTabOpensPageItem(opened, paged, 1)).toBe(true)
    expect(agentTabOpensPageItem(opened, paged, 0)).toBe(false)
  })

  it("keep an outcome's receipt over unbound switches when the ledger is full", () => {
    const open = tab("run:1:effect", {
      requirementId: "r1",
      destination: "https://shop.test/a/source/1"
    })
    const switches = Array.from({ length: 30 }, (_, index) =>
      tab(`run:${index + 2}:effect`)
    )
    const kept = boundAgentEvidence([open, ...switches])
    expect(kept.map((record) => record.id)).toContain("run:1:effect")
  })
})
