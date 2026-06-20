export const normalizeSettingsSearchText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = Array.from({ length: b.length + 1 }, () => 0)

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      )
    }
    ;[previous, current] = [current, previous]
  }

  return previous[b.length]
}

const fuzzyThreshold = (token: string): number => {
  if (token.length < 3) return 0
  if (token.length <= 5) return 1
  return 2
}

export const scoreSettingsSearchToken = (
  token: string,
  haystack: string,
  words: string[]
): number => {
  if (words.includes(token)) return 40
  if (words.some((word) => word.startsWith(token))) return 28
  if (haystack.includes(token)) return 20

  const threshold = fuzzyThreshold(token)
  if (threshold === 0) return 0

  const hasFuzzyWord = words.some(
    (word) =>
      Math.abs(word.length - token.length) <= threshold &&
      levenshteinDistance(token, word) <= threshold
  )

  return hasFuzzyWord ? 8 : 0
}
