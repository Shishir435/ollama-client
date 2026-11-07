export type EndpointScope = "loopback" | "local-network" | "remote" | "invalid"

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

const LOCAL_NAME_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal"]

const classifyIpv4 = (octets: number[]): EndpointScope => {
  const [a = 0, b = 0] = octets
  if (a === 127) return "loopback"
  if (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  ) {
    return "local-network"
  }
  return "remote"
}

/**
 * Where an endpoint lives relative to the user's machine, by hostname alone.
 * A private-range address or an mDNS name is the user's own network, which is
 * not the same disclosure as a public host, so the two get different notices.
 * No DNS is resolved: a public name that points at a private address is still
 * reported as remote, which is the safe direction to be wrong in.
 */
export const classifyEndpointScope = (value: string): EndpointScope => {
  let hostname: string
  try {
    hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "")
  } catch {
    return "invalid"
  }
  if (!hostname) return "invalid"
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1"
  ) {
    return "loopback"
  }
  const ipv4 = IPV4.exec(hostname)
  if (ipv4) return classifyIpv4(ipv4.slice(1).map(Number))
  if (hostname.includes(":")) {
    return /^(fc|fd|fe80)/.test(hostname) ? "local-network" : "remote"
  }
  if (!hostname.includes(".")) return "local-network"
  return LOCAL_NAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    ? "local-network"
    : "remote"
}

/** A URL a person typed without a scheme, e.g. `localhost:1234`. */
export const suggestSchemeFor = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null
  // `localhost:1234` parses as scheme "localhost:", so detect it by shape.
  const candidate = `http://${trimmed}`
  try {
    return new URL(candidate).hostname ? candidate : null
  } catch {
    return null
  }
}
