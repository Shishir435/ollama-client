/**
 * External URLs used throughout the extension.
 * Keep all hardcoded links here so they can be updated in one place.
 */
const DEFAULT_DOCS_HOME = "https://www.ollamaclient.in"
const DOCS_HOME = DEFAULT_DOCS_HOME.replace(/\/+$/, "")

export const EXTERNAL_URLS = {
  DOCS_HOME,
  GITHUB_ISSUES: "https://github.com/Shishir435/ollama-client/issues",
  SETUP_GUIDE: `${DOCS_HOME}/guides/provider-setup/`,
  FIREFOX_CORS_SCRIPT:
    "https://github.com/Shishir435/ollama-client/blob/main/tools/ollama-env.sh",
  I18N_DISCUSSION_GITHUB:
    "https://github.com/Shishir435/ollama-client/discussions/"
} as const
