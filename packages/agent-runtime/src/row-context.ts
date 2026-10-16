/**
 * What a row says besides the control's own label.
 *
 * Row context is the rendered text of the list item or table row a control
 * sits in, and that text includes the control: a Delete button's row reads
 * "old-report-2023.pdf Delete", so "Delete — old-report-2023.pdf Delete"
 * named the button twice and made the file harder to spot. The label is
 * removed once, as a whole word, and nothing else is rewritten; a row that is
 * nothing but the label says nothing more and is dropped.
 */
export const agentRowContextBeyond = (
  name: string | undefined,
  rowContext: string | undefined
): string | undefined => {
  const row = rowContext?.trim()
  if (!row) return undefined
  const label = name?.trim()
  if (!label) return row
  const escaped = label.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const rest = row
    .replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`), " ")
    .replaceAll(/\s+/g, " ")
    .trim()
  return rest && rest !== label ? rest : undefined
}

const RECORD_WORD_CHARACTER = /[\p{L}\p{N}_]/u

/**
 * Whether row text names a record as a whole phrase, ignoring case and
 * spacing: "Invoice B" is named by "Invoice B · $40 · Mark paid" and not by
 * "Invoice B2".
 */
export const agentTextNamesRecord = (
  text: string | undefined,
  record: string
): boolean => {
  const haystack = text?.toLocaleLowerCase().replaceAll(/\s+/g, " ").trim()
  const needle = record.toLocaleLowerCase().replaceAll(/\s+/g, " ").trim()
  if (!haystack || !needle) return false
  let start = haystack.indexOf(needle)
  while (start !== -1) {
    const before = haystack[start - 1]
    const after = haystack[start + needle.length]
    if (
      (before === undefined || !RECORD_WORD_CHARACTER.test(before)) &&
      (after === undefined || !RECORD_WORD_CHARACTER.test(after))
    )
      return true
    start = haystack.indexOf(needle, start + 1)
  }
  return false
}

/**
 * Which of the records a control's own row names. Only a row counts: a
 * control outside any list or table names no record, whatever its label
 * says, because a label alone cannot tell two records' buttons apart.
 */
export const agentRowRecords = (
  target: { rowContext?: string } | undefined,
  records: readonly string[]
): string[] =>
  target?.rowContext
    ? records.filter((record) =>
        agentTextNamesRecord(target.rowContext, record)
      )
    : []
