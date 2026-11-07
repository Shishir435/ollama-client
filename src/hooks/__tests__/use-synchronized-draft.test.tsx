import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useSynchronizedDraft } from "../use-synchronized-draft"

const DraftInput = ({
  sourceKey,
  sourceValue
}: {
  sourceKey: string
  sourceValue: string
}) => {
  const [draft, setDraft] = useSynchronizedDraft(sourceKey, sourceValue)
  return (
    <input
      aria-label="Draft"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  )
}

describe("useSynchronizedDraft", () => {
  it("discards an old draft when the source changes away and back", () => {
    const { rerender } = render(
      <DraftInput sourceKey="session-a" sourceValue="original A" />
    )
    const input = screen.getByRole("textbox", { name: "Draft" })

    fireEvent.change(input, { target: { value: "edited A" } })
    rerender(<DraftInput sourceKey="session-b" sourceValue="original B" />)
    expect(input).toHaveValue("original B")

    rerender(<DraftInput sourceKey="session-a" sourceValue="original A" />)
    expect(input).toHaveValue("original A")
  })
})
