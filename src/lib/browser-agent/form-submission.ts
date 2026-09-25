/**
 * What a form sends, read the way the browser's own submission reads it.
 *
 * Shared by the executor, which builds the guarded copy it submits, and the
 * observation, which previews the address a same-origin search goes to. Two
 * copies of "which controls are successful" would be two places for the
 * approved address and the submitted one to disagree.
 */

/** The values a control contributes to its form's submission, if any. */
export const successfulControlValues = (
  control: Element
): readonly string[] | undefined => {
  if (
    !(control instanceof HTMLInputElement) &&
    !(control instanceof HTMLSelectElement) &&
    !(control instanceof HTMLTextAreaElement)
  ) {
    return undefined
  }
  if (!control.name || control.matches(":disabled")) return undefined
  if (control instanceof HTMLInputElement) {
    const type = control.type.toLowerCase()
    if (["button", "file", "image", "reset", "submit"].includes(type)) {
      return undefined
    }
    if (["checkbox", "radio"].includes(type) && !control.checked) {
      return undefined
    }
    return [control.value]
  }
  if (control instanceof HTMLSelectElement) {
    return Array.from(control.selectedOptions)
      .filter(
        (option) =>
          !option.disabled &&
          !(
            option.parentElement instanceof HTMLOptGroupElement &&
            option.parentElement.disabled
          )
      )
      .map((option) => option.value)
  }
  return [control.value]
}

/**
 * The name/value pairs the executor's guarded copy of a form submits, in the
 * order it submits them: every successful control in tree order, then the
 * submitter. That order is the executor's, not the browser's native one — it
 * is the guarded copy that is sent when the page does not handle the
 * submission itself, so it is the order an approved address must match.
 */
export const agentGuardedSubmissionEntries = (
  form: HTMLFormElement,
  submitter: Element | undefined
): [string, string][] => {
  const entries: [string, string][] = []
  for (const control of Array.from(form.elements)) {
    if (!(control instanceof Element) || !("name" in control)) continue
    const values = successfulControlValues(control)
    if (!values) continue
    for (const value of values) entries.push([String(control.name), value])
  }
  if (
    (submitter instanceof HTMLButtonElement ||
      submitter instanceof HTMLInputElement) &&
    submitter.name
  ) {
    if (
      submitter instanceof HTMLInputElement &&
      submitter.type.toLowerCase() === "image"
    ) {
      entries.push([`${submitter.name}.x`, "0"], [`${submitter.name}.y`, "0"])
    } else {
      entries.push([submitter.name, submitter.value])
    }
  }
  return entries
}

/** The GET query the guarded copy of this form would send now. */
export const agentGuardedGetQuery = (
  form: HTMLFormElement,
  submitter: Element | undefined
): string =>
  new URLSearchParams(agentGuardedSubmissionEntries(form, submitter)).toString()

/**
 * The GET query to show in an approval, when every value in it is one the
 * observation may already show.
 *
 * Refused for any form holding a hidden input — named or not, enabled or not,
 * because a page's own handler reads it either way — and for any contributing
 * control that is sensitive or not rendered: a `display:none` text field is a
 * hidden field by another name, and its value is not the observation's to
 * disclose. A search box with a button is what this is for. The preview names
 * the address in the approval; it never makes the step anything but a
 * submission, and the executor refuses to send one whose live query differs.
 */
export const agentVisibleGetQuery = (
  form: HTMLFormElement,
  submitter: Element | undefined,
  isShowable: (control: Element) => boolean
): string | undefined => {
  for (const control of Array.from(form.elements)) {
    if (!(control instanceof Element)) continue
    if (
      control instanceof HTMLInputElement &&
      control.type.toLowerCase() === "hidden"
    ) {
      return undefined
    }
    if (successfulControlValues(control) && !isShowable(control)) {
      return undefined
    }
  }
  return agentGuardedGetQuery(form, submitter)
}
