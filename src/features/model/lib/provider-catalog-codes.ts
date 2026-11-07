/**
 * Marks a provider whose catalog question never got an answer (a timeout or a
 * transport failure). It is not a discovery failure code and never crosses the
 * RPC boundary; it exists so the menu can tell this entry from a failure.
 */
export const UNVERIFIED_PROVIDER_CODE = "unverified"
