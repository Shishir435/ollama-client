import { qualificationSaved } from "./qualification-score.mjs"

/** Bind independent page facts to actual tab identity and the attempt's result route. */
export const collectQualificationPages = async ({
  context,
  panel,
  fixture,
  state,
  origins
}) => {
  const pages = []
  for (const page of context.pages()) {
    if (page === panel || page.isClosed()) continue
    const url = new URL(page.url())
    if (!origins.includes(url.origin)) continue
    const childSaved = await Promise.all(
      page
        .frames()
        .filter(
          (frame) =>
            frame !== page.mainFrame() &&
            origins.includes(new URL(frame.url()).origin)
        )
        .map((frame) =>
          frame
            .locator("body")
            .innerText()
            .then(
              (body) =>
                qualificationSaved({
                  state,
                  path: new URL(frame.url()).pathname,
                  body
                }),
              () => false
            )
        )
    )
    pages.push({
      path: url.pathname,
      isInitial: page === fixture,
      widgetSaved: childSaved.some(Boolean)
    })
  }
  return pages
}
