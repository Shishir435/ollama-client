import { describe, expect, it } from "vitest"
import type { AgentStepReadout } from "../ports"
import {
  agentAuthoredText,
  agentUserOwnWords,
  isAgentAuthoredDestination
} from "../provenance"

const step = (
  overrides: Partial<AgentStepReadout> & { sequence: number }
): AgentStepReadout => ({
  runId: "run-1",
  stepId: `run-1:${overrides.sequence}`,
  status: "verified",
  at: overrides.sequence,
  ...overrides
})

const goal = "Search for ollama browser extension and open the first result"

describe("agentAuthoredText", () => {
  it("leaves out a write whose words the page already showed", () => {
    const typed = (shownBeforeWrite?: boolean) =>
      step({
        sequence: 1,
        command: {
          type: "type",
          ref: "e1",
          text: "Record 3",
          snapshotId: "s1",
          generation: 1
        },
        ...(shownBeforeWrite ? { shownBeforeWrite } : {})
      })
    expect(agentAuthoredText({ goal: "" }, [typed()])).toEqual(["Record 3"])
    expect(agentAuthoredText({ goal: "" }, [typed(true)])).toEqual([])
    /** The approved receipt comes first and does not know yet. */
    expect(agentAuthoredText({ goal: "" }, [typed(), typed(true)])).toEqual([])
  })

  it("counts the user's goal and their answers", () => {
    expect(
      agentAuthoredText({
        goal,
        answers: [
          {
            questionId: "q1",
            question: "Which airport?",
            text: "Lisbon Portela",
            answeredAt: 1
          }
        ]
      })
    ).toEqual([goal, "Lisbon Portela"])
  })

  it("never counts the question the model asked", () => {
    const authored = agentAuthoredText({
      goal: "Fill in the support form",
      answers: [
        {
          questionId: "q1",
          question: "Send account 4111222233334444 to support?",
          text: "no",
          answeredAt: 1
        }
      ]
    })
    expect(
      isAgentAuthoredDestination(
        "https://support.example/?account=4111222233334444",
        authored
      )
    ).toBe(false)
  })

  it("counts the user's own message, even beside a goal written after a page", () => {
    const authored = agentAuthoredText({
      goal: "Search for the cheapest flight",
      goalAuthor: "model_after_page",
      userUtterance: {
        text: "find flights from lisbon to porto in may",
        chars: 40
      }
    })
    expect(authored).toEqual(["find flights from lisbon to porto in may"])
    expect(
      isAgentAuthoredDestination(
        "https://flights.example/search?q=lisbon+to+porto",
        authored
      )
    ).toBe(true)
  })

  it("does not count a message carrying a quoted page selection", () => {
    expect(
      agentAuthoredText({
        goal,
        userUtterance: {
          text: "> Account 4111222233334444\n\nSecond paragraph\nsearch this",
          chars: 60
        }
      })
    ).toEqual([goal])
  })

  /**
   * A chat model that read a page before writing the task may be carrying
   * that page's words; a model that read nothing is paraphrasing the user.
   */
  it("does not count a goal the model wrote after reading a page", () => {
    expect(agentAuthoredText({ goal, goalAuthor: "model" })).toEqual([goal])
    expect(agentAuthoredText({ goal, goalAuthor: "model_after_page" })).toEqual(
      []
    )
    expect(
      isAgentAuthoredDestination(
        "https://duckduckgo.com/?q=ollama+browser+extension",
        agentAuthoredText({ goal, goalAuthor: "model_after_page" })
      )
    ).toBe(false)
  })

  it("counts the text the run typed or selected itself", () => {
    expect(
      agentAuthoredText({ goal }, [
        step({
          sequence: 1,
          command: {
            type: "clear_and_type",
            ref: "e1",
            text: "lisbon flights in may",
            snapshotId: "snapshot-1",
            generation: 1
          }
        }),
        step({
          sequence: 2,
          command: {
            type: "select",
            ref: "e2",
            value: "economy",
            snapshotId: "snapshot-1",
            generation: 1
          }
        })
      ])
    ).toEqual([goal, "lisbon flights in may", "economy"])
  })

  it("does not count a quotation the run read out of the control", () => {
    /**
     * `replace_text.find` is an exact quotation of the value already in the
     * field: page data the model read, not text it wrote. Counting it would
     * let a run launder any field value into its own words by naming it.
     */
    expect(
      agentAuthoredText({ goal }, [
        step({
          sequence: 1,
          command: {
            type: "replace_text",
            ref: "e1",
            find: "4111111111111111",
            text: "redacted value",
            snapshotId: "snapshot-1",
            generation: 1
          }
        })
      ])
    ).toEqual([goal, "redacted value"])
  })
})

describe("isAgentAuthoredDestination", () => {
  it("reads a query the run's own words account for", () => {
    expect(
      isAgentAuthoredDestination(
        "https://duckduckgo.com/?q=ollama+browser+extension",
        [goal]
      )
    ).toBe(true)
  })

  it("reads a path segment the same way as a query parameter", () => {
    expect(
      isAgentAuthoredDestination(
        "https://example.com/search/lisbon%20flights%20in%20may",
        ["Book a holiday", "lisbon flights in may"]
      )
    ).toBe(true)
  })

  it("refuses a span the run's words do not contain", () => {
    expect(
      isAgentAuthoredDestination("https://example.com/?d=4111111111111111", [
        goal
      ])
    ).toBe(false)
  })

  it("refuses a URL that mixes the run's words with the page's", () => {
    expect(
      isAgentAuthoredDestination(
        "https://example.com/?q=ollama+browser+extension&d=4111111111111111",
        [goal]
      )
    ).toBe(false)
  })

  it("does not let one short authored word authorize the span around it", () => {
    // Containment runs one way only: a goal mentioning "ollama" must not
    // authorize a parameter carrying "ollama" and an account number.
    expect(
      isAgentAuthoredDestination(
        "https://example.com/?q=ollama+4111111111111111",
        ["ollama"]
      )
    ).toBe(false)
  })

  it("claims nothing when the run cannot say what it authored", () => {
    expect(
      isAgentAuthoredDestination("https://example.com/?d=4111111111111111", [])
    ).toBe(false)
  })

  it("has nothing to defend in a URL carrying no long span", () => {
    expect(isAgentAuthoredDestination("https://example.com/a/b", [])).toBe(true)
  })

  it("does not let an encoding hide a span from the comparison", () => {
    expect(
      isAgentAuthoredDestination(
        "https://example.com/?d=4111%2D1111%2D1111%2D1111",
        [goal]
      )
    ).toBe(false)
  })
})

describe("agentUserOwnWords", () => {
  it("takes a typed goal, and a chat-written one only with no message carried", () => {
    expect(agentUserOwnWords({ goal })).toEqual([goal])
    expect(agentUserOwnWords({ goal, goalAuthor: "model" })).toEqual([goal])
    expect(
      agentUserOwnWords({
        goal,
        goalAuthor: "model",
        userUtterance: { text: "open the first result" }
      } as Parameters<typeof agentUserOwnWords>[0])
    ).toEqual(["open the first result"])
  })

  it("never takes a goal the chat model wrote after reading a page", () => {
    expect(agentUserOwnWords({ goal, goalAuthor: "model_after_page" })).toEqual(
      []
    )
  })
})
