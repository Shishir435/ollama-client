/**
 * Child documents that take their origin from the frame that created them.
 *
 * A `srcdoc` panel and a script-written `about:blank` frame — the shape of
 * most in-page rich-text editors and embedded previews — have no origin in
 * their address: `new URL("about:srcdoc").origin` is `"null"`. The browser
 * gives them their creator's origin instead, and that is the origin the run's
 * allowlist, the user's exclusions and every check after them are asked
 * about. The document's own origin is `window.origin`, not `location.origin`,
 * which is derived from the address and reads `"null"` for `about:srcdoc`.
 * A sandboxed frame without `allow-same-origin` really is opaque and reports
 * `"null"` from `window.origin` too; it stays unread. A script-written
 * `about:blank` document takes its creator's address when written, so it
 * reads as an ordinary http(s) document from the inside.
 */
export const inheritsFrameOrigin = (url: string): boolean =>
  url === "about:srcdoc" || url === "about:blank"

/** Maximum parent links an inheriting frame may traverse to find its origin. */
export const MAX_INHERITING_FRAME_ANCESTORS = 4

/** An http(s) origin, or undefined for anything else, `"null"` included. */
export const httpOrigin = (origin: string | undefined): string | undefined => {
  if (!origin || origin === "null") return undefined
  try {
    const parsed = new URL(origin)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : undefined
  } catch {
    return undefined
  }
}

interface FrameAddress {
  url: string
  parentFrameId?: number
}

/**
 * The address a frame's readability is judged by. An inheriting child is its
 * creator's document as far as the user's exclusions go, so the nearest
 * ancestor with a real address answers for it — an excluded site's editor
 * iframe is the excluded site. Bounded; a chain that never reaches an address
 * answers with the frame's own, which no classifier reads as readable.
 */
export const frameAccessUrl = async (
  frame: FrameAddress,
  parentOf: (frameId: number) => Promise<FrameAddress | null | undefined>
): Promise<string> => {
  let current: FrameAddress | null | undefined = frame
  // Inspect the frame itself plus up to four parents. The selector admits
  // panels four inheriting levels below an addressed document, so the access
  // check must inspect that root after visiting the four child documents.
  for (
    let depth = 0;
    depth <= MAX_INHERITING_FRAME_ANCESTORS && current;
    depth += 1
  ) {
    if (!inheritsFrameOrigin(current.url)) return current.url
    const parent: number | undefined = current.parentFrameId
    if (parent === undefined || parent < 0) break
    current = await parentOf(parent)
  }
  return frame.url
}
