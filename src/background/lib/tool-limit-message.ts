import { browser } from "@/lib/browser-api"

/**
 * English copy for the default locale, kept here only for contexts without
 * the extension i18n API (unit tests). The shipped text is the
 * `toolLimitReached` message, which the default locale is required to carry.
 */
const DEFAULT_LOCALE_TEXT =
  "Stopped at the tool-call limit before an answer was ready. Ask again with a narrower request."

/**
 * What the reply says when the tool loop ran out of iterations and the
 * synthesis pass wrote nothing. It becomes the reply's text, so it is the
 * extension speaking, in the user's language — not the model in first person.
 */
export const toolLimitReachedMessage = (): string => {
  try {
    return browser.i18n?.getMessage?.("toolLimitReached") || DEFAULT_LOCALE_TEXT
  } catch {
    return DEFAULT_LOCALE_TEXT
  }
}
