import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Command, CommandInput } from "../command"

describe("CommandInput", () => {
  it("associates the search icon label with the command input", () => {
    const { container } = render(
      <Command>
        <CommandInput aria-label="Search commands" />
      </Command>
    )
    const input = container.querySelector<HTMLInputElement>(
      '[data-slot="command-input"]'
    )
    const label = container.querySelector("label[for]")

    expect(input).not.toBeNull()
    expect(label).not.toBeNull()
    expect((label as HTMLLabelElement).control).toBe(input)
  })
})
