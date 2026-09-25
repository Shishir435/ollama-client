import {
  AUDIT_CONTACT,
  AUDIT_FILES,
  AUDIT_ITEM,
  AUDIT_SEARCH_RESULTS,
  AUDIT_SHOP
} from "../../fixtures/agent-audit-pages"
import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

runAgentScenario({
  name: "audit-search-and-open",
  hosted: true,
  goal: "Search for atlas and open the Atlas notebook result.",
  status: "completed",
  plan: [{ text: "open the Atlas notebook result", kind: "read" }],
  html: (path) =>
    path.startsWith("/item/")
      ? AUDIT_ITEM
      : path.startsWith("/search")
        ? AUDIT_SEARCH_RESULTS
        : AUDIT_SHOP,
  decide(observation) {
    if (observation.url.includes("/item/"))
      return { type: "complete", summary: "Opened Atlas notebook." }
    if (observation.url.includes("/search")) {
      if (new URL(observation.url).searchParams.get("q") !== "atlas") {
        throw new Error("The shop did not search for atlas")
      }
      return {
        type: "click",
        requirementId: "r1",
        ref: agentFixtureElement(
          observation,
          (element) => element.name === "Atlas notebook"
        )?.ref
      }
    }
    const search = agentFixtureElement(
      observation,
      (element) => element.name === "Search products"
    )
    if (search?.value !== "atlas")
      return {
        type: "clear_and_type",
        ref: search?.ref,
        text: "atlas",
        requirementId: "r1"
      }
    return {
      type: "click",
      requirementId: "r1",
      ref: agentFixtureElement(
        observation,
        (element) => element.name === "Search"
      )?.ref
    }
  },
  async verify({ page }) {
    await expect(
      page.getByRole("heading", { name: "Atlas notebook" })
    ).toBeVisible()
  }
})

runAgentScenario({
  name: "audit-fill-without-submit",
  hosted: true,
  goal: "Fill Name with Ada, Email with ada@example.com and Message with Hello. Do not submit the form.",
  status: "completed",
  plan: [
    { text: "Name is Ada", kind: "change" },
    { text: "Email is ada@example.com", kind: "change" },
    { text: "Message is Hello", kind: "change" },
    { text: "do not submit the form", kind: "change" }
  ],
  html: () => AUDIT_CONTACT,
  decide(observation) {
    const named = (name: string) =>
      agentFixtureElement(observation, (element) => element.name === name)
    if (
      named("Name")?.value === "Ada" &&
      named("Email")?.value === "ada@example.com" &&
      named("Message")?.value === "Hello"
    )
      return {
        type: "complete",
        summary: "Filled the contact form without submitting it.",
        outcomes: [
          { id: "r1", met: true },
          { id: "r2", met: true },
          { id: "r3", met: true },
          { id: "r4", met: true }
        ]
      }
    return {
      type: "fill_form",
      requirementId: "r1",
      fields: [
        { type: "clear_and_type", ref: named("Name")?.ref, text: "Ada" },
        {
          type: "clear_and_type",
          ref: named("Email")?.ref,
          text: "ada@example.com"
        },
        { type: "clear_and_type", ref: named("Message")?.ref, text: "Hello" }
      ]
    }
  },
  async verify({ page }) {
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Ada")
    await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue(
      "ada@example.com"
    )
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Hello"
    )
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __submitted?: number }).__submitted ?? 0
      )
    ).toBe(0)
  }
})

runAgentScenario({
  name: "audit-delete-one-file",
  hosted: true,
  goal: "Delete old-report-2023.pdf and keep the other files.",
  status: "completed",
  html: () => AUDIT_FILES,
  decide(observation) {
    const dialog = observation.dialogs?.[0]
    if (dialog)
      return { type: "handle_dialog", dialogId: dialog.id, accept: true }
    if (!observation.text.includes("old-report-2023.pdf"))
      return {
        type: "complete",
        summary: "Deleted old-report-2023.pdf.",
        evidence: "File deleted"
      }
    const deleteButton = observation.elements.filter(
      (element) => element.name === "Delete"
    )[2]
    return { type: "click", ref: deleteButton?.ref }
  },
  async verify({ page, messages }) {
    await expect(page.locator("#files")).not.toContainText(
      "old-report-2023.pdf"
    )
    await expect(page.locator("#files li")).toHaveCount(4)
    const clickApprovalIds = messages.flatMap((message) =>
      message.type === "agent_snapshot" &&
      message.snapshot.pending?.kind === "approval" &&
      message.snapshot.pending.request.action.includes("click")
        ? [message.snapshot.pending.request.id]
        : []
    )
    expect(new Set(clickApprovalIds).size).toBe(1)
    const deleteApproval = messages.find(
      (message) =>
        message.type === "agent_snapshot" &&
        message.snapshot.pending?.kind === "approval" &&
        message.snapshot.pending.request.action.includes("click")
    )
    expect(
      deleteApproval?.type === "agent_snapshot" &&
        deleteApproval.snapshot.pending?.kind === "approval"
        ? deleteApproval.snapshot.pending.request.pageEvidence
        : undefined
    ).toBe("Delete — old-report-2023.pdf")
  }
})
