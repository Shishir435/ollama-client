import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  INBODY_RULES,
  scoreGoogleSearch,
  scoreInbodyAnswer,
  scoreSyntheticTask,
  scoreVerdict,
  scoreWikipediaRelease,
  scoreWikiSearch,
  statesActive,
  statesValue
} from "../score-answer.mjs"

const HN_BODY =
  "Hacker News new past comments ask show jobs submit login " +
  "Some Genuinely Interesting Database Engine Research Paper Title Here " +
  "123 points by researcher 5 hours ago"

describe("real-site scorer", () => {
  it("grounds wiki release answers in the requested article's Release field", () => {
    assert.deepEqual(
      scoreWikipediaRelease({
        answer: "Chromium was first released in 2008.",
        infoboxRelease: "2 September 2008; 18 years ago",
        value: "2008",
        url: "https://en.wikipedia.org/wiki/Chromium_(web_browser)",
        articlePath: "/wiki/Chromium_(web_browser)"
      }),
      { success: true, reason: "article_release_and_answer_match" }
    )
    assert.equal(
      scoreWikipediaRelease({
        answer: "It was 2008.",
        infoboxRelease: "1 January 2007",
        value: "2008",
        url: "https://en.wikipedia.org/wiki/Chromium_(web_browser)",
        articlePath: "/wiki/Chromium_(web_browser)"
      }).success,
      false
    )
    assert.equal(
      scoreWikipediaRelease({
        answer: "It was 2008.",
        infoboxRelease: "2 September 2008",
        value: "2008",
        url: "https://en.wikipedia.org/wiki/History_of_the_web_browser",
        articlePath: "/wiki/Chromium_(web_browser)"
      }).success,
      false
    )
    assert.equal(
      scoreWikipediaRelease({
        answer: "It was 20081.",
        infoboxRelease: "2 September 2008",
        value: "2008",
        url: "https://en.wikipedia.org/wiki/Chromium_(web_browser)",
        articlePath: "/wiki/Chromium_(web_browser)"
      }).success,
      false
    )
  })

  it("ignores conflicting Release lines outside the infobox", () => {
    const scored = scoreWikipediaRelease({
      answer: "Chromium was released in 2008.",
      infoboxRelease: "2 September 2007",
      pageText:
        "Release 2008\nA later Release 2008 appears in the article body",
      value: "2008",
      url: "https://en.wikipedia.org/wiki/Chromium_(web_browser)",
      articlePath: "/wiki/Chromium_(web_browser)"
    })
    assert.deepEqual(scored, {
      success: false,
      reason: "release_value_missing"
    })
  })

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

  /** "YouTube" is a correct first title and too short for any span rule. */
  it("judges google_search by landing on the results for the query", () => {
    assert.equal(
      scoreGoogleSearch({
        answer: "YouTube",
        url: "https://www.google.com/search?q=youtube&source=hp",
        firstResultTitle: "YouTube"
      }).success,
      true
    )
    for (const url of [
      "https://www.google.com/",
      "https://www.google.com/sorry/index?continue=/search?q=youtube",
      "https://example.com/search?q=youtube"
    ])
      assert.equal(
        scoreGoogleSearch({
          answer: "YouTube",
          url,
          firstResultTitle: "YouTube"
        }).success,
        false
      )
  })

  it("refuses a google_search answer that does not name the first result", () => {
    const url = "https://www.google.com/search?q=youtube"
    for (const answer of [
      "Google",
      "Vimeo - Video hosting",
      "YouTube Music",
      ""
    ])
      assert.deepEqual(
        scoreGoogleSearch({ answer, url, firstResultTitle: "YouTube" }),
        {
          success: false,
          reason: "title_missing"
        }
      )
    assert.equal(scoreGoogleSearch({ answer: "YouTube", url }).success, false)
    assert.equal(
      scoreGoogleSearch({
        answer: "YouTube",
        url,
        firstResultTitle: "YouTube Music"
      }).success,
      false
    )
  })

  it("accepts the complete Google result title in ordinary answer phrasing", () => {
    const url = "https://www.google.com/search?q=youtube"
    for (const answer of [
      "The first result is YouTube.",
      'The title of the first result is "YouTube".',
      "First result: YouTube",
      "YouTube is the first result."
    ])
      assert.equal(
        scoreGoogleSearch({ answer, url, firstResultTitle: "YouTube" }).success,
        true
      )
    for (const answer of [
      "The first result is YouTube Music.",
      "YouTube Music is the first result."
    ])
      assert.equal(
        scoreGoogleSearch({ answer, url, firstResultTitle: "YouTube" }).success,
        false
      )
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
    /** A page about CAPTCHAs is a page, not a challenge. */
    assert.equal(
      paused("question", "CAPTCHA is a type of challenge–response test."),
      "missed"
    )
    assert.equal(
      paused("question", `${"Long article text. ".repeat(100)}${challenge}`),
      "missed"
    )
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
    for (const kind of ["click", "stale", "delayed", "spaform", "overlay"]) {
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

  it("counts the wrong route as a miss and the recovered one as a pass", () => {
    const wrongpath = (url) =>
      scoreSyntheticTask({
        kind: "wrongpath",
        completed: true,
        answer: "Status: Active",
        body: "<main>Status: Active</main>",
        url
      }).success
    assert.equal(wrongpath("http://127.0.0.1:1/wrongpath/old"), false)
    assert.equal(wrongpath("http://127.0.0.1:1/old/details"), false)
    assert.equal(wrongpath("http://127.0.0.1:1/wrongpath/details"), true)
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
  it("scores canvas only from a picture: the code is in no text the run read", () => {
    const base = {
      kind: "canvas",
      completed: true,
      delegated: true,
      effects: 1,
      body: "Pen Eraser Undo Redo Clear Render Rendered.",
      renderedCanvasScreenshot: true,
      answer: "The canvas shows KV-305."
    }
    const score = (extra) => scoreSyntheticTask({ ...base, ...extra }).success
    assert.equal(score({}), true)
    /** Correct code without a post-render image is not a visual read. */
    assert.equal(score({ renderedCanvasScreenshot: false }), false)
    assert.equal(score({ renderedCanvasScreenshot: undefined }), false)
    assert.equal(score({ answer: "The canvas shows KV-306." }), false)
    /** Render was never pressed, so nothing was drawn to read. */
    assert.equal(score({ effects: 0 }), false)
    /** The click landed but the drawing did not finish. */
    assert.equal(score({ body: "Pen Eraser Undo Redo Clear Render" }), false)
    assert.equal(score({ answer: "I could not see the canvas." }), false)
    /** A code reachable from text means the fixture leaked, not a pass. */
    assert.equal(score({ observedText: "KV-305" }), false)
    assert.equal(score({ delegated: false }), false)
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
