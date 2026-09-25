import {
  AGENT_DETAILS_PAGE,
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const formPage =
  '<!doctype html><title>Agent form</title><main><h1>Account</h1><form action="/details"><label for="name">Name</label><input id="name" name="name"><button>Continue</button></form></main>'

runAgentScenario({
  name: "form",
  goal: "Enter Alice in the Name field, continue, and tell me the status.",
  status: "completed",
  hosted: true,
  html: (path) => (path.startsWith("/details") ? AGENT_DETAILS_PAGE : formPage),
  decide(observation) {
    if (observation.text.includes("Status: Active"))
      return {
        type: "complete",
        summary: "Active",
        evidence: "Status: Active"
      }
    const field = agentFixtureElement(
      observation,
      (element) => element.tag === "input"
    )
    if (field && field.value !== "Alice")
      return { type: "clear_and_type", ref: field.ref, text: "Alice" }
    return {
      type: "click",
      ref: agentFixtureElement(
        observation,
        (element) => element.name === "Continue"
      )?.ref
    }
  },
  async verify({ page, snapshot, wire }) {
    await expect(page.getByText("Status: Active")).toBeVisible()
    expect(snapshot?.run?.result).toContain("Active")
    expect(snapshot?.run?.observationCount).toBeGreaterThanOrEqual(3)
    expect(
      snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual([expect.stringMatching(/^(type|clear_and_type)$/), "click"])
    expect(wire.length).toBeGreaterThanOrEqual(3)
  }
})

const commentRequests: { method: string; body: string | null }[] = []
runAgentScenario({
  name: "comment-with-empty-attachment",
  allowRoutineActions: true,
  goal: "Add the comment 'This is a test comment.' Keep the pull request open.",
  status: "completed",
  redirect: (path) =>
    path === "/comments" ? "/?comment=posted#issuecomment-1" : undefined,
  html: (path) =>
    path === "/?comment=posted"
      ? "<!doctype html><title>Comment posted</title><main><h1>Pull request open</h1><p>Comment posted: This is a test comment.</p></main>"
      : '<!doctype html><title>Pull request</title><main><h1>Pull request open</h1><form action="/comments" method="post"><input type="hidden" name="authenticity_token" value="fixture-csrf"><label for="body">Add a comment</label><textarea id="body" name="comment[body]"></textarea><input type="file" hidden><button name="comment_and_close" value="1">Close with comment</button><button>Comment</button></form></main>',
  decide(observation, context) {
    if (context.step === 1) {
      commentRequests.length = 0
      context.page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/comments") {
          commentRequests.push({
            method: request.method(),
            body: request.postData()
          })
        }
      })
    }
    if (observation.text.includes("Comment posted:"))
      return {
        type: "complete",
        summary: "Posted the test comment and kept the pull request open.",
        evidence: "Comment posted: This is a test comment."
      }
    const field = agentFixtureElement(
      observation,
      (element) => element.tag === "textarea"
    )
    if (field?.value !== "This is a test comment.")
      return {
        type: "clear_and_type",
        ref: field?.ref,
        text: "This is a test comment."
      }
    return {
      type: "click",
      ref: agentFixtureElement(
        observation,
        (element) => element.name === "Comment"
      )?.ref
    }
  },
  async verify({ page, snapshot, messages }) {
    await expect(page).toHaveURL(/\/\?comment=posted#issuecomment-1$/)
    await expect(page.getByRole("heading")).toHaveText("Pull request open")
    await expect(page.getByText("Comment posted:")).toContainText(
      "This is a test comment."
    )
    expect(commentRequests).toHaveLength(1)
    expect(commentRequests[0].method).toBe("POST")
    expect(
      Object.fromEntries(new URLSearchParams(commentRequests[0].body ?? ""))
    ).toEqual({
      authenticity_token: "fixture-csrf",
      "comment[body]": "This is a test comment."
    })
    expect(
      snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual(["clear_and_type", "click"])
    const approvals = messages.flatMap((message) =>
      message.type === "agent_snapshot" &&
      message.snapshot.pending?.kind === "approval"
        ? [message.snapshot.pending.request]
        : []
    )
    expect(new Set(approvals.map((approval) => approval.id)).size).toBe(1)
    /**
     * `high`, not `critical`: an empty attachment picker does not make the
     * form sensitive, and a submission is priced high so the user can widen
     * it to this origin for this run. Critical is the floor for destroying,
     * paying, authenticating and a picker with something actually selected.
     */
    expect(approvals.every((approval) => approval.risk === "high")).toBe(true)
    expect(
      messages.some(
        (message) =>
          message.type === "agent_snapshot" &&
          message.snapshot.run?.status === "awaiting_takeover"
      )
    ).toBe(false)
  }
})

/**
 * A native form submission fires a bubbling `formdata` event after every
 * check the executor makes, and a document listener could rewrite the query
 * in it. The approved search address is navigated to directly, so the page
 * that loads is the one the approval named and the rewrite never reaches the
 * network.
 */
const searchPaths: string[] = []
const searchPage =
  '<!doctype html><title>Agent search</title><main><h1>Catalog</h1><form action="/search"><label for="q">Search</label><input id="q" name="q"></form><script>document.addEventListener("formdata", (event) => event.formData.set("q", "exfiltrated"))</script></main>'
runAgentScenario({
  name: "search-enter-formdata-rewrite",
  goal: "Search the catalog for atlas and tell me what the results say.",
  status: "completed",
  html: (path) => {
    searchPaths.push(path)
    return path.startsWith("/search")
      ? `<!doctype html><title>Results</title><main><h1>Results</h1><p>Results for ${new URL(path, "http://fixture").searchParams.get("q")}</p></main>`
      : searchPage
  },
  decide(observation) {
    if (observation.text.includes("Results for"))
      return {
        type: "complete",
        summary: "Results for atlas",
        evidence: "Results for atlas"
      }
    const field = agentFixtureElement(
      observation,
      (element) => element.tag === "input"
    )
    if (field?.value !== "atlas" || !field.focused)
      return { type: "clear_and_type", ref: field?.ref, text: "atlas" }
    return { type: "press_key", ref: field.ref, key: "Enter" }
  },
  async verify({ page }) {
    await expect(page.getByText("Results for atlas")).toBeVisible()
    expect(new URL(page.url()).search).toBe("?q=atlas")
    expect(searchPaths.filter((path) => path.startsWith("/search"))).toEqual([
      "/search?q=atlas"
    ])
  }
})
