export type ThinkingParserState = {
  inThinking: boolean
  pending: string
}

export const makeThinkingParserState = (): ThinkingParserState => ({
  inThinking: false,
  pending: ""
})

const THINK_OPEN_TAGS = ["<think>", "<thinking>", "<reasoning>"]
const THINK_CLOSE_TAGS = ["</think>", "</thinking>", "</reasoning>"]
const MAX_TAG_LENGTH = Math.max(
  ...THINK_OPEN_TAGS.map((tag) => tag.length),
  ...THINK_CLOSE_TAGS.map((tag) => tag.length)
)

const findTag = (text: string, tags: string[]) => {
  let foundIndex = -1
  let foundTag = ""
  for (const tag of tags) {
    const index = text.indexOf(tag)
    if (index === -1) continue
    if (foundIndex === -1 || index < foundIndex) {
      foundIndex = index
      foundTag = tag
    }
  }
  return foundIndex === -1 ? null : { index: foundIndex, tag: foundTag }
}

const splitPartialTag = (text: string, tags: string[]) => {
  const maxCheck = Math.min(MAX_TAG_LENGTH - 1, text.length)
  for (let length = maxCheck; length > 0; length -= 1) {
    const tail = text.slice(-length)
    if (tags.some((tag) => tag.startsWith(tail))) {
      return { chunk: text.slice(0, -length), pending: tail }
    }
  }
  return { chunk: text, pending: "" }
}

export const splitThinkingDelta = (
  delta: string,
  state: ThinkingParserState
): { visible: string; thinking: string } => {
  let text = `${state.pending}${delta}`
  state.pending = ""

  if (!state.inThinking && !text.includes("<")) {
    return { visible: text, thinking: "" }
  }

  let visible = ""
  let thinking = ""

  while (text.length > 0) {
    if (state.inThinking) {
      const closeMatch = findTag(text, THINK_CLOSE_TAGS)
      if (!closeMatch) {
        const { chunk, pending } = splitPartialTag(text, THINK_CLOSE_TAGS)
        thinking += chunk
        state.pending = pending
        break
      }
      thinking += text.slice(0, closeMatch.index)
      text = text.slice(closeMatch.index + closeMatch.tag.length)
      state.inThinking = false
      continue
    }

    const openMatch = findTag(text, THINK_OPEN_TAGS)
    if (!openMatch) {
      const { chunk, pending } = splitPartialTag(text, THINK_OPEN_TAGS)
      visible += chunk
      state.pending = pending
      break
    }

    visible += text.slice(0, openMatch.index)
    text = text.slice(openMatch.index + openMatch.tag.length)
    state.inThinking = true
  }

  return { visible, thinking }
}
