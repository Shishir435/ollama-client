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
