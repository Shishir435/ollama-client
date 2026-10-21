import { render } from "@testing-library/react"
import { createRef } from "react"
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
    const label = container.querySelector<HTMLLabelElement>(
      '[data-slot="command-input-wrapper"] label[for]'
    )

    expect(input).not.toBeNull()
    expect(label).not.toBeNull()
    expect(label?.control).toBe(input)
  })

  it("forwards a caller ref while tracking the icon label", () => {
    const inputRef = createRef<HTMLInputElement>()
    const { container } = render(
      <Command>
        <CommandInput ref={inputRef} aria-label="Search commands" />
      </Command>
    )
    const input = container.querySelector<HTMLInputElement>(
      '[data-slot="command-input"]'
    )

    expect(inputRef.current).toBe(input)
    expect(input).not.toBeNull()
  })
})
