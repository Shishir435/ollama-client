import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const storageBacking = vi.hoisted(() => new Map<string, unknown>())

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => storageBacking.get(key)),
  setPlasmoStoredValue: vi.fn(async (key: string, value: unknown) => {
    storageBacking.set(key, value)
  })
}))

import {
  FAVICON_FOUND_TTL_MS,
  FAVICON_MAX_BYTES,
  FAVICON_MISSING_TTL_MS,
  getProviderFaviconMap,
  isRemoteFaviconHost,
  parentDomainOf,
  resolveProviderFavicon,
  setFaviconLookupEnabled
} from "../provider-favicon"
import { type ProviderConfig, ProviderType } from "../types"

const config = (baseUrl: string): ProviderConfig => ({
  id: "custom:openai:abc",
  type: ProviderType.CUSTOM,
  enabled: true,
  name: "Gateway",
  baseUrl
})

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

const imageResponse = (
  bytes: number[],
  headers: Record<string, string> = {}
): Response =>
  ({
    ok: true,
    status: 200,
    type: "basic",
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => new Uint8Array(bytes).buffer
  }) as unknown as Response

describe("isRemoteFaviconHost", () => {
  it.each([
    "http://localhost:11434",
    "http://127.0.0.1:1234/v1",
    "http://127.5.5.5/v1",
    "http://192.168.1.10:8000/v1",
    "http://10.0.0.5/v1",
    "http://172.16.4.4/v1",
    "http://172.31.255.254/v1",
    "http://100.64.0.1/v1",
    "http://0.0.0.0/v1",
    "http://255.255.255.255/v1",
    "http://224.0.0.1/v1",
    "http://my-box:8080/v1",
    "http://server.local/v1",
    "http://vault.internal/v1",
    "http://box.home.arpa/v1",
    "http://[::1]:8080/v1",
    "http://[fe80::1]/v1",
    "http://[::ffff:127.0.0.1]/v1"
  ])("refuses to probe %s", (baseUrl) => {
    expect(isRemoteFaviconHost(baseUrl)).toBe(false)
  })

  /*
   * 169.254.169.254 is the cloud metadata endpoint. A request carrying
   * <all_urls> reaches what the page cannot, so link-local is not merely a
   * wasted probe.
   */
  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://169.254.0.1/v1"
  ])("refuses link-local %s", (baseUrl) => {
    expect(isRemoteFaviconHost(baseUrl)).toBe(false)
  })

  /*
   * Shorthand, hex and integer forms all name the same address. The URL parser
   * normalizes them to a dotted quad before the filter sees them, which is the
   * only reason a numeric check is sufficient.
   */
  it.each([
    "http://2130706433/v1",
    "http://0x7f.1/v1",
    "http://127.1/v1",
    "http://0177.0.0.1/v1"
  ])("refuses the loopback spelled as %s", (baseUrl) => {
    expect(isRemoteFaviconHost(baseUrl)).toBe(false)
  })

  it.each([
    "https://api.example.com/v1",
    "https://llm.acme.io",
    "http://11.0.0.5/v1",
    "http://172.32.0.1/v1",
    "http://100.63.255.255/v1"
  ])("probes %s", (baseUrl) => {
    expect(isRemoteFaviconHost(baseUrl)).toBe(true)
  })

  /*
   * The parent-site fallback strips a label, which could in principle turn an
   * allowed host into a blocked address. It cannot in practice: a host whose
   * last label is numeric but is not a valid quad fails to parse outright, so
   * no base URL has a private literal for a parent. Asserted because the
   * re-check in the fallback rests on it.
   */
  it.each([
    "http://sub.127.0.0.1/v1",
    "http://1.169.254.169.254/v1"
  ])("cannot even express %s as a host", (baseUrl) => {
    expect(isRemoteFaviconHost(baseUrl)).toBe(false)
  })

  it("refuses a malformed base URL", () => {
    expect(isRemoteFaviconHost("not a url")).toBe(false)
    expect(isRemoteFaviconHost(undefined)).toBe(false)
  })
})

describe("resolveProviderFavicon", () => {
  beforeEach(async () => {
    storageBacking.clear()
    await setFaviconLookupEnabled(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches /favicon.ico from the configured origin only", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(imageResponse([...PNG_MAGIC, 0x00, 0x01]))

    const dataUrl = await resolveProviderFavicon(
      config("https://llm.example.com/v1")
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://llm.example.com/favicon.ico"
    )
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it("never touches the network for a local provider", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    expect(
      await resolveProviderFavicon(config("http://localhost:11434"))
    ).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never touches the network when lookup is off", async () => {
    await setFaviconLookupEnabled(false)
    const fetchMock = vi.spyOn(globalThis, "fetch")
    expect(
      await resolveProviderFavicon(config("https://llm.example.com/v1"))
    ).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /*
   * A server answering 200 with an HTML error page is common enough that the
   * status and Content-Type together are not evidence of an image.
   */
  it("rejects a 200 that is not actually an image", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      imageResponse([0x3c, 0x21, 0x44, 0x4f], { "content-type": "image/png" })
    )
    expect(
      await resolveProviderFavicon(config("https://llm.example.com/v1"))
    ).toBeNull()
  })

  it("rejects an icon larger than the cap", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      imageResponse([...PNG_MAGIC, ...new Array(FAVICON_MAX_BYTES).fill(0)])
    )
    expect(
      await resolveProviderFavicon(config("https://llm.example.com/v1"))
    ).toBeNull()
  })

  it("rejects an oversized icon from its declared length without reading it", async () => {
    const arrayBuffer = vi.fn()
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: { get: () => String(FAVICON_MAX_BYTES + 1) },
      arrayBuffer
    } as unknown as Response)

    expect(
      await resolveProviderFavicon(config("https://llm.example.com/v1"))
    ).toBeNull()
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it("remembers a miss so the endpoint is asked once", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false } as Response)

    const provider = config("https://llm.example.com/v1")
    expect(await resolveProviderFavicon(provider)).toBeNull()
    expect(await resolveProviderFavicon(provider)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("re-asks after a miss ages out, but keeps a hit far longer", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false } as Response)
    const provider = config("https://llm.example.com/v1")

    await resolveProviderFavicon(provider, undefined, 0)
    await resolveProviderFavicon(provider, undefined, FAVICON_MISSING_TTL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const secondAsk = FAVICON_MISSING_TTL_MS + 1
    fetchMock.mockResolvedValue(imageResponse([...PNG_MAGIC, 0x02]))
    await resolveProviderFavicon(provider, undefined, secondAsk)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // A found icon outlives the miss window many times over.
    await resolveProviderFavicon(
      provider,
      undefined,
      secondAsk + FAVICON_MISSING_TTL_MS * 2
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await resolveProviderFavicon(
      provider,
      undefined,
      secondAsk + FAVICON_FOUND_TTL_MS + 1
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("drops a cached icon once the base URL changes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(imageResponse([...PNG_MAGIC, 0x03]))

    await resolveProviderFavicon(config("https://llm.example.com/v1"))
    await resolveProviderFavicon(config("https://other.example.com/v1"))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const stored = await getProviderFaviconMap()
    expect(stored["custom:openai:abc"].signature).toContain("other.example.com")
  })

  /*
   * A gateway that guards every path behind its API key answers 401 to
   * /favicon.ico as readily as to a chat request, so the configured host can be
   * a settled dead end while the vendor's own site has the icon.
   */
  it.each([
    401, 403, 404, 410
  ])("falls back to the parent site when the API host answers %i", async (status) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status } as Response)
      .mockResolvedValueOnce(imageResponse([...PNG_MAGIC, 0x04]))

    const dataUrl = await resolveProviderFavicon(
      config("https://api.acme-router.example/v1")
    )

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.acme-router.example/favicon.ico",
      "https://acme-router.example/favicon.ico"
    ])
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it("falls back when the API host answers 200 with something that is not an image", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(imageResponse([0x3c, 0x21, 0x44, 0x4f]))
      .mockResolvedValueOnce(imageResponse([...PNG_MAGIC, 0x05]))

    expect(
      await resolveProviderFavicon(config("https://api.example.com/v1"))
    ).toMatch(/^data:image\/png;base64,/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    500, 429
  ])("does not chase the parent site after a %i", async (status) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false, status } as Response)

    expect(
      await resolveProviderFavicon(config("https://api.example.com/v1"))
    ).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not chase the parent site after a network failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"))

    expect(
      await resolveProviderFavicon(config("https://api.example.com/v1"))
    ).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("has no parent to try when the configured host is already the site", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false, status: 404 } as Response)

    expect(
      await resolveProviderFavicon(config("https://example.com/v1"))
    ).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("drops the port when asking the parent site", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce(imageResponse([...PNG_MAGIC, 0x06]))

    await resolveProviderFavicon(config("https://api.example.com:8443/v1"))

    expect(fetchMock.mock.calls[1][0]).toBe("https://example.com/favicon.ico")
  })

  /*
   * The host we vetted is not necessarily the host that answers. A provider
   * that redirects /favicon.ico picks the next address itself, and this fetch
   * carries <all_urls> host permission — following one would let a public
   * endpoint aim the extension at loopback or a LAN address.
   */
  it("refuses to follow redirects", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(imageResponse([...PNG_MAGIC, 0x07]))

    await resolveProviderFavicon(config("https://api.example.com/v1"))

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" })
  })

  it("tries the parent site when the API host redirects", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 0,
        type: "opaqueredirect"
      } as Response)
      .mockResolvedValueOnce(imageResponse([...PNG_MAGIC, 0x08]))

    const dataUrl = await resolveProviderFavicon(
      config("https://api.example.com/v1")
    )

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.com/favicon.ico",
      "https://example.com/favicon.ico"
    ])
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  /*
   * A cancelled fetch is indistinguishable from an endpoint with no icon, so
   * recording it would hold the provider iconless for the whole miss window
   * over a request nobody waited for.
   */
  it("writes nothing once the caller has given up", async () => {
    const controller = new AbortController()
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      controller.abort()
      throw new Error("aborted")
    })

    const provider = config("https://api.example.com/v1")
    expect(await resolveProviderFavicon(provider, controller.signal)).toBeNull()

    expect(await getProviderFaviconMap()).toEqual({})
  })

  it("treats a failed request as no icon", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"))
    expect(
      await resolveProviderFavicon(config("https://llm.example.com/v1"))
    ).toBeNull()
  })
})

describe("parentDomainOf", () => {
  it("strips exactly one label", () => {
    expect(parentDomainOf("api.acme-router.example")).toBe(
      "acme-router.example"
    )
    expect(parentDomainOf("api.eu.acme-router.example")).toBe(
      "eu.acme-router.example"
    )
    expect(parentDomainOf("api.example.co.uk")).toBe("example.co.uk")
  })

  it("has no parent for a bare site", () => {
    expect(parentDomainOf("acme-router.example")).toBeUndefined()
  })

  /*
   * `co.uk` belongs to a registry, not to anyone we could be asking for an
   * icon, so stripping down to one is refused rather than requested.
   */
  it("refuses to climb into a public suffix", () => {
    expect(parentDomainOf("example.co.uk")).toBeUndefined()
    expect(parentDomainOf("example.com.au")).toBeUndefined()
  })
})
