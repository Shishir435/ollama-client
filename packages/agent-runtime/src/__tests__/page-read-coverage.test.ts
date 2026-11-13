import type {
  AgentEvidenceRecord,
  AgentObservation,
  AgentRunState,
  AgentTaskConstraint,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import {
  AgentTaskRequirementSchema,
  MAX_AGENT_REQUIREMENT_ITEMS
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { judgeAgentCompletion } from "../completion"
import {
  agentUnretainedSighting,
  boundAgentEvidence,
  groundAgentQuotes
} from "../evidence-ledger"
import {
  agentAmendedPageReads,
  agentPageItemsCarried,
  agentPlanWithPageLinks,
  agentQuantifiedPageRead
} from "../plan-page-items"
import type { AgentStepReadout } from "../ports"

const origin = "https://sources.test"
const observation = (path = "/index"): AgentObservation => ({
  snapshotId: path,
  generation: 1,
  tabId: 1,
  frameId: 0,
  documentId: path,
  url: origin + path,
  origin,
  title: "Sources",
  capturedAt: 1,
  frames: [
    {
      frameId: 0,
      documentId: path,
      snapshotId: path,
      generation: 1,
      url: origin + path,
      origin,
      access: "ok"
    }
  ],
  visibleText: "",
  dialogs: [],
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  },
  elements: [1, 2].map((i) => ({
    ref: `e${i}`,
    frameId: 0,
    tag: "a",
    role: "link",
    name: `Offer ${i}`,
    href: `${origin}/source/${i}`,
    visible: true,
    enabled: true,
    editable: false,
    sensitive: false
  }))
})
const requested: AgentTaskRequirement = {
  id: "r1",
  kind: "read",
  text: "Read every source link and report its code",
  source: "Read every source link and report its code"
}
const enumerated = () => agentPlanWithPageLinks([requested], observation())![0]
const quote = (i: number) => `Offer ${i} code: CODE-${i}`
const fact = (i: number, path = `/source/${i}`): AgentEvidenceRecord => {
  const seen = { ...observation(path), visibleText: quote(i), elements: [] }
  const state: AgentRunState = {
    version: 1,
    id: "run",
    status: "deciding",
    goal: requested.text,
    stepCount: 0,
    observationCount: 1,
    controlledTabId: 1,
    providerId: "ollama",
    modelId: "model",
    allowedOrigins: [origin],
    createdAt: 0,
    updatedAt: 1,
    requirements: [enumerated()]
  }
  return groundAgentQuotes(
    state,
    seen,
    [{ requirementId: "r1", quote: quote(i) }],
    [],
    `fact-${i}`
  )[0]
}
const judge = (
  requirement = enumerated(),
  records = [fact(1), fact(2)],
  flags = [true, true]
) =>
  judgeAgentCompletion({
    summary: "Read the source codes",
    requirements: [requirement],
    steps: [],
    observation: observation("/source/2"),
    evidenceLedger: records,
    outcomes: [
      {
        id: "r1",
        met: true,
        items: flags.map((met, index) => ({
          index,
          met,
          evidence: quote(index + 1)
        }))
      }
    ]
  })

describe("starting-page source collections", () => {
  it.each([
    "own-receipt",
    "wrong-receipt",
    "outside-collection",
    "wrong-frame"
  ])("keeps source freshness scoped to %s", (variant) => {
    const edited: AgentStepReadout = {
      runId: "run",
      stepId: "edit",
      sequence: 1,
      status: "verified",
      at: 4,
      mutating: true,
      command: {
        type: "clear_and_type",
        ref: "guest",
        text: "Ada",
        snapshotId: "s",
        generation: 1
      },
      sourceUrl: `${origin}/${variant === "outside-collection" ? "edit-record" : "source/2"}`,
      consequential: [],
      verification: {
        outcome: "confirmed",
        evidence: { kind: "field", summary: "Guest holds Ada", observedAt: 4 }
      },
      evidenceLedger: [
        {
          id: variant === "wrong-receipt" ? "other:effect" : "edit:effect",
          kind: "verified_effect",
          validity: "historical",
          observedAt: 4,
          source: {
            tabId: 1,
            frameId: variant === "wrong-frame" ? 7 : 0,
            documentId: "/source/2",
            snapshotId: "s",
            generation: 1,
            origin
          }
        }
      ]
    }
    const result = judgeAgentCompletion({
      steps: [edited],
      startedAt: 0,
      observation: { ...observation("/source/2"), capturedAt: 5 },
      requirements: [{ ...enumerated(), freshness: "current" }],
      evidenceLedger: [
        { ...fact(1), validity: "historical" },
        { ...fact(2), observedAt: 5 }
      ],
      outcomes: [
        {
          id: "r1",
          met: true,
          items: [1, 2].map((i) => ({
            index: i - 1,
            met: true,
            evidence: quote(i)
          }))
        }
      ]
    })
    expect(result.type).toBe(variant === "own-receipt" ? "accepted" : "refused")
  })

  it.each(["two", "2"])(
    "enumerates a stated count of linked candidates: %s",
    (count) => {
      const result = agentPlanWithPageLinks(
        [
          {
            ...requested,
            text: `Compare the ${count} offers linked on this page`
          }
        ],
        observation()
      )![0]
      expect(result).toMatchObject({
        items: ["Offer 1", "Offer 2"],
        pageItemsComplete: true
      })
      expect(judge(result, [fact(1)], [true, true]).type).toBe("refused")
    }
  )
  it.each(["one", "three", "3"])(
    "never certifies two observed candidates as a collection of %s",
    (count) => {
      const result = agentPlanWithPageLinks(
        [
          {
            ...requested,
            text: `Compare the ${count} offers linked on this page`
          }
        ],
        observation()
      )
      if (count === "one") expect(result).toBeUndefined()
      else expect(result?.[0]).toMatchObject({ pageItemsComplete: false })
    }
  )
  it.each(["Read every source link", "Read all linked source pages"])(
    "enumerates %s without crediting a read",
    (text) => {
      const result = agentPlanWithPageLinks(
        [{ ...requested, text }],
        observation()
      )![0]
      expect(result).toMatchObject({
        items: ["Offer 1", "Offer 2"],
        itemLinks: [`${origin}/source/1`, `${origin}/source/2`],
        pageItemsComplete: true
      })
      expect(AgentTaskRequirementSchema.safeParse(result).success).toBe(true)
    }
  )

  it.each([
    "partial",
    "missing-address",
    "offscreen",
    "duplicate",
    "queries",
    "fragments",
    "pagination",
    "oversized"
  ])("does not certify a %s collection", (kind) => {
    const seen = observation()
    if (kind === "partial") seen.elementsPartial = true
    if (kind === "missing-address") seen.elements[1].href = undefined
    if (kind === "offscreen")
      seen.elements[1] = {
        ...seen.elements[1],
        visible: false,
        offscreen: true,
        href: undefined
      }
    if (kind === "duplicate") seen.elements[1].name = "Offer 1"
    if (kind === "queries") seen.elements[1].href += "?page=2"
    if (kind === "fragments") seen.elements[1].href += "#record-2"
    if (kind === "pagination")
      seen.elements.push({
        ...seen.elements[0],
        name: "Next",
        role: "button",
        tag: "button",
        href: undefined
      })
    if (kind === "oversized")
      seen.elements = Array.from(
        { length: MAX_AGENT_REQUIREMENT_ITEMS + 1 },
        (_, i) => ({
          ...seen.elements[0],
          ref: `e${i}`,
          name: `Offer ${i}`,
          href: `${origin}/source/${i}`
        })
      )
    const result = agentPlanWithPageLinks([requested], seen)![0]
    expect(result.pageItemsComplete).toBe(false)
    expect(result.items).toBeUndefined()
    expect(judge(result)).toMatchObject({
      type: "refused",
      reason: "missing_evidence"
    })
  })

  it("keeps incomplete and complete enumeration across amendments and serialization", () => {
    for (const original of [
      enumerated(),
      { ...requested, pageItemsComplete: false }
    ]) {
      const {
        pageItemsComplete: _,
        itemsFrom: _from,
        itemLinks: _links,
        ...rest
      } = original
      const carried = agentPageItemsCarried([original], [rest])[0]
      expect(
        AgentTaskRequirementSchema.parse(JSON.parse(JSON.stringify(carried)))
      ).toEqual(original)
    }
  })

  it.each([
    "Read all pages linked here",
    "Read every page linked on this page"
  ])("enumerates pages linked after the quantified noun: %s", (text) => {
    expect(agentQuantifiedPageRead({ ...requested, text })).toBe(true)
    expect(
      agentPlanWithPageLinks([{ ...requested, text }], observation())![0]
    ).toMatchObject({
      items: ["Offer 1", "Offer 2"],
      pageItemsComplete: true
    })
  })

  it("keeps a source owed when the user only forbade buying it", () => {
    const constraint = (
      text: string,
      forbids?: ["payment"]
    ): AgentTaskConstraint => ({
      id: "c1",
      kind: "exclude",
      text,
      ...(forbids ? { forbids } : {})
    })
    for (const bought of [
      constraint("Do not buy Offer 2"),
      constraint("Do not buy Offer 2", ["payment"])
    ])
      expect(
        agentPlanWithPageLinks([requested], observation(), [bought])![0]
      ).toMatchObject({
        items: ["Offer 1", "Offer 2"],
        pageItemsComplete: true
      })
    for (const skipped of [
      constraint("Skip Offer 2"),
      constraint("Do not read Offer 2")
    ])
      expect(
        agentPlanWithPageLinks([requested], observation(), [skipped])![0]
      ).toMatchObject({ items: ["Offer 1"], pageItemsComplete: true })
  })

  it("does not carry completeness onto reworded criteria", () => {
    const original = enumerated()
    const {
      pageItemsComplete: _,
      itemsFrom: _from,
      itemLinks: _links,
      ...rest
    } = original
    const reworded = agentPageItemsCarried(
      [original],
      [{ ...rest, text: "Read every eligible source link and report its code" }]
    )[0]
    expect(reworded).toMatchObject({
      items: original.items,
      itemLinks: original.itemLinks,
      itemsFrom: "page",
      pageItemsComplete: false
    })
    expect(judge(reworded)).toMatchObject({
      type: "refused",
      reason: "missing_evidence"
    })
  })

  it("resolves a quantified read added by amendment as of unknown coverage", () => {
    const fill: AgentTaskRequirement = {
      id: "r1",
      kind: "change",
      text: "Fill the form"
    }
    const added = agentPageItemsCarried(
      [fill],
      [
        fill,
        {
          ...requested,
          id: "r2",
          text: "Read every source link here",
          since: 2
        }
      ]
    )
    expect(added[0]).toEqual(fill)
    expect(added[1]).toMatchObject({ pageItemsComplete: false })
    // The same read restated unchanged keeps whatever the plan already had.
    expect(agentPageItemsCarried([requested], [requested])[0]).toEqual(
      requested
    )
  })

  it("completes an amended read enumerated from the page the user's answer points at", () => {
    const fill: AgentTaskRequirement = {
      id: "r0",
      kind: "change",
      text: "Fill the form"
    }
    const answer = "Also read every source link here and report its code"
    const added: AgentTaskRequirement = {
      ...requested,
      text: "Read every source link here and report its code",
      source: answer,
      since: 2
    }
    const carried = agentPageItemsCarried([fill], [fill, added])
    const answers = [{ text: answer, answeredAt: 5 }]
    const looked: AgentStepReadout = {
      runId: "run",
      stepId: "look",
      sequence: 1,
      status: "verified",
      at: 6,
      command: { type: "extract_text", snapshotId: "s", generation: 1 }
    }
    const ids = agentAmendedPageReads([fill], carried, answers, [looked])
    expect([...ids]).toEqual(["r1"])
    for (const pointer of [
      "Also read every source link here before editing the form",
      "Also read every source link on this page before editing the form"
    ])
      expect([
        ...agentAmendedPageReads(
          [fill],
          agentPageItemsCarried([fill], [fill, { ...added, source: pointer }]),
          [{ text: pointer, answeredAt: 5 }],
          [looked]
        )
      ]).toEqual(["r1"])
    const plan = agentPlanWithPageLinks(carried, observation(), [], ids, false)!
    // The original entries are not re-bound from a later page.
    expect(plan[0]).toEqual(fill)
    expect(judge(plan[1])).toMatchObject({
      type: "accepted",
      outcome: { met: ["r1"] }
    })
    // Not enumerated: every source quoted still cannot prove the collection.
    expect(judge(carried[1])).toMatchObject({
      type: "refused",
      reason: "missing_evidence"
    })
    // A step that may have left the page after the answer, missing receipts,
    // or words pointing at no page enumerate nothing.
    const clicked: AgentStepReadout = {
      ...looked,
      stepId: "click",
      command: { type: "click", ref: "e1", snapshotId: "s", generation: 1 }
    }
    expect(
      agentAmendedPageReads([fill], carried, answers, [clicked]).size
    ).toBe(0)
    expect(
      agentAmendedPageReads([fill], carried, answers, undefined).size
    ).toBe(0)
    const nowhere = agentPageItemsCarried(
      [fill],
      [fill, { ...added, source: "Also read every source link" }]
    )
    expect(
      agentAmendedPageReads(
        [fill],
        nowhere,
        [{ text: "Also read every source link", answeredAt: 5 }],
        []
      ).size
    ).toBe(0)
    // Nor words that may name a page the run has since left.
    for (const pointer of [
      "Also read every source link on the page I sent earlier",
      "Also read every source link on the page",
      "Also read every source link here, on the previous page",
      "Also read every source link here, on the page I shared before",
      "Also read every source link on this site, on the page you linked before",
      "Also read every source link here, on the page before this one"
    ]) {
      const elsewhere = agentPageItemsCarried(
        [fill],
        [fill, { ...added, source: pointer }]
      )
      expect(
        agentAmendedPageReads(
          [fill],
          elsewhere,
          [{ text: pointer, answeredAt: 5 }],
          [looked]
        ).size,
        pointer
      ).toBe(0)
    }
    // Nor is an amended read bound when the plan says nothing points here.
    expect(
      agentPlanWithPageLinks(carried, observation(), [], new Set(), false)
    ).toBeUndefined()
  })

  it("does not mistake every application page for a known linked-source set", () => {
    expect(
      agentPlanWithPageLinks(
        [{ ...requested, text: "Review every application page" }],
        observation()
      )
    ).toBeUndefined()
  })

  it("rejects completeness without distinct source identities", () => {
    const complete = enumerated()
    for (const itemLinks of [
      undefined,
      [complete.itemLinks![0]],
      [complete.itemLinks![0], complete.itemLinks![0]]
    ]) {
      expect(
        AgentTaskRequirementSchema.safeParse({ ...complete, itemLinks }).success
      ).toBe(false)
    }
  })
})

describe("source coverage is evidence, not visits", () => {
  it("does not confuse a directory's source names with a source being left unread", () => {
    const state = { requirements: [enumerated()] }
    const decision = {
      type: "command" as const,
      command: { type: "back" as const, snapshotId: "snapshot", generation: 1 }
    }
    expect(
      agentUnretainedSighting(
        state,
        { ...observation(), visibleText: "Offer 1 Offer 2" },
        decision
      )
    ).toBeUndefined()
    expect(
      agentUnretainedSighting(state, observation("/source/1"), decision)
    ).toEqual({ requirementId: "r1", item: "Offer 1" })
  })
  it("accepts a grounded quotation from each enumerated source", () => {
    expect(fact(1).sourcePage).toBe(`${origin}/source/1`)
    expect(judge().type).toBe("accepted")
  })

  it("retains separate source and requirement bindings when quotes repeat", () => {
    const first = fact(1)
    const second = {
      ...first,
      id: "other-source",
      sourcePage: `${origin}/source/2`
    }
    const otherRequirement = {
      ...first,
      id: "other-requirement",
      requirementId: "r2"
    }
    expect(boundAgentEvidence([first, second, otherRequirement])).toEqual([
      first,
      second,
      otherRequirement
    ])
  })

  it("refuses a source fact bound to another requirement", () => {
    expect(
      judge(enumerated(), [fact(1), { ...fact(2), requirementId: "r2" }])
    ).toMatchObject({ type: "refused", reason: "missing_evidence" })
  })

  it("refuses missing retained source evidence", () => {
    expect(judge(enumerated(), [])).toMatchObject({
      type: "refused",
      reason: "missing_evidence"
    })
  })

  it("refuses the second source's quote copied from the first page", () => {
    expect(judge(enumerated(), [fact(1), fact(2, "/source/1")])).toMatchObject({
      type: "refused",
      reason: "missing_evidence"
    })
  })

  it.each(["?record=other", "#record-other"])(
    "cannot credit a source with identity suffix %s by its plain path",
    (suffix) => {
      expect(fact(2, `/source/2${suffix}`).sourcePage).toBeUndefined()
      expect(
        judge(enumerated(), [fact(1), fact(2, `/source/2${suffix}`)])
      ).toMatchObject({ type: "refused", reason: "missing_evidence" })
    }
  )

  it("accepts an honestly unmet collection instead of requiring fabricated evidence", () => {
    expect(judge(enumerated(), [fact(1)], [true, false])).toMatchObject({
      type: "unmet",
      outcome: { unmet: ["r1"] }
    })
  })

  it.each(["requires_refresh", "incomplete", "superseded"] as const)(
    "refuses %s facts",
    (validity) => {
      expect(
        judge(enumerated(), [fact(1), { ...fact(2), validity }])
      ).toMatchObject({ type: "refused", reason: "missing_evidence" })
    }
  )

  it("does not certify a legacy or bypassed enumeration", () => {
    expect(judge(requested)).toMatchObject({
      type: "refused",
      reason: "missing_evidence"
    })
  })
})
