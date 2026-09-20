/**
 * The one reading of an editor's text that every side agrees on.
 *
 * A rich-text editor's document is markup: paragraphs, soft breaks, trailing
 * `<br>` placeholders, non-breaking spaces where a user typed two. The page
 * reports it as text, the resolver computes what the text should become, and
 * the verifier compares the two — so all three have to flatten the markup the
 * same way, or a paragraph the editor rendered as `<p>` on one read and
 * `<div>` on the next reads as a change nobody made. No DOM here: this is the
 * string rule, and the page-side walk that produces the raw text is separate.
 */

/**
 * Lines are trimmed and their inner whitespace collapsed, and empty lines are
 * dropped. Paragraph structure survives as single line breaks; the exact
 * number of blank lines between paragraphs does not, because editors disagree
 * about it and the model cannot see the difference either.
 */
export const normalizeAgentEditorText = (text: string): string =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replaceAll(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")

/** How many times `find` occurs in `text`, non-overlapping, exactly. */
export const countAgentTextOccurrences = (
  text: string,
  find: string
): number => {
  if (!find) return 0
  let count = 0
  let from = 0
  for (;;) {
    const index = text.indexOf(find, from)
    if (index < 0) return count
    count += 1
    from = index + find.length
  }
}

/**
 * The value after replacing the single occurrence of `find`, or nothing when
 * the occurrence is not single. Callers decide whether "nothing" is a refusal
 * or a stale target; this only answers whether the edit is well defined.
 */
export const replaceAgentTextOnce = (
  value: string,
  find: string,
  text: string
): string | undefined => {
  if (countAgentTextOccurrences(value, find) !== 1) return undefined
  const index = value.indexOf(find)
  return `${value.slice(0, index)}${text}${value.slice(index + find.length)}`
}
