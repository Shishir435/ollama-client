import mdx from "@astrojs/mdx"
import { unified } from "@astrojs/markdown-remark"
import sitemap from "@astrojs/sitemap"
import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"
import rehypeMermaid from "rehype-mermaid"
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc"
import { fileURLToPath } from "url"
import {
  KEYWORDS,
  SITE_TITLE,
  SITE_DESCRIPTION,
  SITE_URL
} from "./src/seo/constants.mjs"

/**
 * Astro config for the Ollama Client docs site.
 *
 * Surfaces:
 *   - `/`        -> custom marketing landing (src/pages/index.astro),
 *                   kept outside Starlight so we own the presentation.
 *   - `/docs/*`  -> Starlight-managed content from src/content/docs/.
 *
 * Theme is shadcn/ui-inspired: pure neutrals, hairline borders, accent
 * used only on links + active sidebar item, Geist sans/mono throughout.
 * Visual specifics live in src/styles/starlight-overrides.css.
 */
export default defineConfig({
  site: SITE_URL,
  base: "/",
  trailingSlash: "ignore",
  outDir: "dist",
  build: {
    format: "directory"
  },
  /*
   * Redirects from the pre-Starlight URL structure to the new IA.
   * Astro emits a small HTML file at each old path containing
   *   <meta http-equiv="refresh" content="0;url=/new/path/">
   * plus a <link rel="canonical"> and a JS fallback. Google honors
   * this as a permanent redirect and passes link authority through,
   * which preserves search ranking for inbound links from the
   * Chrome Web Store listing, GitHub README, and existing index
   * results. Keep entries here as long as the old URLs are still
   * referenced anywhere we don't control.
   */
  redirects: {
    "/architecture": "/concepts/architecture/",
    "/ollama-setup-guide": "/guides/provider-setup/",
    "/privacy-policy": "/legal/privacy-policy/"
  },
  markdown: {
    /*
     * Convert fenced ```mermaid blocks from a code-language block
     * (which Expressive Code would otherwise syntax-highlight as if
     * mermaid were a programming language) into a `<pre class="mermaid">`
     * element. Mermaid.js then renders these as SVG diagrams on the
     * client at page load.
     *
     * Why client-side instead of build-time SVG: Starlight's pipeline
     * routes code blocks through Expressive Code before rehype plugins
     * see them, which strips the language hint inline-svg needs. The
     * `pre-mermaid` strategy works upstream of EC and is the path
     * Starlight + rehype-mermaid users actually use in practice.
     *
     * Trade-off: ships ~200KB of mermaid.js to the docs viewer. The
     * architecture page is the only one with diagrams; load is lazy
     * via dynamic import in the init script below.
     */
    processor: unified({
      rehypePlugins: [[rehypeMermaid, { strategy: "pre-mermaid" }]]
    })
  },
  integrations: [
    starlight({
      components: {
        Head: "./src/components/starlight/Head.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro"
      },
      favicon: "/assets/favicon.ico",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Shishir435/ollama-client"
        }
      ],
      editLink: {
        baseUrl:
          "https://github.com/Shishir435/ollama-client/edit/main/docs/"
      },
      customCss: [
        "@fontsource-variable/geist",
        "@fontsource-variable/geist-mono",
        "./src/styles/tokens.css",
        "./src/styles/starlight-overrides.css"
      ],
      expressiveCode: {
        themes: ["github-dark-dimmed", "github-light"],
        styleOverrides: {
          borderRadius: "0.5rem",
          borderWidth: "1px",
          codeFontSize: "0.8125rem",
          codeLineHeight: "1.6"
        }
      },
      plugins: [
        starlightTypeDoc({
          // Auto-generate API reference from the extension's TypeScript
          // surface. Entry points are the "public" modules a consumer
          // of this codebase would care about understanding:
          //
          //   - chat-history.ts: the runtime-switchable storage facade
          //   - providers/types: provider interface contracts
          //   - providers/factory: provider lookup + construction
          //   - selected public hooks: ones with documented JSDoc
          //
          // Excludes: components, Zustand stores, tests, lib internals
          // that aren't part of any stable surface yet.
          entryPoints: [
            "../src/lib/repositories/chat-history.ts",
            "../src/lib/providers/types.ts",
            "../src/lib/providers/factory.ts",
            "../src/features/model/hooks/use-embedding-model-check.ts",
            "../src/features/model/hooks/use-embedding-rebuild.ts",
            "../src/features/model/hooks/use-embedding-dimension-stats.ts"
          ],
          tsconfig: "../tsconfig.json",
          // Generated output lands in src/content/docs/reference/ and
          // is consumed by the Starlight sidebar via typeDocSidebarGroup.
          output: "reference",
          sidebar: {
            label: "Reference",
            collapsed: true
          },
          typeDoc: {
            // Keep the markdown lean -- no class-of-the-month
            // expansions, just the documented surface.
            excludeInternal: true,
            excludePrivate: true,
            excludeProtected: true,
            // Treat each entry point as its own module.
            entryFileName: "index",
            // Don't render the auto-generated readme; we set the
            // section's index page via the sidebar group title.
            readme: "none",
            // Pin "Defined in:" links to the `main` branch instead of
            // the current HEAD SHA. Otherwise every docs rebuild churns
            // every reference page's "Defined in:" link to the new SHA,
            // exploding the git diff for unrelated docs changes.
            gitRevision: "main"
          }
        })
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            { label: "Quick Start", slug: "guides/quick-start" },
            { label: "Provider Setup", slug: "guides/provider-setup" },
            {
              label: "Context, Images, and Tools",
              slug: "guides/context-and-tools"
            },
            {
              label: "Fix Ollama CORS errors",
              slug: "guides/troubleshooting/ollama-cors-error"
            }
          ]
        },
        {
          label: "Concepts",
          items: [
            { label: "Privacy", slug: "concepts/privacy" },
            { label: "Architecture", slug: "concepts/architecture" },
            {
              label: "Provider capabilities",
              slug: "concepts/provider-matrix"
            }
          ]
        },
        {
          label: "Compare",
          items: [
            {
              label: "vs Open WebUI",
              slug: "compare/open-webui-vs-ollama-client"
            },
            {
              label: "vs Page Assist",
              slug: "compare/page-assist-vs-ollama-client"
            },
            {
              label: "vs LM Studio",
              slug: "compare/lm-studio-vs-ollama-client"
            }
          ]
        },
        {
          label: "Internal",
          items: [
            {
              label: "Frontend Design System",
              slug: "internal/frontend-design-system"
            }
          ]
        },
        // Auto-populated by starlight-typedoc from the entryPoints above.
        typeDocSidebarGroup,
        {
          label: "Legal",
          items: [{ label: "Privacy Policy", slug: "legal/privacy-policy" }]
        },
        {
          label: "About",
          items: [
            { label: "FAQ", slug: "about/faq" },
            { label: "Changelog", slug: "about/changelog" },
            { label: "Keyboard Shortcuts", slug: "about/keyboard-shortcuts" }
          ]
        }
      ],
      head: [
        {
          tag: "meta",
          attrs: {
            name: "keywords",
            content: KEYWORDS
          }
        },
        /*
         * Lazy-load mermaid.js only on pages that actually have a
         * `<pre class="mermaid">` block. Keeps the docs JS-light for
         * the 95% of pages that don't have diagrams.
         *
         * Mermaid is themed to match the surrounding shadcn palette
         * via the `themeVariables` block. The script also re-renders
         * on Starlight's color-scheme toggle so dark-mode reads
         * correctly.
         */
        {
          tag: "script",
          attrs: { type: "module" },
          content: `
            if (document.querySelector('pre.mermaid')) {
              const isDark = () => document.documentElement.dataset.theme === 'dark'
              const themeFor = (dark) => ({
                theme: 'base',
                themeVariables: {
                  fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
                  background: dark ? '#0a0a0a' : '#ffffff',
                  primaryColor: dark ? '#0a0a0a' : '#ffffff',
                  primaryTextColor: dark ? '#fafafa' : '#0a0a0a',
                  primaryBorderColor: dark ? '#3f3f46' : '#e4e4e7',
                  lineColor: dark ? '#71717a' : '#a1a1aa',
                  secondaryColor: dark ? '#18181b' : '#fafafa',
                  tertiaryColor: dark ? '#18181b' : '#f4f4f5',
                  mainBkg: dark ? '#18181b' : '#fafafa',
                  edgeLabelBackground: dark ? '#0a0a0a' : '#ffffff'
                }
              })
              const mod = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')
              const mermaid = mod.default
              const render = () => {
                mermaid.initialize({ startOnLoad: false, ...themeFor(isDark()) })
                document.querySelectorAll('pre.mermaid').forEach((el, i) => {
                  if (!el.dataset.processed) {
                    el.dataset.source = el.textContent
                    el.dataset.processed = 'true'
                  }
                  el.textContent = el.dataset.source
                  el.removeAttribute('data-processed')
                })
                mermaid.run({ querySelector: 'pre.mermaid' })
              }
              render()
              // Re-render on color-scheme toggle.
              const observer = new MutationObserver(render)
              observer.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['data-theme']
              })
            }
          `
        }
      ],
      lastUpdated: true,
      pagination: false,
      credits: false
    }),
    mdx(),
    sitemap()
  ],
  vite: {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    }
  }
})
