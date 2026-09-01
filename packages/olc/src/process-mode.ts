/** One process-mode policy for native Ollama and both agent proxies. */
import { boolOption, type ProxyOptions } from "./config.js"

/** Debug stays interactive; explicit contradictory switches are usage errors. */
export function resolveProcessMode(
  options: ProxyOptions,
  file: ProxyOptions = {},
  env: NodeJS.ProcessEnv = process.env
) {
  const debug = boolOption(
    [options.DEBUG, env.OLC_DEBUG, env.OPENCODE_PROXY_DEBUG, file.DEBUG],
    false
  )
  if (options.DETACHED && options.FOREGROUND)
    throw new Error("Choose --detached or --foreground, not both.")
  if (options.DETACHED && debug)
    throw new Error(
      "--detached cannot be combined with debug logging. Use --foreground or disable DEBUG/OLC_DEBUG."
    )
  return {
    debug,
    detached:
      !debug &&
      !options.FOREGROUND &&
      boolOption([options.DETACHED, env.OLC_DETACHED, file.DETACHED], true)
  }
}
