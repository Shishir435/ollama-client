/**
 * Agent DOM actions — imported from the main content script.
 * Registers a runtime.onMessage listener to handle agent browser actions.
 */
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { AgentAction, AgentActionResult, InteractiveElement } from "@/lib/agent/types"
import {
  findElementByRefId,
  generateAccessibilityTree,
  getRefIdForElement
} from "@/lib/agent/accessibility-tree"

const MAX_ELEMENTS = 150

// ─── DOM Inspection ──────────────────────────────────────────────────────────

export const getInteractiveElements = (): InteractiveElement[] => {
  const selectors = [
    "button:not([disabled])",
    "a[href]",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "[role='button']:not([disabled])",
    "[role='link']",
    "[role='menuitem']",
    "[role='tab']",
    "video",
    "iframe",
    "[onclick]",
    "[tabindex='0']"
  ]

  const seen = new Set<Element>()
  const elements: InteractiveElement[] = []

  for (const selector of selectors) {
    if (elements.length >= MAX_ELEMENTS) break
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector))

    for (const el of nodes) {
      if (seen.has(el) || elements.length >= MAX_ELEMENTS) break
      seen.add(el)

      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue

      const style = window.getComputedStyle(el)
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      )
        continue

      const tagName = el.tagName.toLowerCase()
      let type: InteractiveElement["type"] = "other"
      if (tagName === "button" || el.getAttribute("role") === "button")
        type = "button"
      else if (tagName === "a") type = "link"
      else if (tagName === "input") type = "input"
      else if (tagName === "select") type = "select"
      else if (tagName === "textarea") type = "textarea"
      else if (tagName === "video") type = "video" as any
      else if (tagName === "iframe") type = "iframe" as any

      const text = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.innerText ||
        (el as HTMLInputElement).value ||
        el.getAttribute("alt") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80)

      const id = getRefIdForElement(el)

      const item: InteractiveElement = {
        id,
        type,
        text,
        visible: true,
        disabled: (el as HTMLButtonElement).disabled || false
      }

      if (tagName === "a") item.href = (el as HTMLAnchorElement).href
      if (tagName === "input" || tagName === "textarea") {
        item.placeholder = (el as HTMLInputElement).placeholder
        item.value = (el as HTMLInputElement).value
      }
      if (tagName === "select") {
        item.options = Array.from((el as HTMLSelectElement).options).map(
          (o) => o.text
        )
      }

      elements.push(item)
    }
  }

  return elements
}

// ─── Element Lookup ───────────────────────────────────────────────────────────

const findElementById = (id: number | string): HTMLElement | null => {
  // Try ref_id first (accessibility tree style)
  if (typeof id === "string" && id.startsWith("ref_")) {
    return findElementByRefId(id) as HTMLElement | null
  }
  // Fall back to data-agent-id attribute (legacy numeric IDs)
  return document.querySelector<HTMLElement>(`[data-agent-id="${id}"]`)
}

const isTextEntryElement = (
  el: Element | null | undefined
): el is HTMLInputElement | HTMLTextAreaElement => {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  return tag === "input" || tag === "textarea"
}

const isSearchLikeInput = (
  el: HTMLInputElement | HTMLTextAreaElement
): boolean => {
  const haystack = [
    el.getAttribute("type") || "",
    el.getAttribute("name") || "",
    el.getAttribute("role") || "",
    el.getAttribute("aria-label") || "",
    el.getAttribute("placeholder") || ""
  ]
    .join(" ")
    .toLowerCase()

  return /search|query|\bq\b/.test(haystack)
}

const clickSearchSubmitControl = (
  source: HTMLInputElement | HTMLTextAreaElement
): boolean => {
  const scope = source.form || document
  const candidates = Array.from(
    scope.querySelectorAll<HTMLElement>(
      "button, input[type='submit'], [role='button']"
    )
  )

  const submitControl = candidates.find((candidate) => {
    const text = [
      candidate.getAttribute("aria-label") || "",
      candidate.getAttribute("name") || "",
      candidate.textContent || "",
      (candidate as HTMLInputElement).value || ""
    ]
      .join(" ")
      .toLowerCase()

    return /search|google search|cerca|submit/.test(text)
  })

  if (!submitControl) return false
  submitControl.click()
  return true
}

const focusElementById = (elementId?: number | string): HTMLElement | null => {
  if (elementId === undefined) return null
  const el = findElementById(elementId)
  if (!el) return null
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  el.focus()
  return el
}

// ─── Actions ─────────────────────────────────────────────────────────────────

const clickElement = async (
  elementId: number | string
): Promise<AgentActionResult> => {
  const el = findElementById(elementId)
  if (!el)
    return {
      success: false,
      message: `Element #${elementId} not found. Call get_interactive_elements to refresh the list.`
    }

  try {
    if (el.tagName.toLowerCase() === "video") {
      const video = el as HTMLVideoElement
      if (video.paused) {
        const playback = await attemptVideoPlayback(video)
        if (!playback.success) {
          throw playback.error
        }
      } else {
        video.pause()
      }
      return { success: true, message: `Toggled playback for video #${elementId}` }
    }

    el.scrollIntoView({ behavior: "smooth", block: "center" })
    el.focus()
    el.click()
    const label = (
      el.getAttribute("aria-label") ||
      el.innerText ||
      ""
    )
      .trim()
      .slice(0, 40)
    return {
      success: true,
      message: `Clicked element #${elementId}${label ? `: "${label}"` : ""}`
    }
  } catch (err) {
    return {
      success: false,
      message: `Click failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

const fillInput = (elementId: number | string, value: string): AgentActionResult => {
  const el = findElementById(elementId)
  if (!el)
    return { success: false, message: `Element #${elementId} not found.` }

  const tag = el.tagName.toLowerCase()
  if (!["input", "textarea"].includes(tag))
    return {
      success: false,
      message: `Element #${elementId} is a <${tag}>, not an input or textarea.`
    }

  try {
    const input = el as HTMLInputElement | HTMLTextAreaElement
    input.focus()

    // Use native setter to bypass React's controlled-component detection
    const proto =
      tag === "textarea"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    nativeSetter?.call(input, value)
    input.value = value

    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "End", bubbles: true }))

    return {
      success: true,
      message: `Filled element #${elementId} with "${value.slice(0, 40)}"`
    }
  } catch (err) {
    return {
      success: false,
      message: `Fill failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

const selectOption = (elementId: number | string, value: string): AgentActionResult => {
  const el = findElementById(elementId)
  if (!el)
    return { success: false, message: `Element #${elementId} not found.` }

  if (el.tagName.toLowerCase() !== "select")
    return { success: false, message: `Element #${elementId} is not a <select>.` }

  const select = el as HTMLSelectElement
  const option = Array.from(select.options).find(
    (o) => o.value === value || o.text === value
  )
  if (!option)
    return {
      success: false,
      message: `Option "${value}" not found. Available: ${Array.from(select.options)
        .map((o) => o.text)
        .slice(0, 5)
        .join(", ")}`
    }

  select.value = option.value
  select.dispatchEvent(new Event("change", { bubbles: true }))
  return {
    success: true,
    message: `Selected "${option.text}" in element #${elementId}`
  }
}

const scrollPage = (
  direction: "up" | "down",
  amount = 400
): AgentActionResult => {
  const scrollAmount = direction === "down" ? amount : -amount
  window.scrollBy({ top: scrollAmount, behavior: "smooth" })
  return {
    success: true,
    message: `Scrolled ${direction} by ${Math.abs(scrollAmount)}px. Page scroll: ${window.scrollY}px`
  }
}

const getPageText = (): AgentActionResult => {
  const text = (document.body?.innerText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000)
  return { success: true, message: text || "No readable text content found." }
}

const copyTextToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  document.execCommand("copy")
  textarea.remove()
}

const getElementText = (elementId?: number | string): string => {
  if (elementId === undefined) {
    return (document.body?.innerText || "").replace(/\s+/g, " ").trim()
  }

  const el = findElementById(elementId)
  if (!el) return ""

  return (
    el.getAttribute("aria-label") ||
    el.textContent ||
    (el as HTMLInputElement).value ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
}

const getLinkUrl = (elementId: number | string): string | null => {
  const el = findElementById(elementId)
  if (!el) return null

  const link = (el.closest("a[href]") || (el.matches("a[href]") ? el : null)) as
    | HTMLAnchorElement
    | null

  return link?.href || null
}

const findTargetVideo = (elementId?: number | string): HTMLVideoElement | null => {
  if (elementId !== undefined) {
    const specific = findElementById(elementId)
    if (specific instanceof HTMLVideoElement) return specific
  }

  const videos = Array.from(document.querySelectorAll("video"))
  return (
    videos.find((video) => {
      const rect = video.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }) ||
    videos[0] ||
    null
  )
}

const dispatchPointerSequence = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  const clientX = rect.left + Math.min(rect.width / 2, 8)
  const clientY = rect.top + Math.min(rect.height / 2, 8)
  const pointerInit: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    pointerType: "mouse",
    isPrimary: true,
    clientX,
    clientY
  }
  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY
  }

  element.dispatchEvent(new PointerEvent("pointerdown", pointerInit))
  element.dispatchEvent(new MouseEvent("mousedown", mouseInit))
  element.dispatchEvent(new PointerEvent("pointerup", pointerInit))
  element.dispatchEvent(new MouseEvent("mouseup", mouseInit))
  element.dispatchEvent(new MouseEvent("click", mouseInit))
}

const playVideoWithTimeout = async (
  video: HTMLVideoElement,
  timeoutMs = 5000
) => {
  await Promise.race([
    video.play(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`video.play() timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ])
}

const attemptVideoPlayback = async (
  video: HTMLVideoElement
): Promise<{ success: true } | { success: false; error: unknown }> => {
  const attempts: Array<() => Promise<void>> = [
    async () => {
      video.muted = true
      await playVideoWithTimeout(video)
    },
    async () => {
      video.scrollIntoView({ behavior: "smooth", block: "center" })
      video.focus()
      dispatchPointerSequence(video)
      await new Promise((resolve) => setTimeout(resolve, 150))
      video.muted = true
      await playVideoWithTimeout(video)
    },
    async () => {
      const clickableParent = video.closest<HTMLElement>(
        "[role='button'], button, .plyr, .vjs-big-play-button, .mejs-overlay-button, .jw-display-icon-container, .jwplayer"
      )
      if (clickableParent) {
        clickableParent.scrollIntoView({ behavior: "smooth", block: "center" })
        clickableParent.focus()
        dispatchPointerSequence(clickableParent)
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      video.muted = true
      await playVideoWithTimeout(video)
    }
  ]

  let lastError: unknown = null
  for (const attempt of attempts) {
    try {
      await attempt()
      if (!video.paused) return { success: true }
    } catch (error) {
      lastError = error
    }
  }

  return { success: false, error: lastError }
}

const isVideoEffectivelyComplete = (video: HTMLVideoElement): boolean => {
  const duration = Number.isFinite(video.duration) ? video.duration : 0
  return (
    video.ended ||
    (duration > 0 && video.currentTime >= Math.max(0, duration - 1))
  )
}

const getPlaybackState = (video: HTMLVideoElement) => {
  const duration = Number.isFinite(video.duration) ? video.duration : 0
  return {
    ended: video.ended,
    paused: video.paused,
    currentTime: Math.round(video.currentTime),
    duration: duration > 0 ? Math.round(duration) : null
  }
}

const candidateText = (element: Element): string => {
  return [
    element.getAttribute("aria-label") || "",
    element.getAttribute("title") || "",
    element.textContent || ""
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

const isVisibleElement = (element: HTMLElement): boolean => {
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  const style = window.getComputedStyle(element)
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  )
}

const clickCandidate = async (element: HTMLElement): Promise<boolean> => {
  if (!isVisibleElement(element)) return false
  element.scrollIntoView({ behavior: "smooth", block: "center" })
  element.focus()
  dispatchPointerSequence(element)
  await new Promise((resolve) => setTimeout(resolve, 250))
  return true
}

const advanceToNextVideo = async (): Promise<AgentActionResult> => {
  const explicitCandidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, a[href], [role='button'], [role='link'], li, [tabindex='0']"
    )
  )

  const nextButton = explicitCandidates.find((element) => {
    const text = candidateText(element)
    return /next|continue|continue watching|successivo|prossim|avanti|lezione successiva|video successivo/.test(
      text
    )
  })

  if (nextButton && (await clickCandidate(nextButton))) {
    return {
      success: true,
      message: `Advanced using next control: ${candidateText(nextButton).slice(0, 80)}`
    }
  }

  const activeItem =
    document.querySelector<HTMLElement>(
      ".active, .current, .selected, [aria-current='true'], [aria-selected='true']"
    ) || null

  if (activeItem) {
    const siblingCandidates = Array.from(
      activeItem.parentElement?.children || []
    ).filter((node): node is HTMLElement => node instanceof HTMLElement)

    const activeIndex = siblingCandidates.findIndex((node) => node === activeItem)
    const nextSibling = siblingCandidates
      .slice(activeIndex + 1)
      .find((node) => isVisibleElement(node))

    const clickableNext = nextSibling?.querySelector<HTMLElement>(
      "button, a[href], [role='button'], [role='link'], [tabindex='0']"
    ) || nextSibling

    if (clickableNext && (await clickCandidate(clickableNext))) {
      return {
        success: true,
        message: `Advanced to the next lesson item: ${candidateText(clickableNext).slice(0, 80)}`
      }
    }
  }

  const lessonCandidates = explicitCandidates.filter((element) => {
    const text = candidateText(element)
    return /video|lesson|lezione|modulo|unità|unita/.test(text)
  })

  if (lessonCandidates.length > 1) {
    const firstUntouched = lessonCandidates.find((element) => {
      const classes = element.className.toLowerCase()
      return !/active|current|selected|completed|done|watched/.test(classes)
    })

    if (firstUntouched && (await clickCandidate(firstUntouched))) {
      return {
        success: true,
        message: `Advanced to another lesson candidate: ${candidateText(firstUntouched).slice(0, 80)}`
      }
    }
  }

  return {
    success: false,
    message:
      "Could not find a next lesson or video control. Inspect the lesson panel and try a more specific click."
  }
}

const controlVideo = async (
  state: "play" | "pause" | "toggle",
  elementId?: number | string
): Promise<AgentActionResult> => {
  const video = findTargetVideo(elementId)
  if (!video) {
    return {
      success: false,
      message: elementId
        ? `Video #${elementId} not found.`
        : "No visible video element found on the page."
    }
  }

  try {
    const shouldPlay =
      state === "play" || (state === "toggle" && video.paused)

    if (shouldPlay) {
      const playback = await attemptVideoPlayback(video)
      if (!playback.success) {
        const detail =
          playback.error instanceof Error
            ? playback.error.message
            : String(playback.error)
        return {
          success: false,
          message:
            "Video control failed after play(), click, and focus retries. " +
            detail
        }
      }
    } else if (!video.paused) {
      video.pause()
    }

    return {
      success: true,
      message: `Video playback set to ${video.paused ? "paused" : "playing"}.`
    }
  } catch (error) {
    return {
      success: false,
      message: `Video control failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

const pressKey = async (
  keyValue: string,
  elementId?: number | string
): Promise<AgentActionResult> => {
  try {
    const explicitTarget = focusElementById(elementId)
    const target = explicitTarget || document.activeElement || document.body
    const keyMap: Record<string, string> = {
      space: " ",
      Space: " ",
      enter: "Enter",
      Enter: "Enter",
      tab: "Tab",
      Tab: "Tab",
      escape: "Escape",
      Escape: "Escape",
      backspace: "Backspace",
      Backspace: "Backspace",
      delete: "Delete",
      Delete: "Delete",
      arrowup: "ArrowUp",
      ArrowUp: "ArrowUp",
      arrowdown: "ArrowDown",
      ArrowDown: "ArrowDown",
      arrowleft: "ArrowLeft",
      ArrowLeft: "ArrowLeft",
      arrowright: "ArrowRight",
      ArrowRight: "ArrowRight",
      f: "f",
      F: "f",
      k: "k",
      K: "k"
    }
    const key = keyMap[keyValue] || keyValue
    const code =
      key === " "
        ? "Space"
        : key.length === 1
          ? `Key${key.toUpperCase()}`
          : key
    const eventInit: KeyboardEventInit = {
      key,
      code,
      bubbles: true,
      cancelable: true
    }

    target.dispatchEvent(new KeyboardEvent("keydown", eventInit))
    target.dispatchEvent(new KeyboardEvent("keypress", eventInit))
    target.dispatchEvent(new KeyboardEvent("keyup", eventInit))

    if (key === "Enter" && isTextEntryElement(target)) {
      const form = target.form || target.closest("form")
      if (form instanceof HTMLFormElement) {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit()
        } else {
          form.submit()
        }
      } else if (isSearchLikeInput(target)) {
        clickSearchSubmitControl(target)
      }
    }

    if (key === " " && target instanceof HTMLVideoElement) {
      if (target.paused) {
        const playback = await attemptVideoPlayback(target)
        if (!playback.success) {
          throw playback.error
        }
      } else {
        target.pause()
      }
    }

    return {
      success: true,
      message: `Pressed key: "${keyValue}"${elementId ? ` on #${elementId}` : ""}`
    }
  } catch (keyErr) {
    return {
      success: false,
      message: `Key press failed: ${keyErr instanceof Error ? keyErr.message : String(keyErr)}`
    }
  }
}

// ─── Vision Mode Set-of-Marks ────────────────────────────────────────────────
let currentMarks: HTMLElement[] = []

const drawMarks = (): AgentActionResult => {
  removeMarks() // Ensure clean slate
  const elements = getInteractiveElements()
  
  elements.forEach((elInfo) => {
    const el = document.querySelector(`[data-agent-id='${elInfo.id}']`) as HTMLElement
    if (!el) return

    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    // Create a bounding box / badge
    const mark = document.createElement("div")
    mark.style.position = "absolute"
    mark.style.left = `${rect.left + window.scrollX}px`
    mark.style.top = `${rect.top + window.scrollY}px`
    mark.style.backgroundColor = "rgba(255, 0, 0, 0.85)"
    mark.style.color = "white"
    mark.style.padding = "1px 4px"
    mark.style.fontSize = "12px"
    mark.style.fontWeight = "bold"
    mark.style.border = "1px solid white"
    mark.style.borderRadius = "3px"
    mark.style.zIndex = "2147483647" // Max z-index
    mark.style.pointerEvents = "none"
    mark.innerText = String(elInfo.id)
    
    document.body.appendChild(mark)
    currentMarks.push(mark)
  })

  return { success: true, message: `Drew marks on ${currentMarks.length} elements.` }
}

const removeMarks = (): AgentActionResult => {
  currentMarks.forEach((m) => m.remove())
  currentMarks = []
  return { success: true, message: "Marks removed." }
}

// ─── Message Dispatcher ───────────────────────────────────────────────────────

export const registerAgentActionListener = () => {
  browser.runtime.onMessage.addListener(
    (
      message: { type: string; payload?: AgentAction },
      _sender,
      sendResponse
    ) => {
      const { type, payload } = message

      if (type === "__agent_ping") {
        sendResponse({ alive: true })
        return true
      }

      if (type === MESSAGE_KEYS.AGENT.DRAW_MARKS) {
        sendResponse(drawMarks())
        return true
      }

      if (type === MESSAGE_KEYS.AGENT.REMOVE_MARKS) {
        sendResponse(removeMarks())
        return true
      }

      if (
        type !== MESSAGE_KEYS.AGENT.EXECUTE_ACTION &&
        type !== MESSAGE_KEYS.AGENT.GET_ELEMENTS &&
        type !== MESSAGE_KEYS.AGENT.GET_PAGE_TEXT &&
        type !== MESSAGE_KEYS.AGENT.READ_PAGE
      ) {
        return // Not an agent message — pass through
      }

      ;(async () => {
        try {
          if (type === MESSAGE_KEYS.AGENT.READ_PAGE) {
            const opts = (message as any).options || {}
            const tree = generateAccessibilityTree(opts)
            sendResponse({
              success: !tree.error,
              message: tree.error || `Accessibility tree: ${tree.elementCount} elements`,
              data: tree
            } as AgentActionResult)
            return
          }

          if (type === MESSAGE_KEYS.AGENT.GET_ELEMENTS) {
            const elements = getInteractiveElements()
            sendResponse({
              success: true,
              message: `Found ${elements.length} interactive elements`,
              data: elements
            } as AgentActionResult)
            return
          }

          if (type === MESSAGE_KEYS.AGENT.GET_PAGE_TEXT) {
            sendResponse(getPageText())
            return
          }

          // EXECUTE_ACTION
          if (!payload) {
            sendResponse({
              success: false,
              message: "No action payload provided."
            } as AgentActionResult)
            return
          }

          let result: AgentActionResult

          switch (payload.type) {
            case "get_interactive_elements": {
              const elements = getInteractiveElements()
              result = {
                success: true,
                message: `Found ${elements.length} elements`,
                data: elements
              }
              break
            }
            case "click_element":
              result = await clickElement(payload.element_id!)
              break
            case "fill_input":
              result = fillInput(payload.element_id!, payload.value!)
              break
            case "select_option":
              result = selectOption(payload.element_id!, payload.value!)
              break
            case "scroll_page":
              result = scrollPage(
                payload.direction!,
                (payload as unknown as { amount?: number }).amount
              )
              break
            case "get_page_content":
              result = getPageText()
              break
            case "get_video_status": {
              // Returns status of all video elements on page
              const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video"))
              if (videos.length === 0) {
                result = { success: true, message: "No native video elements found on this frame." }
              } else {
                const statuses = videos.map((v, i) => ({
                  index: i,
                  paused: v.paused,
                  ended: v.ended,
                  currentTime: Math.round(v.currentTime),
                  duration: Math.round(v.duration) || null,
                  readyState: v.readyState
                }))
                result = { success: true, message: JSON.stringify(statuses), data: statuses }
              }
              break
            }
            case "control_video": {
              const state = (payload.state || "toggle") as "play" | "pause" | "toggle"
              result = await controlVideo(state, payload.element_id)
              break
            }
            case "wait_for_video_end": {
              const timeoutMs = ((payload as any).timeout_ms as number) || 7200000
              const pollInterval = Math.min(2000, Math.max(250, Math.floor(timeoutMs / 10)))
              const start = Date.now()
              const targetVideo = findTargetVideo(payload.element_id)
              if (!targetVideo) {
                result = {
                  success: false,
                  message: payload.element_id
                    ? `Video #${payload.element_id} not found.`
                    : "No visible video element found while waiting for completion."
                }
                break
              }

              let observedPlayback = !targetVideo.paused
              /*
                if (videos.length === 0) return true // No video — assume done
              }
              */
              await new Promise<void>((resolve) => {
                const check = () => {
                  const video = findTargetVideo(payload.element_id)
                  if (!video) {
                    resolve()
                    return
                  }
                  if (!video.paused) {
                    observedPlayback = true
                  }
                  if (isVideoEffectivelyComplete(video) || Date.now() - start > timeoutMs) {
                    resolve()
                  } else {
                    setTimeout(check, pollInterval)
                  }
                }
                check()
              })
              const finalVideo = findTargetVideo(payload.element_id)
              const finalState = finalVideo ? getPlaybackState(finalVideo) : null
              const completed = finalVideo ? isVideoEffectivelyComplete(finalVideo) : false
              result = {
                success: completed,
                message: completed
                  ? "The current video finished playback."
                  : observedPlayback
                    ? `Timed out while waiting for the video to finish. Last state: ${JSON.stringify(finalState)}`
                    : `The video never started playing. Last state: ${JSON.stringify(finalState)}`
              }
              break
            }
            case "advance_to_next_video": {
              result = await advanceToNextVideo()
              break
            }
            case "execute_js": {
              // Execute arbitrary JavaScript in the page context
              const code = (payload as any).code as string
              if (!code) {
                result = { success: false, message: "No code provided for execute_js." }
              } else {
                try {
                  // Use Function constructor to execute in page context
                  const fn = new Function(code)
                  const returnValue = await fn()
                  const output = returnValue !== undefined ? JSON.stringify(returnValue) : "(no return value)"
                  result = { success: true, message: `JS executed. Result: ${String(output).slice(0, 500)}` }
                } catch (jsErr) {
                  result = { success: false, message: `JS error: ${jsErr instanceof Error ? jsErr.message : String(jsErr)}` }
                }
              }
              break
            }
            case "press_key": {
              const keyValue = (payload as any).key as string || (payload as any).value as string
              if (!keyValue) {
                result = { success: false, message: "No key specified for press_key." }
              } else {
                result = pressKey(keyValue, payload.element_id)
                result = await result
              }
              break
            }
            case "hover_element": {
              const hoverEl = findElementById(payload.element_id!)
              if (!hoverEl) {
                result = { success: false, message: `Element #${payload.element_id} not found.` }
              } else {
                hoverEl.scrollIntoView({ behavior: "smooth", block: "center" })
                hoverEl.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
                hoverEl.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
                const label = (hoverEl.getAttribute("aria-label") || hoverEl.innerText || "").trim().slice(0, 40)
                result = { success: true, message: `Hovered element #${payload.element_id}${label ? `: "${label}"` : ""}` }
              }
              break
            }
            case "copy_current_url": {
              try {
                await copyTextToClipboard(window.location.href)
                result = {
                  success: true,
                  message: `Copied current URL: ${window.location.href}`,
                  data: { url: window.location.href }
                }
              } catch (copyErr) {
                result = {
                  success: false,
                  message: `Clipboard copy failed: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}`
                }
              }
              break
            }
            case "copy_link_url": {
              const url = getLinkUrl(payload.element_id!)
              if (!url) {
                result = {
                  success: false,
                  message: `Link URL not found for element #${payload.element_id}.`
                }
              } else {
                try {
                  await copyTextToClipboard(url)
                  result = {
                    success: true,
                    message: `Copied link URL: ${url}`,
                    data: { url }
                  }
                } catch (copyErr) {
                  result = {
                    success: false,
                    message: `Clipboard copy failed: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}`
                  }
                }
              }
              break
            }
            case "copy_page_text": {
              const text = getElementText(payload.element_id)
              if (!text) {
                result = {
                  success: false,
                  message: payload.element_id
                    ? `No readable text found for element #${payload.element_id}.`
                    : "No readable page text found."
                }
              } else {
                try {
                  await copyTextToClipboard(text)
                  result = {
                    success: true,
                    message: `Copied ${Math.min(text.length, 2000)} characters of text to clipboard.`,
                    data: { text }
                  }
                } catch (copyErr) {
                  result = {
                    success: false,
                    message: `Clipboard copy failed: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}`
                  }
                }
              }
              break
            }
            default:
              result = {
                success: false,
                message: `Unknown action type: ${payload.type}`
              }
          }

          sendResponse(result)
        } catch (err) {
          sendResponse({
            success: false,
            message: `Action error: ${err instanceof Error ? err.message : String(err)}`
          } as AgentActionResult)
        }
      })()

      return true // Keep channel open for async response
    }
  )
}
