#!/usr/bin/env tsx
/** Generate the public OpenAPI artifact from the olc runtime contract. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { OLC_PUBLIC_ROUTES } from "../packages/olc/src/core/public-api-contract.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const TEMPLATE_PATH = join(
  REPO_ROOT,
  "tools/openapi/olc-openapi.template.json"
)
const OUTPUT_PATH = join(REPO_ROOT, "docs/public/openapi.json")

type HttpMethod = "get" | "post"
type OpenApiOperation = {
  operationId?: string
  [key: string]: unknown
}
type OpenApiDocument = {
  info: { version: string; [key: string]: unknown }
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
  [key: string]: unknown
}

const ROUTE_OPERATIONS = {
  serviceInfo: { method: "get", operationId: "getServiceInfo" },
  health: { method: "get", operationId: "getHealth" },
  models: { method: "get", operationId: "listModels" },
  model: { method: "get", operationId: "getModel" },
  chatCompletions: {
    method: "post",
    operationId: "createChatCompletion"
  },
  imageGenerations: {
    method: "post",
    operationId: "createImageGeneration"
  }
} as const satisfies Record<
  keyof typeof OLC_PUBLIC_ROUTES,
  { method: HttpMethod; operationId: string }
>

const toOpenApiPath = (route: string) =>
  route.replace(/:([A-Za-z0-9_]+)/g, "{$1}")

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf-8")) as T

const operationsById = (template: OpenApiDocument) => {
  const operations = new Map<string, OpenApiOperation>()

  for (const pathItem of Object.values(template.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (!operation?.operationId) continue
      if (operations.has(operation.operationId)) {
        throw new Error(
          `Duplicate OpenAPI operationId: ${operation.operationId}`
        )
      }
      operations.set(operation.operationId, operation)
    }
  }

  return operations
}

export function buildOlcOpenApi(): OpenApiDocument {
  const template = readJson<OpenApiDocument>(TEMPLATE_PATH)
  const packageJson = readJson<{ version: string }>(
    join(REPO_ROOT, "packages/olc/package.json")
  )
  const operations = operationsById(template)
  const paths: OpenApiDocument["paths"] = {}

  for (const routeName of Object.keys(
    ROUTE_OPERATIONS
  ) as (keyof typeof ROUTE_OPERATIONS)[]) {
    const runtimeRoute = OLC_PUBLIC_ROUTES[routeName]
    const { method, operationId } = ROUTE_OPERATIONS[routeName]
    const operation = operations.get(operationId)
    if (!operation) {
      throw new Error(
        `OpenAPI template is missing operationId: ${operationId}`
      )
    }
    const path = toOpenApiPath(runtimeRoute)
    paths[path] = { ...paths[path], [method]: operation }
    operations.delete(operationId)
  }

  if (operations.size > 0) {
    throw new Error(
      `OpenAPI template has operations with no public runtime route: ${[
        ...operations.keys()
      ].join(", ")}`
    )
  }

  return {
    ...template,
    info: { ...template.info, version: packageJson.version },
    paths
  }
}

export function writeOlcOpenApi() {
  const document = buildOlcOpenApi()
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf-8")
  return OUTPUT_PATH
}

function main() {
  console.log("Generating olc OpenAPI specification...")
  writeOlcOpenApi()
  console.log("Generated docs/public/openapi.json")
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
