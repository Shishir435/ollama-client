import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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

/** An observer that reports every watched element as on screen. */
const nearScreen = () =>
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() {
        this.callback([{ isIntersecting: true }])
      }
      disconnect() {}
    }
  )

describe("MessageImageDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      }
    )
    URL.createObjectURL = vi.fn(() => "blob:image-1")
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("shows an image that carries its bytes without reading anything", () => {
    render(<MessageImageDisplay images={[{ ...image, base64: "AQID" }]} />)

    expect(screen.getByAltText("photo.png").getAttribute("src")).toBe(
      "data:image/png;base64,AQID"
    )
    expect(mocks.loadImageBytes).not.toHaveBeenCalled()
  })

  it("does not read a stored image until it is near the screen", async () => {
    render(<MessageImageDisplay images={[{ ...image, id: 7, base64: "" }]} />)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mocks.loadImageBytes).not.toHaveBeenCalled()
  })

  it("reads a stored image once it is near the screen and shows it through an object URL", async () => {
    mocks.loadImageBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    nearScreen()

    render(<MessageImageDisplay images={[{ ...image, id: 7, base64: "" }]} />)

    expect(screen.queryByAltText("photo.png")).toBeNull()
    await waitFor(() =>
      expect(screen.getByAltText("photo.png").getAttribute("src")).toBe(
        "blob:image-1"
      )
    )
    expect(mocks.loadImageBytes).toHaveBeenCalledWith(7, "image-1")
  })

  it("releases the object URL when the image unmounts", async () => {
    mocks.loadImageBytes.mockResolvedValue(new Uint8Array([1]))
    nearScreen()
    const { unmount } = render(
      <MessageImageDisplay images={[{ ...image, id: 7, base64: "" }]} />
    )
    await waitFor(() => expect(screen.getByAltText("photo.png")).toBeTruthy())

    unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-1")
  })

  it("says so when a stored image cannot be read and reads it again on retry", async () => {
    mocks.loadImageBytes
      .mockRejectedValueOnce(new Error("owner timed out"))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
    nearScreen()

    render(<MessageImageDisplay images={[{ ...image, id: 7, base64: "" }]} />)

    await waitFor(() =>
      expect(screen.getByText("chat.message.images.unavailable")).toBeTruthy()
    )
    expect(screen.queryByAltText("photo.png")).toBeNull()

    fireEvent.click(
      screen.getByRole("button", {
        name: "chat.message.images.retry_named"
      })
    )

    await waitFor(() =>
      expect(screen.getByAltText("photo.png").getAttribute("src")).toBe(
        "blob:image-1"
      )
    )
    expect(mocks.loadImageBytes).toHaveBeenCalledTimes(2)
  })

  it("treats stored bytes that are gone as a failure too", async () => {
    mocks.loadImageBytes.mockResolvedValue(undefined)
    nearScreen()

    render(<MessageImageDisplay images={[{ ...image, id: 7, base64: "" }]} />)

    await waitFor(() =>
      expect(screen.getByText("chat.message.images.unavailable")).toBeTruthy()
    )
  })
})
