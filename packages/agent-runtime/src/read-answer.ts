/**
 * The identity of a read answer the runtime accepted, kept on a durable read
 * proof instead of the answer itself.
 *
 * A proof established one answer. A later outcome under the same id carries
 * the proof's authority only when it states that same answer; anything else
 * is a new claim and is judged again. The digest compares whole answers,
 * top-level statement and every item, after only whitespace and Unicode
 * compatibility are folded: a changed selection, value, record or letter case
 * ("AC17" is not "ac17") is a different answer even when it reuses the
 * proof's quotation.
 */
export const agentReadAnswerDigest = (claim: {
  evidence?: string
  items?: readonly { index: number; met: boolean; evidence?: string }[]
}): string | undefined => {
  const fold = (text: string | undefined) =>
    (text ?? "").normalize("NFKC").replaceAll(/\s+/g, " ").trim()
  const summary = fold(claim.evidence)
  /**
   * A top-level statement that repeats the sole item adds nothing, so the
   * outcome and item forms of a lone answer digest alike. With several
   * items, choosing which answer to repeat can change the claim.
   */
  const answer = claim.items?.length
    ? [
        claim.items.length === 1 && fold(claim.items[0].evidence) === summary
          ? ""
          : summary,
        ...[...claim.items]
          .sort((left, right) => left.index - right.index)
          .map(
            (item) => `${item.index}:${item.met ? 1 : 0}:${fold(item.evidence)}`
          )
      ].join("\u0000")
    : summary
  if (
    !answer ||
    (claim.items?.length && claim.items.every((item) => !fold(item.evidence)))
  )
    return undefined
  /**
   * cyrb53: a 53-bit non-cryptographic digest. It only has to tell one
   * model answer from another; nothing secret is derived from it.
   */
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < answer.length; index++) {
    const code = answer.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  // Earlier fingerprints folded case and omitted some top-level statements.
  // Their format must not authorize an answer under the stricter rules.
  return `v2:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`
}
