/**
 * `/v1/models` over whatever the active backend reports.
 *
 * The route knows nothing about a runtime's catalog shape: the backend maps its own
 * metadata into `CatalogModel`, including the capability fields OpenAI-compatible
 * clients read to decide whether to send tools or images.
 */
import type { AgentBackend, CatalogModel } from "../backends/types.js"
import type { ProxyLogger } from "../types.js"
import { type Router, sendJson } from "./http.js"
import { OLC_PUBLIC_ROUTES } from "./public-api-contract.js"

const catalogError = (error: unknown) => ({
  error: {
    message: `Could not read the model catalog: ${(error as Error).message}`,
    type: "CatalogError"
  }
})

export const registerModelRoutes = (
  router: Router,
  { backend, log = () => {} }: { backend: AgentBackend; log?: ProxyLogger }
): void => {
  router.get(OLC_PUBLIC_ROUTES.models, async (_request, response) => {
    try {
      const models = await backend.listModels()
      log("GET /v1/models ok", { count: models.length })
      sendJson(response, 200, { object: "list", data: models })
    } catch (error) {
      console.error("[Proxy] Model fetch error:", (error as Error).message)
      sendJson(response, 502, catalogError(error))
    }
  })

  router.get(OLC_PUBLIC_ROUTES.model, async (request, response) => {
    try {
      const models: CatalogModel[] = await backend.listModels()
      const requested = request.params.modelId ?? ""
      const match = models.find(
        (model) => model.id === requested || model.id.endsWith(`/${requested}`)
      )
      if (!match) {
        sendJson(response, 404, { error: { message: "Model not found" } })
        return
      }
      sendJson(response, 200, match)
    } catch (error) {
      console.error("[Proxy] Model detail error:", (error as Error).message)
      sendJson(response, 502, catalogError(error))
    }
  })
}
