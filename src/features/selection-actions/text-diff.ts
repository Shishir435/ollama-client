export interface TextChange {
  kind: "equal" | "removed" | "added"
  text: string
}

/** Segment words and punctuation in scripts without spaces, preserving every source character. */
const tokenize = (text: string): string[] =>
  typeof Intl.Segmenter === "function"
    ? Array.from(
        new Intl.Segmenter(undefined, { granularity: "word" }).segment(text),
        (part) => part.segment
      )
    : (text.match(/\s+|[^\s]+/gu) ?? [])

/** Word comparison with a bounded LCS grid; large rewrites use one changed span. */
export function compareSelectionText(
  original: string,
  proposed: string
): TextChange[] {
  const before = tokenize(original)
  const after = tokenize(proposed)
  let start = 0
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++
  let endBefore = before.length
  let endAfter = after.length
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--
    endAfter--
  }
  const changes: TextChange[] = []
  const append = (kind: TextChange["kind"], text: string) => {
    if (!text) return
    const last = changes.at(-1)
    if (last?.kind === kind) last.text += text
    else changes.push({ kind, text })
  }
  append("equal", before.slice(0, start).join(""))
  const rows = endBefore - start
  const columns = endAfter - start
  if ((rows + 1) * (columns + 1) > 160_000) {
    append("removed", before.slice(start, endBefore).join(""))
    append("added", after.slice(start, endAfter).join(""))
  } else {
    const stride = columns + 1
    const grid = new Uint32Array((rows + 1) * stride)
    for (let row = rows - 1; row >= 0; row--) {
      for (let column = columns - 1; column >= 0; column--) {
        grid[row * stride + column] =
          before[start + row] === after[start + column]
            ? 1 + grid[(row + 1) * stride + column + 1]
            : Math.max(
                grid[(row + 1) * stride + column],
                grid[row * stride + column + 1]
              )
      }
    }
    let row = 0
    let column = 0
    while (row < rows || column < columns) {
      if (
        row < rows &&
        column < columns &&
        before[start + row] === after[start + column]
      ) {
        append("equal", before[start + row++])
        column++
      } else if (
        row < rows &&
        (column === columns ||
          grid[(row + 1) * stride + column] >= grid[row * stride + column + 1])
      ) {
        append("removed", before[start + row++])
      } else {
        append("added", after[start + column++])
      }
    }
  }
  append("equal", before.slice(endBefore).join(""))
  return changes
}
