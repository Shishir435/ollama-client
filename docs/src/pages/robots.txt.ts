import { IS_NON_PRODUCTION_DEPLOY, SITE_URL } from "@/seo/constants.mjs"

/*
 * A preview deployment serves a full copy of the site on a throwaway host that
 * canonicalizes to itself. Refuse it outright rather than relying on the
 * platform's default noindex header; the pages also carry a `noindex` meta tag.
 */
const previewContent = `User-agent: *
Disallow: /
`

const content = `User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /

Sitemap: ${SITE_URL}/sitemap-index.xml

# AI-readable docs
# ${SITE_URL}/llms.txt
# ${SITE_URL}/llms-full.txt
# ${SITE_URL}/ai.txt
`

export function GET() {
  return new Response(IS_NON_PRODUCTION_DEPLOY ? previewContent : content, {
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  })
}
