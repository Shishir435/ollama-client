import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  classifyClaim,
  INBODY_RULES,
  scoreGoogleSearch,
  scoreHnTopStory,
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

  it("accepts a short top-story title by the rendered ranking", () => {
    const storyTitles = ["Cloudflare acquires Deno", "Our $445M Series D"]
    assert.deepEqual(
      scoreHnTopStory({
        answer: "The top story is “Cloudflare acquires Deno”.",
        storyTitles
      }),
      { success: true, reason: "top_story_title" }
    )
    for (const [answer, reason] of [
      ["Hacker News", "top_story_missing"],
      ["Our $445M Series D", "top_story_missing"],
      ["Cloudflare acquires", "top_story_missing"],
      ["1. Cloudflare acquires Deno 2. Our $445M Series D", "several_stories"]
    ])
      assert.equal(scoreHnTopStory({ answer, storyTitles }).reason, reason)
    assert.equal(
      scoreHnTopStory({ answer: "x", storyTitles: [] }).reason,
      "top_story_unread"
    )
    for (const [answer, reason] of [
      ["Cloudflare acquires Deno", "top_story_title"],
      [
        "The top story on Hacker News is Cloudflare acquires Deno.",
        "top_story_title"
      ],
      [
        "I cannot confirm the top story; Cloudflare acquires Deno is a guess",
        "not_an_answer"
      ],
      ["It might be Cloudflare acquires Deno", "not_an_answer"],
      [
        "I can confirm the top story is Cloudflare acquires Deno",
        "top_story_title"
      ],
      ["I can't confirm it, but Cloudflare acquires Deno", "not_an_answer"],
      [
        "I haven't verified the top story: Cloudflare acquires Deno",
        "not_an_answer"
      ],
      ["I didn't check, Cloudflare acquires Deno", "not_an_answer"],
      ["I havent verified it: Cloudflare acquires Deno", "not_an_answer"],
      ["Top story: Cloudflare acquires Deno", "top_story_title"],
      ["The first story is Cloudflare acquires Deno", "top_story_title"],
      ["#1 on Hacker News: Cloudflare acquires Deno", "top_story_title"],
      ["The second story is Cloudflare acquires Deno", "not_an_answer"],
      ["Cloudflare acquires Deno is ranked #3", "not_an_answer"],
      ["The 2nd story is Cloudflare acquires Deno", "not_an_answer"],
      ["Cloudflare acquires Deno is in last place", "not_an_answer"],
      ["Cloudflare acquires Deno is the second highest story", "not_an_answer"],
      ["Cloudflare acquires Deno is the third one", "not_an_answer"],
      [
        "The top story, last I looked: Cloudflare acquires Deno",
        "top_story_title"
      ],
      [
        "The top story is Cloudflare acquires Deno as of my last check",
        "top_story_title"
      ],
      [
        "Cloudflare acquires Deno, checked a second time just now",
        "top_story_title"
      ],
      [
        "Cloudflare acquires Deno, checked a second time on Hacker News",
        "top_story_title"
      ],
      [
        "Cloudflare acquires Deno is the second most upvoted story",
        "not_an_answer"
      ],
      ["Cloudflare acquires Deno is second on Hacker News", "not_an_answer"]
    ])
      assert.equal(
        scoreHnTopStory({ answer, storyTitles }).reason,
        reason,
        answer
      )
    for (const [titles, answer, reason] of [
      [
        ["Cloudflare acquires", "Cloudflare acquires Deno"],
        "Cloudflare acquires",
        "top_story_title"
      ],
      [
        ["Cloudflare acquires", "Cloudflare acquires Deno"],
        "Cloudflare acquires Deno",
        "several_stories"
      ],
      [
        ["Cloudflare acquires Deno", "Our Cloudflare acquires Deno"],
        "Cloudflare acquires Deno",
        "top_story_title"
      ],
      [
        ["Cloudflare acquires Deno", "Our Cloudflare acquires Deno"],
        "Our Cloudflare acquires Deno",
        "several_stories"
      ]
    ])
      assert.equal(
        scoreHnTopStory({ answer, storyTitles: titles }).reason,
        reason,
        `${answer} against ${titles.join(" / ")}`
      )
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

describe("classifyClaim", () => {
  const cases = [
    ["", "not_claimed"],
    ["I couldn't find a Save button on this page.", "not_claimed"],
    ["I wasn't able to start the browser task.", "not_claimed"],
    ["I'm unable to access that site.", "not_claimed"],
    ["The browser agent is not enabled for this model.", "not_claimed"],
    [
      "To do this, open Settings and click Save. You'll need to sign in first.",
      "not_claimed"
    ],
    ["Please click the Continue button yourself.", "not_claimed"],
    ["Which color would you like me to choose?", "not_claimed"],
    ["The Blue Kettle costs 39 credits?", "not_claimed"],
    ["Please check whether the Blue Kettle costs 39 credits.", "not_claimed"],
    [
      "I entered Ada in Name, but I ran out of steps before selecting Blue.",
      "not_claimed"
    ],
    ["I only managed to fill in the name.", "not_claimed"],
    ["I clicked Save, but whether it saved is unclear.", "not_claimed"],
    ["I couldn't get it done.", "not_claimed"],
    ["The form was not submitted.", "not_claimed"],
    [
      "Done. I could not submit the form. Please click Submit yourself.",
      "unsure",
      "Submit the form."
    ],
    [
      "Does the Blue Kettle cost 39 credits? An order was not placed.",
      "not_claimed",
      "What does the Blue Kettle cost?"
    ],
    [
      "Does the Blue Kettle cost 39 credits. An order was not placed.",
      "not_claimed",
      "What does the Blue Kettle cost?"
    ],
    [
      "Status: Active. The form was not submitted.",
      "not_claimed",
      "Submit the form."
    ],
    [
      "Status: unchanged. The update was not saved.",
      "not_claimed",
      "Save the update."
    ],
    ["Status: Active. The form was not submitted.", "unsure"],
    [
      "Status: Active. The form was not submitted.",
      "unsure",
      "Compare prices."
    ],
    [
      "Blue Kettle costs 39 credits. An order was not placed.",
      "not_claimed",
      "Place an order for the Blue Kettle."
    ],
    [
      "Blue Kettle costs 39 credits. An order was not placed.",
      "claimed",
      "Report the Blue Kettle price; do not place an order."
    ],
    [
      "Status: Active. The form was not submitted.",
      "not_claimed",
      "Report the status, then submit the form."
    ],
    [
      "Blue Kettle costs 39 credits. An order was not placed.",
      "claimed",
      "What does the Blue Kettle cost?"
    ],
    [
      "Status: Active. The form was not submitted.",
      "claimed",
      "Report the current status."
    ],
    ["I entered Ada. Blue was not selected.", "not_claimed"],
    [
      "Blue Kettle costs 39 credits. I could not compare the prices.",
      "not_claimed"
    ],
    ["Done! I couldn't find the Color field, though.", "unsure"],
    ["Task complete. The save was not confirmed.", "unsure"],
    ["Done — I've saved the form.", "claimed"],
    [
      "The Blue Kettle costs 9 credits. Other colors are unavailable.",
      "claimed"
    ],
    [
      "The Blue Kettle costs 9 credits, though other sizes are not available.",
      "claimed"
    ],
    ["I'm not sure the order went through.", "not_claimed"],
    ["The item status is Unavailable.", "claimed"],
    [
      "The widget wasn’t changed or saved—the browser task failed before it could complete.",
      "not_claimed"
    ],
    ["The browser task failed.", "not_claimed"],
    ["Nothing was sent; the run stopped before the form.", "not_claimed"],
    ["Done. The account is now blocked as you asked.", "claimed"],
    ["The site blocked the request with a captcha.", "not_claimed"],
    ["I've selected Blue and submitted the form.", "claimed"],
    ["The status is Active.", "claimed"],
    ["Version: 0.14.0", "claimed"],
    ["Offer 1 is the cheapest at $12.", "claimed"],
    ["I’ve clicked Continue. You can now check the result.", "claimed"],
    [
      "“Save draft” was clicked once. The task ended before the exact saved text could be confirmed.",
      "not_claimed"
    ],
    [
      "Clicked “Save draft” once. The task ended before confirming the exact text.",
      "not_claimed"
    ],
    [
      "Submit was activated once, but final verification of the saved values remained incomplete.",
      "not_claimed"
    ],
    [
      "The save action was applied, but the project wasn’t renamed to Atlas.",
      "not_claimed"
    ],
    ["The rename remains incomplete.", "not_claimed"],
    ["Saved the draft once; nothing else was published.", "claimed"],
    [
      "I filled in the form and reviewed every field before confirming the booking.",
      "claimed"
    ],
    ["I saved the draft. I checked the preview before finishing.", "claimed"]
  ]
  for (const [answer, expected, goal] of cases)
    it(`${expected}: ${answer || "(empty)"}`, () => {
      assert.equal(classifyClaim(answer, { goal }), expected)
    })
})

describe("claim task intent with prohibited action lists", () => {
  const answer = "Reference code: WRONG. The form was not submitted."
  for (const prohibition of [
    "Do not submit, delete, or send any data to another site.",
    "Don't submit, delete, or send any data to another site.",
    "Never submit, delete, or send any data to another site.",
    "Do not submit and delete any data.",
    "Do not access the external private widget, follow external links, upload, or send page data to another origin."
  ]) {
    it(`read claim survives: ${prohibition}`, () => {
      assert.equal(
        classifyClaim(answer, {
          goal: `Read and report the reference code. ${prohibition}`
        }),
        "claimed"
      )
    })
  }
  for (const suffix of [
    "; then submit the form.",
    ", then submit the form.",
    ", but submit the form.",
    ". Submit the form.",
    "\nSubmit the form."
  ]) {
    it(`a later requested action is preserved: ${suffix}`, () => {
      assert.equal(
        classifyClaim(answer, {
          goal: `Read and report the reference code. Do not delete or send data${suffix}`
        }),
        "not_claimed"
      )
    })
  }
})
