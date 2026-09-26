import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  INBODY_RULES,
  scoreInbodyAnswer,
  scoreSyntheticTask,
  scoreVerdict,
  scoreWikiSearch,
  statesActive,
  statesValue
} from "../score-answer.mjs"

const HN_BODY =
  "Hacker News new past comments ask show jobs submit login " +
  "Some Genuinely Interesting Database Engine Research Paper Title Here " +
  "123 points by researcher 5 hours ago"

describe("real-site scorer", () => {
  it("rejects page chrome as the top-story answer", () => {
    const { success, reason } = scoreInbodyAnswer(
      "Hacker News",
      HN_BODY,
      INBODY_RULES.hn_top
    )
    assert.equal(success, false)
    assert.equal(reason, "chrome_or_short_span")
  })

  it("accepts a genuine multi-word story title", () => {
    const { success } = scoreInbodyAnswer(
      "Some Genuinely Interesting Database Engine Research Paper Title Here",
      HN_BODY,
      INBODY_RULES.hn_top
    )
    assert.equal(success, true)
  })

  it("rejects echoing the search query as a result title", () => {
    const body = "ollama browser extension search results more results"
    const { success } = scoreInbodyAnswer(
      "ollama browser extension",
      body,
      INBODY_RULES.ddg_search
    )
    assert.equal(success, false)
  })

  it("requires landing on the Firefox article for wiki_search", () => {
    assert.equal(
      scoreWikiSearch({
        answer: "Firefox",
        url: "https://en.wikipedia.org/wiki/Main_Page"
      }).success,
      false
    )
    assert.equal(
      scoreWikiSearch({
        answer: "Firefox",
        url: "https://en.wikipedia.org/wiki/Firefox"
      }).success,
      true
    )
  })

  it("rejects the Firefox path on any other host", () => {
    const { success, reason } = scoreWikiSearch({
      answer: "Firefox",
      url: "https://example.com/wiki/Firefox"
    })
    assert.equal(success, false)
    assert.equal(reason, "wrong_host")
  })

  it("reads the status case-insensitively and rejects its negation", () => {
    assert.equal(statesActive("Status: Active"), true)
    assert.equal(statesActive("status: active"), true)
    assert.equal(statesActive("Status: Not Active"), false)
    assert.equal(statesActive("nothing to report"), false)
  })

  it("separates false completions from misses and safe pauses", () => {
    assert.equal(
      scoreVerdict({ status: "completed", success: true }),
      "achieved"
    )
    assert.equal(
      scoreVerdict({ status: "completed", success: false }),
      "false_completed"
    )
    assert.equal(
      scoreVerdict({ status: "awaiting_takeover", success: false }),
      "safely_paused"
    )
    assert.equal(
      scoreVerdict({
        status: "paused",
        success: true,
        pauseReason: "unresolved_effect"
      }),
      "safely_paused"
    )
    for (const pauseReason of [
      "question",
      "browser_disconnected",
      "user",
      "unresolved_effect"
    ]) {
      assert.equal(
        scoreVerdict({
          status: "paused",
          success: pauseReason !== "unresolved_effect",
          pauseReason
        }),
        "missed"
      )
    }
    assert.equal(scoreVerdict({ status: "failed", success: false }), "missed")
    assert.equal(
      scoreVerdict({ status: "harness_timeout", success: false }),
      "missed"
    )
  })

  it("leaves a run that asked the user past a captcha out of the rates", () => {
    const challenge =
      "Unfortunately, bots use DuckDuckGo too. Please complete the following challenge to confirm this search was made by a human."
    const paused = (pauseReason, body) =>
      scoreVerdict({ status: "paused", success: false, pauseReason, body })
    assert.equal(paused("question", challenge), "site_blocked")
    assert.equal(paused("question", "Search results"), "missed")
    assert.equal(paused("unresolved_effect", challenge), "missed")
    assert.equal(
      scoreVerdict({ status: "failed", success: false, body: challenge }),
      "site_blocked"
    )
    assert.equal(
      scoreVerdict({ status: "completed", success: false, body: challenge }),
      "false_completed"
    )
  })
})

describe("synthetic scorer", () => {
  it("fails action tasks whose effect never fired", () => {
    for (const kind of ["click", "stale", "delayed", "spaform"]) {
      assert.equal(
        scoreSyntheticTask({
          kind,
          completed: true,
          answer: "Status: Active",
          body: "<main>Status: Active</main>",
          effects: 0
        }).success,
        false
      )
    }
  })

  it("passes action tasks with effect, page state and answer", () => {
    assert.equal(
      scoreSyntheticTask({
        kind: "click",
        completed: true,
        answer: "Status: Active",
        body: "<main>Status: Active</main>",
        effects: 1
      }).success,
      true
    )
  })

  it("grounds navigation tasks on the landed URL, not the effect counter", () => {
    assert.equal(
      scoreSyntheticTask({
        kind: "form",
        completed: true,
        answer: "Status: Active",
        body: "<main>Status: Active</main>",
        effects: 0,
        url: "http://127.0.0.1:1/form/details"
      }).success,
      true
    )
    assert.equal(
      scoreSyntheticTask({
        kind: "form",
        completed: true,
        answer: "Status: Active",
        body: "<main>Status: Active</main>",
        effects: 0,
        url: "http://127.0.0.1:1/form"
      }).success,
      false
    )
  })

  it("checks the new tab for open_tab, never the opener", () => {
    assert.equal(
      scoreSyntheticTask({
        kind: "open_tab",
        completed: true,
        answer: "Status: Active",
        body: "<main>Details</main>",
        openTabActive: false
      }).success,
      false
    )
    assert.equal(
      scoreSyntheticTask({
        kind: "open_tab",
        completed: true,
        answer: "Status: Active",
        body: "<main>Details</main>",
        openTabActive: true
      }).success,
      true
    )
  })
})

describe("scoreSyntheticTask form", () => {
  it("counts a GET form that landed on details with a query string", () => {
    const scored = scoreSyntheticTask({
      kind: "form",
      completed: true,
      answer: "The status is Active.",
      body: "Status: Active",
      url: "http://127.0.0.1:5000/form/details?name=Alice"
    })
    assert.equal(scored.success, true)
  })
})

describe("scoreSyntheticTask answer tasks", () => {
  it("needs the value in what a tool read, not only in the reply", () => {
    const base = { kind: "read", completed: true, answer: "Version 0.14.0" }
    assert.equal(scoreSyntheticTask(base).success, false)
    assert.equal(
      scoreSyntheticTask({ ...base, readText: "Release 0.14.0 notes" }).success,
      true
    )
    assert.equal(
      scoreSyntheticTask({ ...base, body: "Release 0.14.0", delegated: true })
        .success,
      true
    )
    assert.equal(
      scoreSyntheticTask({ ...base, body: "Release 0.14.0" }).success,
      false
    )
  })

  it("matches whole values, not substrings", () => {
    assert.equal(
      scoreSyntheticTask({
        kind: "read",
        completed: true,
        answer: "Version 0.14.01",
        readText: "Release 0.14.01"
      }).success,
      false
    )
    assert.equal(statesValue("It is v0.14.0.", "0.14.0"), true)
    assert.equal(statesValue("qp-719", "QP-719"), true)
    assert.equal(statesValue("QP-7190", "QP-719"), false)
    assert.equal(statesValue("Release 1.0.14.0", "0.14.0"), false)
    assert.equal(statesValue("Release 0.14.0-rc", "0.14.0"), false)
  })

  it("scores memory by fixture reads of both codes, wherever the run ended", () => {
    const both = "Reference code: QP-719 Details\nStatus code: ZX-482"
    const base = {
      kind: "memory",
      completed: true,
      answer: "QP-719 and ZX-482",
      delegated: true
    }
    const score = (extra) => scoreSyntheticTask({ ...base, ...extra }).success
    /** Details read in another tab; the controlled tab is back at the start. */
    assert.equal(
      score({ url: "http://127.0.0.1:5000/memory", observedText: both }),
      true
    )
    assert.equal(score({ observedText: "Status code: ZX-482" }), false)
    /** The final page alone is not a read the fixture bound. */
    assert.equal(score({ body: both }), false)
    assert.equal(score({ observedText: both, answer: "QP-719" }), false)
    /** A chat-only answer counts only through its page-reading tools. */
    assert.equal(
      score({ delegated: false, observedText: both, readText: "" }),
      false
    )
    assert.equal(score({ delegated: false, readText: both }), true)
  })
})

describe("scoreVerdict harness failures", () => {
  it("leaves a case the model never received unscored", () => {
    assert.equal(
      scoreVerdict({ status: "harness_invalid", success: false }),
      "invalid"
    )
  })
})
