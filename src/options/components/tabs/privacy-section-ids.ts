/**
 * Anchor ids of the Privacy tab's groups. Kept apart from the tab module so
 * the options shell can name one without importing the lazy-loaded tab.
 */
export const PRIVACY_SECTION_IDS = {
  access: "privacy-section-access",
  backup: "privacy-section-backup",
  reset: "privacy-section-reset"
} as const
