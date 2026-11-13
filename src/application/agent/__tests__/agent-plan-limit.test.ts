import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import { parseAgentTaskPlan } from "../agent-plan"

const call = (args: unknown): ToolCall => ({
  id: "call-1",
  name: "agent_plan",
  arguments: args as ToolCall["arguments"]
})

const utterance =
  "Compare the offers on all linked source pages and report their reference codes and the cheapest eligible offer. Exclude Archive; stay under 90 credits."
/** The chat model's goal, as measured live: it named a spend the user did not. */
const goal =
  "Compare the offers on every linked source page in the Qualification application. Exclude the Archive source, keep total research spend under 90 credits, and report each offer’s reference code plus the cheapest eligible offer."

const read = {
  kind: "read",
  text: "Compare offers on all linked source pages and report their reference codes and the cheapest eligible offer.",
  source:
    "Compare the offers on all linked source pages and report their reference codes and the cheapest eligible offer."
}

const limitText = (
  text: string,
  source: string,
  context = { goal, utterance }
) =>
  parseAgentTaskPlan(
    [
      call({
        requirements: [read],
        constraints: [{ kind: "limit", text, source }]
      })
    ],
    context
  ).constraints?.find((entry) => entry.kind === "limit")?.text

describe("a limit keeps what the user said it bounds", () => {
  it("replaces a restatement that names a spend the user never did with the user's clause", () => {
    expect(
      limitText(
        "Keep total research spend under 90 credits.",
        "stay under 90 credits."
      )
    ).toBe("stay under 90 credits.")
  })

  it("cuts the user's clause out of a longer quote", () => {
    expect(
      limitText(
        "Keep the combined budget under 90 credits.",
        "Exclude Archive; stay under 90 credits."
      )
    ).toBe("stay under 90 credits.")
  })

  it("treats an invented per-item reading the same way", () => {
    expect(
      limitText(
        "Each listed price must be under 90 credits.",
        "stay under 90 credits."
      )
    ).toBe("stay under 90 credits.")
  })

  it("keeps a restatement that adds nothing to its own user clause", () => {
    expect(limitText("Stay under 90 credits.", "stay under 90 credits.")).toBe(
      "Stay under 90 credits."
    )
    expect(
      limitText("Keep each offer under 90 credits.", "stay under 90 credits.")
    ).toBe("stay under 90 credits.")
  })

  it("keeps a total the user did state", () => {
    expect(
      limitText(
        "Keep the total spend under 90 credits.",
        "spend under 90 credits in total.",
        {
          goal,
          utterance:
            "Compare the offers on all linked source pages and report the cheapest eligible offer; spend under 90 credits in total."
        }
      )
    ).toBe("spend under 90 credits in total.")
  })

  it("does not borrow a budget object or quantifier from another user clause", () => {
    const utterance =
      "Compare the offers and report the cheapest. Keep each offer under 90 credits, and keep total spend under 200 credits."
    const parsed = parseAgentTaskPlan(
      [
        call({
          requirements: [
            {
              kind: "read",
              text: "Compare the offers and report the cheapest.",
              source: "Compare the offers and report the cheapest."
            }
          ],
          constraints: [
            {
              kind: "limit",
              text: "Keep each offer under 200 credits.",
              source: "keep total spend under 200 credits."
            },
            {
              kind: "limit",
              text: "Keep total spend under 90 credits.",
              source: "Keep each offer under 90 credits"
            }
          ]
        })
      ],
      { goal: utterance, utterance }
    )
    expect(parsed.constraints?.map((entry) => entry.text)).toEqual([
      "keep total spend under 200 credits.",
      "Keep each offer under 90 credits"
    ])
  })

  it("preserves short numeric amounts and a stated total even when omitted from the restatement", () => {
    const utterance = `${read.source} Keep total spend under 90 credits.`
    for (const text of [
      "Keep spend under 90 credits.",
      "Keep total spend under 99 credits."
    ])
      expect(
        limitText(text, "keep total spend under 90 credits.", {
          goal: utterance,
          utterance
        })
      ).toBe("keep total spend under 90 credits.")
  })

  it("requests repair rather than choosing arbitrarily when a source quotes multiple bounds", () => {
    const source =
      "Keep each offer under 90 credits; keep total spend under 200 credits."
    const utterance = `${read.source} ${source}`
    expect(() =>
      limitText("Keep each offer under 200 credits.", source, {
        goal: utterance,
        utterance
      })
    ).toThrow("multiple user bounds")
  })

  it.each([
    "Keep each offer over 90 credits.",
    "Keep each offer above 90 credits.",
    "Keep each offer at most 90 credits."
  ])("preserves the user's comparison operator against %s", (text) => {
    const source = "Keep each offer under 90 credits."
    const utterance = `${read.source} ${source}`
    expect(limitText(text, source, { goal: utterance, utterance })).toBe(source)
  })

  it("keeps qualifiers at the end of a long user clause", () => {
    const source =
      "stay under 90 credits for the combined cost of all selected items including shipping in total."
    const utterance = `${read.source} ${source}`
    expect(
      limitText("Keep each price under 90 credits.", source, {
        goal: utterance,
        utterance
      })
    ).toBe(source)
  })

  it("leaves a constraint without a numeric bound alone", () => {
    expect(
      parseAgentTaskPlan(
        [
          call({
            requirements: [read],
            constraints: [
              {
                kind: "exclude",
                text: "Exclude the Archive source.",
                source: "Exclude Archive"
              }
            ]
          })
        ],
        { goal, utterance }
      ).constraints?.[0]?.text
    ).toBe("Exclude the Archive source.")
  })

  it("without a separate user message, judges against the goal the user gave", () => {
    expect(
      limitText(
        "Keep total research spend under 90 credits.",
        "stay under 90 credits.",
        {
          goal: utterance
        } as never
      )
    ).toBe("stay under 90 credits.")
  })
})
