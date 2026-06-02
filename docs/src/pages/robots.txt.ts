import { SITE_URL } from "@/seo/constants.mjs"

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
  return new Response(content, {
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  })
}
