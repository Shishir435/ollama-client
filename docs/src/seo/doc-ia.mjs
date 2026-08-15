/**
 * Ordered information architecture for the hand-written docs.
 *
 * Single source of truth for three consumers that used to declare the same
 * ordering separately:
 *
 *   - the Starlight sidebar (docs/astro.config.mjs),
 *   - `llms.txt` / `ai.txt` / `llms-full.txt` ordering
 *     (tools/generate-llms-docs.ts),
 *   - breadcrumb section labels (src/components/starlight/Head.astro).
 *
 * They had already diverged: the generator's list carried 14 slugs against the
 * sidebar's 16, so `guides/context-and-tools` and
 * `guides/troubleshooting/error-reports` were appended alphabetically to the end
 * of the AI entrypoints instead of appearing in their real place in the IA. The
 * generator now fails the build when this file and the content tree disagree,
 * which is only meaningful because there is exactly one list to disagree with.
 *
 * The auto-generated TypeDoc `reference/**` tree is deliberately absent. It is
 * not part of the indexable IA (see the sitemap filter and the `noindex` in
 * Head.astro) and its pages carry no descriptions.
 */

export const DOC_SECTIONS = [
  {
    label: "Guides",
    items: [
      { label: "Quick Start", slug: "guides/quick-start" },
      { label: "Provider Setup", slug: "guides/provider-setup" },
      { label: "Ollama Cloud models", slug: "guides/ollama-cloud" },
      {
        label: "Context, Images, and Tools",
        slug: "guides/context-and-tools"
      },
      {
        label: "Fix Ollama CORS errors",
        slug: "guides/troubleshooting/ollama-cors-error"
      },
      {
        label: "Understand error reports",
        slug: "guides/troubleshooting/error-reports"
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
        slug: "concepts/provider-matrix",
        generated: true
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
  {
    label: "Legal",
    items: [{ label: "Privacy Policy", slug: "legal/privacy-policy" }]
  },
  {
    label: "About",
    items: [
      { label: "FAQ", slug: "about/faq" },
      { label: "Changelog", slug: "about/changelog", generated: true },
      { label: "Keyboard Shortcuts", slug: "about/keyboard-shortcuts" }
    ]
  }
]

/**
 * The generated API reference sits between Internal and Legal in the sidebar.
 * Named here rather than spliced by index at the call site so the position is
 * stated once, next to the sections it sits between.
 */
const REFERENCE_AFTER_SECTION = "Internal"

/** Sidebar order: content sections with the TypeDoc group in its slot. */
export const withReferenceGroup = (referenceGroup) =>
  DOC_SECTIONS.flatMap((section) =>
    section.label === REFERENCE_AFTER_SECTION
      ? [section, referenceGroup]
      : [section]
  )

/** Flat slug order used by the AI-entrypoint generator. */
export const DOC_ORDER = DOC_SECTIONS.flatMap((section) =>
  section.items.map((item) => item.slug)
)

/**
 * Slugs whose content file is written by tools/generate-docs.ts rather than
 * committed. Both are gitignored, so they exist only after `pnpm docs:generate`
 * — which `docs:build` and `docs:dev` always run first and `pnpm test:run`
 * never does.
 *
 * Marking them here rather than in the drift check keeps the strictness where
 * it belongs: the docs build still requires every slug in this file to have a
 * real page, because generation has already happened by then. Only a test
 * running against a clean tree may skip them, and it verifies separately that
 * this list still matches what the generator writes.
 */
export const GENERATED_DOC_SLUGS = DOC_SECTIONS.flatMap((section) =>
  section.items.filter((item) => item.generated).map((item) => item.slug)
)

/**
 * First path segment to its human section label, derived from the sections
 * above rather than restated. Used for breadcrumb naming.
 *
 * A segment shared by two sections would be ambiguous; none is today, and the
 * generator's drift check would surface a new page that introduced one.
 */
export const SECTION_LABELS = Object.fromEntries(
  DOC_SECTIONS.flatMap((section) =>
    section.items.map((item) => [item.slug.split("/")[0], section.label])
  )
)
