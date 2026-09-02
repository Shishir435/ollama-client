/**
 * Vercel Routing Middleware for the documentation site.
 *
 * It exists for one structural reason: Vercel evaluates `vercel.json` rewrites
 * after the filesystem, so nothing declared there can change the response for a
 * path that is a built file. Every documentation page is a built file, which is
 * why `Accept`-based content negotiation, a machine-readable 404 and JSON API
 * errors have to be decided here, before static serving.
 *
 * All of the behaviour lives in `src/lib/agent-routing.ts` so it can be tested
 * without a deployment; this file is the adapter. A thrown error falls through
 * to normal static serving rather than taking the site down with it.
 */
import { next, rewrite } from "@vercel/functions"

import { resolveRequest } from "./src/lib/agent-routing"
import { DOC_ORDER } from "./src/seo/doc-ia.mjs"

export const config = {
  runtime: "nodejs",
  /*
   * Skip anything that cannot be negotiated: build assets, generated OG
   * images, the well-known and reference trees, and any path carrying a file
   * extension (which includes the `.md` twins this middleware rewrites to, so
   * a rewrite can never re-enter it).
   *
   * `/api` is listed separately and unconditionally, because that exclusion
   * would otherwise hand `/api/models.json` to static serving and answer a
   * machine with an HTML 404 — the one thing the JSON error contract promises
   * never happens under `/api`.
   */
  matcher: [
    "/",
    "/api",
    "/api/:path*",
    "/((?!_astro/|assets/|og/|\\.well-known/|reference/|[^/]*\\.[^/]+$).*)"
  ]
}

export default function proxy(request: Request): Response {
  try {
    const { pathname } = new URL(request.url)
    const decision = resolveRequest({
      pathname,
      method: request.method.toUpperCase(),
      accept: request.headers.get("accept"),
      markdownSlugs: DOC_ORDER
    })

    if (decision.kind === "rewrite") {
      return rewrite(new URL(decision.destination, request.url))
    }

    if (decision.kind === "respond") {
      return new Response(decision.status === 204 ? null : decision.body, {
        status: decision.status,
        headers: decision.headers
      })
    }

    return next()
  } catch (error) {
    console.error("routing middleware failed", error)
    return next()
  }
}
