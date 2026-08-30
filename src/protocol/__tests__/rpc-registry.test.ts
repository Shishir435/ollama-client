import { RpcMethod } from "@ollama-client/contracts/rpc"
import { describe, expect, it } from "vitest"
import { RPC_METHOD_DEFINITIONS } from "../rpc-registry"

/**
 * The registry is the single policy table for the protocol (plan section 4.2):
 * `satisfies Record<RpcMethod, …>` makes a *missing* entry a compile error, but
 * nothing at the type level catches an entry that is present and wrong. These
 * assertions cover the policy fields a reviewer would otherwise have to eyeball
 * every time a method is added.
 */
describe("RPC method registry", () => {
  const methods = Object.values(RpcMethod)
  const reviewedQueryMethods = [
    RpcMethod.ProvidersList,
    RpcMethod.ProvidersListModels,
    RpcMethod.ModelsGetDetails,
    RpcMethod.ModelsListLoaded,
    RpcMethod.ModelsSearchLibrary,
    RpcMethod.ModelsGetLibraryVariants,
    RpcMethod.EmbeddingsCheckModel,
    RpcMethod.EmbeddingsGenerate,
    RpcMethod.IngestionGet,
    RpcMethod.ModelPullGet,
    RpcMethod.ModelPullListActive,
    RpcMethod.DiagnosticsGetBundle
  ] satisfies readonly RpcMethod[]

  it("registers every method exactly once", () => {
    expect(Object.keys(RPC_METHOD_DEFINITIONS).sort()).toEqual(
      [...methods].sort()
    )
  })

  it.each(methods)("declares complete policy for %s", (method) => {
    const definition = RPC_METHOD_DEFINITIONS[method]

    expect(definition.request).toBeDefined()
    expect(definition.response).toBeDefined()
    expect(definition.allowedSources.length).toBeGreaterThan(0)
    expect(definition.timeoutMs).toBeGreaterThan(0)
    expect(["query", "command"]).toContain(definition.operation)
  })

  it("keeps the boundary closed to page contexts", () => {
    // Section 4.13: never trust a content script. Opening the envelope to one
    // is a security decision, not an incidental registry edit — if a method
    // ever needs it, this assertion is the place that argument gets made.
    for (const method of methods) {
      expect(RPC_METHOD_DEFINITIONS[method].allowedSources).toEqual([
        "extension-page"
      ])
    }
  })

  it("gives slow embedding generation a bounded cancellation window", () => {
    expect(RPC_METHOD_DEFINITIONS[RpcMethod.EmbeddingsGenerate].timeoutMs).toBe(
      900_000
    )
  })

  it("requires explicit review before classifying a method as a query", () => {
    // Metadata cannot prove an implementation is side-effect free. Keeping the
    // complete query set here makes adding or relabelling one a deliberate
    // contract-test change where its read-only behavior must be reviewed.
    const actualQueries = methods.filter(
      (method) => RPC_METHOD_DEFINITIONS[method].operation === "query"
    )

    expect(actualQueries.sort()).toEqual([...reviewedQueryMethods].sort())
  })

  it("names methods as domain.verb with a plural domain", () => {
    // The string is protocol data: it appears in diagnostics events, the
    // support bundle, and error support codes, so drift in naming is drift in
    // shipped artifacts.
    for (const method of methods) {
      expect(method).toMatch(/^[a-z]+s\.[a-zA-Z]+$/)
    }
  })
})
