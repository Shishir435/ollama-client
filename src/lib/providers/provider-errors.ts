import { EXTERNAL_URLS } from "@/lib/constants/urls"

/**
 * A 401/403 from a LOCAL provider (Ollama et al.) is almost always a CORS/origin
 * rejection, not bad credentials — most often on Firefox, which can't rewrite the
 * request origin the way Chromium's declarativeNetRequest does. Point the user at
 * the origins fix and the setup guide instead of a misleading "check your API key".
 */
export const localCorsForbiddenMessage = (firefox: boolean): string =>
  `Your local provider blocked this request (403 Forbidden). This is a CORS / origin block${
    firefox
      ? " — most common on Firefox, which can't rewrite the request origin the way Chromium does"
      : ""
  }. Allow this extension by setting OLLAMA_ORIGINS on your server (e.g. "chrome-extension://*,moz-extension://*"), then retry. Step-by-step: ${EXTERNAL_URLS.SETUP_GUIDE}`

/**
 * Map a provider HTTP status to a clean, user-facing message. Keeps raw
 * provider response bodies (which can be JSON or stack traces) out of the chat
 * UI — those stay in the error's `debug` field for diagnostics.
 */
export const providerErrorUserMessage = (status: number): string => {
  if (status === 400) {
    return "The provider rejected the request. The selected model may not support this input — for example, images on a model without vision support."
  }
  if (status === 401 || status === 403) {
    return "The provider rejected your credentials. Check the API key or access for this provider."
  }
  if (status === 404) {
    return "The model or endpoint was not found. Check the model name and the provider's base URL."
  }
  if (status === 408 || status === 504) {
    return "The provider timed out. Check that the server is responsive and try again."
  }
  if (status === 413) {
    return "The request was too large. Try a smaller image or shorter message."
  }
  if (status === 429) {
    return "The provider is rate-limiting requests. Wait a moment and try again."
  }
  if (status >= 500) {
    return "The provider server returned an error. Check that it is running and try again."
  }
  return "The provider returned an error. Check the provider, model, and server logs."
}
