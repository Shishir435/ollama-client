import { render, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PROVIDER_BRANDS } from "@/lib/providers/provider-brand"
import { ProviderId } from "@/lib/providers/types"
import { PROVIDER_BRAND_ICONS } from "../provider-brand-icons"
import { ProviderIcon } from "../provider-icon"

const paths = (container: HTMLElement) =>
  container.querySelectorAll("svg path").length

describe("PROVIDER_BRAND_ICONS", () => {
  it("has a mark for every declared brand", () => {
    for (const brand of PROVIDER_BRANDS) {
      expect(PROVIDER_BRAND_ICONS[brand]).toBeTypeOf("function")
    }
  })

  it("draws every mark as monochrome currentColor on a 24x24 grid", () => {
    for (const brand of PROVIDER_BRANDS) {
      const Icon = PROVIDER_BRAND_ICONS[brand]
      const { container, unmount } = render(<Icon className="icon-md" />)
      const svg = container.querySelector("svg")
      expect(svg, brand).not.toBeNull()
      expect(svg?.getAttribute("viewBox"), brand).toBe("0 0 24 24")
      expect(svg?.getAttribute("fill"), brand).toBe("currentColor")
      expect(svg?.innerHTML, brand).not.toContain("#")
      expect(paths(container), brand).toBeGreaterThan(0)
      unmount()
    }
  })
})

describe("ProviderIcon", () => {
  /*
   * The marks load as their own chunk, so every assertion about one has to wait
   * for that chunk rather than read the first frame.
   */
  it("renders the built-in provider's own mark", async () => {
    const { container } = render(
      <ProviderIcon providerId={ProviderId.OLLAMA} />
    )
    await waitFor(() => {
      expect(paths(container)).toBeGreaterThan(0)
    })
  })

  it("renders the brand passed for a custom provider", async () => {
    const { container } = render(
      <ProviderIcon
        providerId="custom:openai:abc"
        brand="deepseek"
        fallbackName="Work"
      />
    )
    const { container: expected } = render(
      <PROVIDER_BRAND_ICONS.deepseek className="" />
    )
    await waitFor(() => {
      expect(container.querySelector("path")?.getAttribute("d")).toBe(
        expected.querySelector("path")?.getAttribute("d")
      )
    })
  })

  it("desaturates a fetched favicon so it matches the monochrome glyphs", () => {
    const { container } = render(
      <ProviderIcon
        providerId="custom:openai:abc"
        iconUrl="data:image/png;base64,AAAA"
        fallbackName="Gateway"
        className="icon-sm"
      />
    )
    const img = container.querySelector("img")
    expect(img?.getAttribute("class")).toContain("grayscale")
    expect(img?.getAttribute("class")).toContain("icon-sm")
  })

  it("prefers a curated mark over a fetched favicon", async () => {
    const { container } = render(
      <ProviderIcon
        providerId="custom:openai:abc"
        brand="deepseek"
        iconUrl="data:image/png;base64,AAAA"
      />
    )
    await waitFor(() => {
      expect(container.querySelector("svg")).not.toBeNull()
    })
    expect(container.querySelector("img")).toBeNull()
  })

  it("falls back to the registry glyph for an unknown brand", () => {
    const { container } = render(
      <ProviderIcon
        providerId="custom:openai:abc"
        brand="not-a-brand"
        fallbackName="Home server"
        className="icon-sm"
      />
    )
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("class")).toContain("icon-sm")
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24")
  })

  it("passes its className through to the mark", async () => {
    const { container } = render(
      <ProviderIcon providerId={ProviderId.OLLAMA} className="icon-md" />
    )
    await waitFor(() => {
      expect(container.querySelector("svg")?.getAttribute("class")).toBe(
        "icon-md"
      )
    })
  })
})
