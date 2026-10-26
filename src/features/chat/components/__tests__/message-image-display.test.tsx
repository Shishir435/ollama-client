import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ loadImageBytes: vi.fn() }))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/features/sessions/lib/image-bytes", () => ({
  loadImageBytes: mocks.loadImageBytes
}))

import { MessageImageDisplay } from "@/features/chat/components/message-image-display"

const image = {
  imageId: "image-1",
  fileName: "photo.png",
  mimeType: "image/png",
  size: 3
}

describe("MessageImageDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    URL.createObjectURL = vi.fn(() => "blob:image-1")
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows an image that carries its bytes without reading anything", () => {
    render(<MessageImageDisplay images={[{ ...image, base64: "AQID" }]} />)

    expect(screen.getByAltText("photo.png").getAttribute("src")).toBe(
      "data:image/png;base64,AQID"
    )
    expect(mocks.loadImageBytes).not.toHaveBeenCalled()
  })

  it("reads a stored image when it mounts and shows it through an object URL", async () => {
    mocks.loadImageBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))

    render(<MessageImageDisplay images={[{ ...image, id: 7, base64: "" }]} />)

    expect(screen.queryByAltText("photo.png")).toBeNull()
    await waitFor(() =>
      expect(screen.getByAltText("photo.png").getAttribute("src")).toBe(
        "blob:image-1"
      )
    )
    expect(mocks.loadImageBytes).toHaveBeenCalledWith(7)
  })

  it("releases the object URL when the image unmounts", async () => {
    mocks.loadImageBytes.mockResolvedValue(new Uint8Array([1]))
    const { unmount } = render(
      <MessageImageDisplay images={[{ ...image, id: 7, base64: "" }]} />
    )
    await waitFor(() => expect(screen.getByAltText("photo.png")).toBeTruthy())

    unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-1")
  })
})
