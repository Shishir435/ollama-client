/**
 * Public olc HTTP routes shared by the server and generated OpenAPI document.
 *
 * Backend-only callbacks such as the OpenCode bridge are deliberately absent:
 * they use per-run credentials and are not a client integration surface.
 */
export const OLC_PUBLIC_ROUTES = {
  serviceInfo: "/",
  health: "/health",
  models: "/v1/models",
  model: "/v1/models/:modelId",
  chatCompletions: "/v1/chat/completions",
  imageGenerations: "/v1/images/generations"
} as const
