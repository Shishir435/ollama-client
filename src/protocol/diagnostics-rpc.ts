import { z } from "zod"

import type { RpcDefinition } from "./rpc"
import { RpcMethod } from "./rpc"

export const DiagnosticTestResultSchema = z
  .object({
    id: z.string(),
    status: z.enum(["pass", "fail", "action", "unsupported"]),
    durationMs: z.number().nonnegative(),
    code: z.string().optional(),
    metadata: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()])
      )
      .optional()
  })
  .strict()

export const DiagnosticEventSchema = z
  .object({
    id: z.string().uuid(),
    at: z.number().int().nonnegative(),
    level: z.enum(["info", "warn", "error"]),
    code: z.string().regex(/^[A-Z0-9_-]{1,100}$/),
    operation: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
    surface: z.enum(["sidepanel", "options", "background", "content"]),
    requestId: z.string().uuid().optional(),
    providerProfile: z
      .string()
      .regex(/^[a-zA-Z0-9_.:-]{1,100}$/)
      .optional(),
    wireProtocol: z
      .string()
      .regex(/^[a-zA-Z0-9_.:-]{1,100}$/)
      .optional(),
    status: z.number().int().optional(),
    durationMs: z.number().nonnegative().optional(),
    retryable: z.boolean().optional(),
    supportCode: z
      .string()
      .regex(/^[A-Z0-9_-]{1,120}$/)
      .optional(),
    metadata: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()])
      )
      .optional()
  })
  .strict()

export const DiagnosticsRunRequestSchema = z.object({}).strict()
export const DiagnosticsRunResultSchema = z
  .object({ tests: z.array(DiagnosticTestResultSchema).max(30) })
  .strict()

export const DiagnosticsGetBundleRequestSchema = z.object({}).strict()
export const DiagnosticsGetBundleResultSchema = z
  .object({
    bundle: z
      .object({
        format: z.literal("ollama-client-support-v1"),
        createdAt: z.number().int().nonnegative(),
        appVersion: z.string(),
        browserFamily: z.string(),
        osFamily: z.string(),
        capabilities: z.record(z.string(), z.boolean()),
        permissions: z.record(z.string(), z.boolean()),
        providers: z.array(
          z.object({
            profile: z.string(),
            wire: z.string(),
            enabled: z.boolean()
          })
        ),
        storage: z.object({
          backend: z.string(),
          messageCount: z.number().int().nonnegative(),
          vectorCount: z.number().int().nonnegative()
        }),
        events: z.array(DiagnosticEventSchema),
        selfTests: z.array(DiagnosticTestResultSchema)
      })
      .strict()
  })
  .strict()

export const DiagnosticsClearRequestSchema = z.object({}).strict()
export const DiagnosticsClearResultSchema = z
  .object({ cleared: z.literal(true) })
  .strict()

export type DiagnosticsRunRequest = z.infer<typeof DiagnosticsRunRequestSchema>
export type DiagnosticsRunResult = z.infer<typeof DiagnosticsRunResultSchema>
export type DiagnosticsGetBundleRequest = z.infer<
  typeof DiagnosticsGetBundleRequestSchema
>
export type DiagnosticsGetBundleResult = z.infer<
  typeof DiagnosticsGetBundleResultSchema
>
export type DiagnosticsClearRequest = z.infer<
  typeof DiagnosticsClearRequestSchema
>
export type DiagnosticsClearResult = z.infer<
  typeof DiagnosticsClearResultSchema
>
export type DiagnosticEvent = z.infer<typeof DiagnosticEventSchema>
export type DiagnosticTestResult = z.infer<typeof DiagnosticTestResultSchema>

declare module "./provider-rpc" {
  interface RpcMap {
    [RpcMethod.DiagnosticsRun]: RpcDefinition<
      DiagnosticsRunRequest,
      DiagnosticsRunResult
    >
    [RpcMethod.DiagnosticsGetBundle]: RpcDefinition<
      DiagnosticsGetBundleRequest,
      DiagnosticsGetBundleResult
    >
    [RpcMethod.DiagnosticsClear]: RpcDefinition<
      DiagnosticsClearRequest,
      DiagnosticsClearResult
    >
  }
}
