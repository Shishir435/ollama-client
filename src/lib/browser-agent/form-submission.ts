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
 * The query a GET form would send now, when every value in it is one the
 * observation may already show.
 *
 * Hidden controls never cross the control port — the reference store keeps
 * them in the page for the execution-time check — so a form carrying one has
 * no preview, and neither does one with a sensitive control. A search box
 * with a button and nothing else is what this is for.
 */
export const agentVisibleGetQuery = (
  form: HTMLFormElement,
  submitter: Element | undefined,
  isSensitive: (control: Element) => boolean
): string | undefined => {
  const query = new URLSearchParams()
  for (const control of Array.from(form.elements)) {
    if (!(control instanceof Element)) continue
    const values = successfulControlValues(control)
    if (!values) continue
    if (
      (control instanceof HTMLInputElement &&
        control.type.toLowerCase() === "hidden") ||
      isSensitive(control)
    ) {
      return undefined
    }
    const name = (control as HTMLInputElement).name
    for (const value of values) query.append(name, value)
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
      query.append(`${submitter.name}.x`, "0")
      query.append(`${submitter.name}.y`, "0")
    } else {
      query.append(submitter.name, submitter.value)
    }
  }
  return query.toString()
}
