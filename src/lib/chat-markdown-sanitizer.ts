import DOMPurify from "dompurify"

/** Only explicit network URLs may be offered as an image-loading action. */
export const remoteMarkdownImageUrl = (value: string): string | null => {
  const trimmed = value
    .trim()
    .replace(/[\t\n\r]/g, "")
    .replace(/\\/g, "/")
  if (!/^(https?:|\/\/)/i.test(trimmed)) return null
  try {
    const url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/** Block resource loads before markup reaches either a parser document or React. */
export const sanitizeChatMarkdown = (html: string): string => {
  const safe = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: [
      "style",
      "audio",
      "video",
      "source",
      "image",
      "use",
      "feImage",
      "animate",
      "animateMotion",
      "animateTransform",
      "set"
    ],
    FORBID_ATTR: ["style", "background", "poster"],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel|blob|chrome-extension|moz-extension):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i
  })
  // Template contents are inert: parsing a remote src here cannot fetch it.
  const template = document.createElement("template")
  template.innerHTML = safe
  const fragment = template.content
  for (const element of fragment.querySelectorAll("svg, svg *")) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.localName === "href" || /url\s*\(/i.test(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  for (const element of fragment.querySelectorAll("[src]")) {
    if (element.localName !== "img") element.removeAttribute("src")
  }
  for (const image of fragment.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? ""
    const candidates = image.getAttribute("srcset") ?? ""
    const remoteCandidate = candidates.match(
      /(?:https?:\/\/|\/\/)[^\s,]+/i
    )?.[0]
    const remote =
      remoteMarkdownImageUrl(src) ??
      remoteMarkdownImageUrl(remoteCandidate ?? "") ??
      remoteMarkdownImageUrl(image.getAttribute("data-remote-image-src") ?? "")
    // Keep only image attributes with no alternative resource-loading path.
    for (const attribute of Array.from(image.attributes)) {
      if (
        !["src", "alt", "title", "width", "height", "class"].includes(
          attribute.name
        )
      ) {
        image.removeAttribute(attribute.name)
      }
    }
    if (remote) {
      image.removeAttribute("src")
      image.setAttribute("data-remote-image-src", remote)
    } else if (
      src &&
      !/^(?:data:image\/|blob:|chrome-extension:|moz-extension:|\/[^/]|\.{1,2}\/|[^:/?#]+(?:\/|$))/i.test(
        src
      )
    ) {
      image.removeAttribute("src")
    }
  }
  const container = document.createElement("div")
  container.append(fragment)
  return container.innerHTML
}
