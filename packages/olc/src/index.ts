/** Public entry points for embedding the proxy in another Node process. */

export { backendNames, createBackend } from "./backends/registry.js"
export type {
  AgentBackend,
  BackendContext,
  BackendFactory,
  BackendTurn,
  CatalogModel,
  StartTurnInput,
  TurnResult,
  TurnRunSignals,
  TurnStreamHandlers
} from "./backends/types.js"
export {
  boolOption,
  DEFAULTS,
  listOption,
  loopbackHost,
  numberOption,
  type ProxyOptions,
  resolveConfig,
  stringOption
} from "./config.js"
export { createProxy, type RunningProxy, startProxy } from "./proxy.js"
export type { ProxyConfig } from "./types.js"
