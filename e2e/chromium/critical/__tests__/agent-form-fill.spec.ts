import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentFixtureElement,
  observations,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * A form filled from one decision, in a real browser.
 *
 * The measurement that ranks this: one decision took 44 seconds against a 42ms
 * observation, so six fields were six round trips and almost no browser work.
 * What has to hold is that the saving is real — one decision, six values — and
 * that nothing about the per-field checks was given up to get it.
 *
 * The rule that makes a single approval honest is here too: the batch cannot
 * click, so the submit is its own step with its own prompt.
 */
const PROFILE_PAGE = `<!doctype html>
<title>Profile</title>
<main>
  <form id="profile" onsubmit="event.preventDefault(); document.getElementById('status').textContent = 'Profile saved'">
    <input id="given" name="given" aria-label="Given name" />
    <input id="family" name="family" aria-label="Family name" />
    <input id="city" name="city" aria-label="City" />
    <input id="postcode" name="postcode" aria-label="Postcode" />
    <select id="country" name="country" aria-label="Country">
      <option value="">Choose</option>
      <option value="gb">United Kingdom</option>
      <option value="ie">Ireland</option>
    </select>
    <input id="news" name="news" type="checkbox" aria-label="Send me news" />
    <button type="submit">Save profile</button>
  </form>
  <p id="status" role="status">Nothing saved</p>
</main>`

const FIELDS = [
  { label: "Given name", value: "Ada" },
  { label: "Family name", value: "Lovelace" },
  { label: "City", value: "London" },
  { label: "Postcode", value: "NW1 4RY" }
] as const

runAgentScenario({
  name: "fill-form-in-one-decision",
  goal: "Fill Given name with Ada, Family name with Lovelace, City with London, Postcode with NW1 4RY, select gb in Country, check Send me news and save the profile.",
  status: "completed",
  timeoutMs: 120_000,
  html: () => PROFILE_PAGE,
  allowRoutineActions: true,
  approvalScope: "run_origin",
  plan: [
    ...FIELDS.map(({ label, value }) => ({
      text: `${label} holds ${value}`,
      kind: "change" as const,
      check: { type: "field" as const, name: label, value }
    })),
    {
      text: "Country selected gb",
      kind: "change",
      check: { type: "selected", name: "Country", value: "gb" }
    },
    {
      text: "Send me news is checked",
      kind: "change",
      check: { type: "checked", name: "Send me news", checked: true }
    },
    {
      text: "the profile is saved",
      kind: "change",
      check: { type: "record_state", record: "Profile", state: "saved" }
    }
  ],
  /**
   * Branching on the page rather than on a decision counter: a refusal or a
   * settle poll shifts the counter, and the scenario then answers the wrong
   * question at the wrong moment.
   */
  decide: (observation: AgentFixtureObservation) => {
    const page = `${observation.text} ${observation.documentText ?? ""}`
    if (page.includes("Profile saved")) {
      return {
        type: "complete",
        summary: "Filled the profile and saved it.",
        outcomes: [
          ...Array.from({ length: 6 }, (_, index) => ({
            id: `r${index + 1}`,
            met: true
          })),
          { id: "r7", met: true, evidence: "Profile saved" }
        ]
      }
    }
    const named = (label: string) =>
      agentFixtureElement(observation, (element) => element.name === label)
    const given = named("Given name")
    if (given && given.value !== "Ada") {
      const country = named("Country")
      const news = named("Send me news")
      return {
        type: "fill_form",
        requirementId: "r1",
        fields: [
          ...FIELDS.map((field) => ({
            type: "clear_and_type" as const,
            ref: named(field.label)?.ref ?? "",
            text: field.value
          })),
          ...(country
            ? [{ type: "select" as const, ref: country.ref, value: "gb" }]
            : []),
          ...(news ? [{ type: "check" as const, ref: news.ref }] : [])
        ]
      }
    }
    const save = named("Save profile")
    return save
      ? { type: "click", ref: save.ref, requirementId: "r7" }
      : { type: "read" }
  },
  verify: async ({ page, snapshot, wire }) => {
    /** Every value landed, from one decision. */
    for (const field of FIELDS) {
      await expect(
        page.locator(`#profile [aria-label="${field.label}"]`)
      ).toHaveValue(field.value)
    }
    await expect(page.locator("#country")).toHaveValue("gb")
    await expect(page.locator("#news")).toBeChecked()
    await expect(page.locator("#status")).toHaveText("Profile saved")
    expect(snapshot?.run?.status).toBe("completed")

    /**
     * The saving, stated as the thing it is: six values cost one round trip
     * rather than six. Two decisions carry the whole task — the batch and the
     * submit — plus the one that completes it.
     */
    const decisions = wire.filter((entry) => entry.decision !== undefined)
    expect(decisions.length).toBeLessThanOrEqual(4)

    /**
     * The batch never submits. The form's own submit is a separate step, so
     * the approval the user saw for the fill was not an approval for sending
     * the payload.
     */
    const saved = observations(wire).findIndex((entry) =>
      `${entry.text} ${entry.documentText ?? ""}`.includes("Profile saved")
    )
    const filled = observations(wire).findIndex((entry) =>
      entry.elements.some((element) => element.value === "Ada")
    )
    expect(filled).toBeGreaterThanOrEqual(0)
    expect(saved).toBeGreaterThan(filled)
  }
})

/**
 * A batch naming a control the page will not accept is refused before
 * anything is attempted, and the refusal names the field.
 *
 * Refused rather than partially applied, and that is the whole point of
 * checking the batch up front: nothing has happened, so the run records a
 * rejected step and looks again — exactly as a single refused edit does. The
 * per-field refusal reaches the model with an index, so the next attempt can
 * drop that one field instead of guessing which of twelve was wrong.
 */
runAgentScenario({
  name: "fill-form-partial-recovers",
  goal: "Fill in the profile form with the given name Ada.",
  status: "completed",
  timeoutMs: 120_000,
  allowRoutineActions: true,
  approvalScope: "run_origin",
  html: () => `<!doctype html>
<title>Profile</title>
<main>
  <form id="profile">
    <input id="given" name="given" aria-label="Given name" />
    <input id="family" name="family" aria-label="Family name" disabled />
  </form>
  <p id="status" role="status">Nothing saved</p>
</main>
<script>
  /** Counts every value ever written, so a repeat is visible. */
  window.__writes = []
  for (const field of document.querySelectorAll("input")) {
    field.addEventListener("input", () =>
      window.__writes.push(field.id + "=" + field.value)
    )
  }
</script>`,
  plan: [{ text: "the given name is Ada", kind: "change" }],
  decide: (observation: AgentFixtureObservation, context) => {
    const given = agentFixtureElement(
      observation,
      (element) => element.name === "Given name"
    )
    if (given?.value === "Ada") {
      return {
        type: "complete",
        summary: "Filled what the form accepts.",
        outcomes: [{ id: "r1", met: true, evidence: "Ada" }]
      }
    }
    const family = agentFixtureElement(
      observation,
      (element) => element.name === "Family name"
    )
    /**
     * The first attempt names the disabled control too. Every field is
     * checked as the lone command it mirrors, so the batch is refused whole —
     * and the second attempt, told which field, sends the rest.
     */
    const withFamily = context.step === 1 && family
    return {
      type: "fill_form",
      requirementId: "r1",
      fields: [
        { type: "clear_and_type", ref: given?.ref ?? "", text: "Ada" },
        ...(withFamily
          ? [
              {
                type: "clear_and_type" as const,
                ref: family.ref,
                text: "Lovelace"
              }
            ]
          : [])
      ]
    }
  },
  verify: async ({ page, snapshot }) => {
    await expect(page.locator("#given")).toHaveValue("Ada")
    await expect(page.locator("#family")).toHaveValue("")
    /**
     * Written once. The refused batch touched nothing, so the retry that
     * followed it was not a second write of a value already in the field.
     */
    const writes = await page.evaluate(
      () => (window as unknown as { __writes: string[] }).__writes
    )
    expect(writes.filter((entry) => entry === "given=Ada")).toHaveLength(1)
    expect(snapshot?.run?.status).toBe("completed")
  }
})

/**
 * A batch fill on a form the page marks as a search. Its wire targets once
 * carried `searchForm`, which the strict page schema rejects, so every
 * `fill_form` on a search box — Google's among them — failed before a byte
 * was sent and paused as an effect that may have happened. A unit test
 * mocks the parse's caller; only the real boundary shows the leak.
 */
const SEARCH_PAGE = `<!doctype html>
<title>Search</title>
<main>
  <form action="/results" method="get" role="search">
    <input type="file" hidden />
    <textarea name="q" rows="1" role="combobox" aria-label="Search"></textarea>
    <input type="hidden" name="source" value="hp" />
    <input type="submit" value="Search" />
  </form>
</main>`

runAgentScenario({
  name: "fill-form-search-box",
  goal: "Type youtube into the search box.",
  status: "completed",
  timeoutMs: 60_000,
  html: () => SEARCH_PAGE,
  allowRoutineActions: true,
  plan: [{ text: "the search box holds youtube", kind: "change" }],
  decide: (observation: AgentFixtureObservation) => {
    const box = agentFixtureElement(
      observation,
      (element) => element.name === "Search" && element.tag === "textarea"
    )
    if (box && box.value !== "youtube") {
      return {
        type: "fill_form",
        requirementId: "r1",
        fields: [{ type: "clear_and_type", ref: box.ref, text: "youtube" }]
      }
    }
    return {
      type: "complete",
      summary: "Typed youtube into the search box.",
      outcomes: [{ id: "r1", met: true, evidence: "youtube" }]
    }
  },
  verify: async ({ page, snapshot }) => {
    await expect(page.locator('textarea[name="q"]')).toHaveValue("youtube")
    expect(snapshot?.run?.status).toBe("completed")
    expect(
      snapshot?.steps
        .filter((step) => step.command?.type === "fill_form")
        .map((step) => step.status)
    ).toEqual(["verified"])
  }
})
