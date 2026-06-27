import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TIMEOUT_FIELDS } from "@/features/model/components/content-extraction-constants"
import { TimeoutInputField } from "@/features/model/components/content-extraction-fields"

describe("content extraction fields", () => {
  it("clamps timeout input to its field bounds", () => {
    const onValueChange = vi.fn()
    const field = TIMEOUT_FIELDS[0]

    render(
      <TimeoutInputField
        field={field}
        value={field.min}
        onValueChange={onValueChange}
        label="Timeout"
      />
    )

    fireEvent.change(screen.getByRole("spinbutton", { name: "Timeout" }), {
      target: { value: String(field.max + 1) }
    })

    expect(onValueChange).toHaveBeenCalledWith(field.max)
  })
})
