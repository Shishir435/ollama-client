// Type declarations for the plain-JS SEO constants consumed by build tooling
// (tools/generate-llms-docs.ts) under the strict root tsconfig.
export const APP_VERSION: string
export const SITE_URL: string
export const SITE_TITLE: string
export const SITE_DESCRIPTION: string
export const LANDING_TITLE: string
export const LANDING_DESCRIPTION: string
// A single comma-separated string, not a list: it is written straight into
// <meta name="keywords" content={KEYWORDS} />. Declared as string[] until
// 2026-07-26, which made every consumer of it a type error.
export const KEYWORDS: string
export const AUTHOR_NAME: string
export const AUTHOR_URL: string
export const CONTACT_EMAIL: string
export const REPO_URL: string
export const IS_NON_PRODUCTION_DEPLOY: boolean
