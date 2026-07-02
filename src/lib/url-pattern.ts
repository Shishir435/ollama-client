/**
 * Shared, guarded matching for user-authored URL patterns.
 *
 * User patterns reach three matchers (exclusion list, site overrides,
 * per-site profiles). All regex compilation for those goes through
 * `compileSafePattern` so a single pathological pattern cannot hang the
 * content script (catastrophic backtracking) or blow up on compile.
 *
 * Exclusion-style matching is deliberately match-anywhere, not anchored:
 * an exclusion pattern that matches too much reads fewer pages (fail-safe);
 * anchoring would silently narrow user exclusions and fail open.
 */

const MAX_PATTERN_LENGTH = 512
const MAX_TEST_INPUT_LENGTH = 2048

/**
 * Heuristic for patterns with exponential backtracking potential:
 * a quantified group/class that itself ends in a quantifier, e.g. (a+)+,
 * (a|aa)*, ([a-z]*)+. Star-height > 1 approximation — rejects the classic
 * ReDoS shapes while accepting normal URL patterns.
 */
const NESTED_QUANTIFIER = /[*+?}][)\]]*[*+?{]|\)[*+?{]/

/**
 * Compile a user pattern to a RegExp, or return null when the pattern is
 * invalid or too dangerous to run against untrusted-length input.
 */
export const compileSafePattern = (
  pattern: string,
  flags?: string
): RegExp | null => {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return null
  if (NESTED_QUANTIFIER.test(pattern)) return null
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

/** Cap the tested string so linear-time patterns stay cheap on huge URLs. */
const capInput = (value: string): string =>
  value.length > MAX_TEST_INPUT_LENGTH
    ? value.slice(0, MAX_TEST_INPUT_LENGTH)
    : value

/**
 * Match a URL (or domain) against one user pattern: regex when compilable
 * and safe, plain substring otherwise. Match-anywhere semantics.
 */
export const matchesUserPattern = (value: string, pattern: string): boolean => {
  const input = capInput(value)
  const regex = compileSafePattern(pattern)
  if (regex) return regex.test(input)
  return input.includes(pattern)
}
