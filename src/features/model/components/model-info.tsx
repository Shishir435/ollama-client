import React from "react"

import {
  ChevronDown,
  Cpu,
  Database,
  FileText,
  Info,
  Layers,
  RefreshCw,
  Settings,
  Zap
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useModelInfo } from "@/features/model/hooks/use-model-info"

const fileTypeMap: Record<number, string> = {
  1: "F32",
  2: "F16",
  3: "Q4_0",
  4: "Q4_1",
  5: "Q5_0",
  6: "Q5_1",
  7: "Q8_0",
  8: "Q8_1",
  9: "Q2_K",
  10: "Q3_K",
  11: "Q4_K",
  12: "Q5_K",
  13: "Q6_K",
  14: "IQ2_XXS",
  15: "Q4_K_M",
  16: "Q6_K",
  17: "IQ4_XS",
  18: "Q8_K",
  19: "Q2_K",
  20: "Q5_1",
  21: "F16"
}

const formatKey = (key: string) =>
  key
    .replace(/^.*?\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase())

const formatNumber = (n: number) =>
  typeof n === "number"
    ? n >= 1e9
      ? (n / 1e9).toFixed(1) + "B"
      : n >= 1e6
        ? (n / 1e6).toFixed(1) + "M"
        : n.toLocaleString()
    : n

const formatCompactNumber = (n: number) =>
  typeof n === "number"
    ? n >= 1e9
      ? (n / 1e9).toFixed(0) + "B"
      : n >= 1e6
        ? (n / 1e6).toFixed(0) + "M"
        : n >= 1e3
          ? (n / 1e3).toFixed(0) + "K"
          : n.toString()
    : n

function flattenObject(
  obj: Record<string, any>,
  prefix = ""
): Record<string, any> {
  return Object.entries(obj).reduce(
    (acc, [key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        Object.assign(acc, flattenObject(value, path))
      } else {
        acc[path] = value
      }
      return acc
    },
    {} as Record<string, any>
  )
}

const getIconForKey = (key: string) => {
  if (key.includes("parameter")) return <Database className="h-3 w-3" />
  if (key.includes("context") || key.includes("length"))
    return <FileText className="h-3 w-3" />
  if (key.includes("architecture")) return <Cpu className="h-3 w-3" />
  if (key.includes("quantization")) return <Layers className="h-3 w-3" />
  if (key.includes("file")) return <Settings className="h-3 w-3" />
  return <Info className="h-3 w-3" />
}

const getCapabilityIcon = (capability: string) => {
  const cap = capability.toLowerCase()
  if (cap.includes("chat") || cap.includes("conversation"))
    return <Zap className="h-3 w-3" />
  if (cap.includes("code") || cap.includes("programming"))
    return <Cpu className="h-3 w-3" />
  if (cap.includes("file") || cap.includes("document"))
    return <FileText className="h-3 w-3" />
  if (cap.includes("data") || cap.includes("analysis"))
    return <Database className="h-3 w-3" />
  return <Settings className="h-3 w-3" />
}

const HeaderSpec = ({
  label,
  value
}: {
  label: string
  value: string | number
}) => (
  <div className="flex items-center gap-1 rounded bg-muted/50 px-2 py-1 text-xs">
    <span className="text-muted-foreground">{label}:</span>
    <span className="font-mono font-medium">{String(value)}</span>
  </div>
)

const DetailRow = ({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: string | number
}) => (
  <div className="flex items-start gap-2 py-1">
    {icon}
    <span className="min-w-0 flex-1 text-xs font-medium">{label}</span>
    <span className="max-w-[12rem] whitespace-normal break-words rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
      {String(value)}
    </span>
  </div>
)

const ModelInfo = ({ selectedModel }: { selectedModel: string }) => {
  const { error, loading, modelInfo, refresh } = useModelInfo(selectedModel)

  const flatMeta = modelInfo?.model_info
    ? flattenObject(modelInfo.model_info)
    : {}
  const capabilities = modelInfo?.capabilities ?? []
  const details = modelInfo?.details ?? {}

  const primaryKeys = [
    "context_length",
    "parameter_count",
    "architecture",
    "file_type",
    "quantization_version"
  ]

  const primaryEntries = Object.entries(flatMeta).filter(([k]) =>
    primaryKeys.some((pk) => k.endsWith(pk))
  )

  const otherEntries = Object.entries(flatMeta).filter(
    ([k]) => !primaryKeys.some((pk) => k.endsWith(pk))
  )

  const allEntries = [
    ...primaryEntries,
    ...Object.entries(details),
    ...otherEntries
  ]

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-3">
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2 text-xs text-destructive">
          <Info className="h-3 w-3" />
          {error}
        </div>
      </div>
    )
  }

  if (!modelInfo) {
    return (
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center justify-center text-xs text-muted-foreground">
          <Database className="mr-2 h-4 w-4 opacity-50" />
          No model data
        </div>
      </div>
    )
  }

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <div className="cursor-pointer rounded-lg border bg-card transition-colors hover:bg-accent/50">
          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              <span className="text-sm font-semibold">Model Info</span>
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
              {primaryEntries.map(([key, val]) => (
                <HeaderSpec
                  key={key}
                  label={
                    key.includes("parameter")
                      ? "Params"
                      : key.includes("context")
                        ? "Context"
                        : key.includes("architecture")
                          ? "Arch"
                          : key.includes("file_type")
                            ? "Format"
                            : formatKey(key)
                  }
                  value={
                    key.includes("file_type") && typeof val === "number"
                      ? fileTypeMap[val] ?? `Unknown (${val})`
                      : formatCompactNumber(val)
                  }
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  refresh()
                }}
                className="h-6 w-6 p-0">
                <RefreshCw className="h-3 w-3" />
              </Button>
              <ChevronDown className="h-4 w-4 transition-transform duration-200" />
            </div>
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-3 rounded-b-lg border-x border-b bg-card px-4 py-3">
          {capabilities.length > 0 && (
            <div className="border-b bg-accent/20 px-2 py-2">
              <div className="mb-2 flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Capabilities</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {capabilities.map((cap) => (
                  <Badge key={cap} variant="outline" className="gap-1 text-xs">
                    {getCapabilityIcon(cap)}
                    {cap}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Technical Details</span>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {allEntries.map(([key, val]) => (
                <DetailRow
                  key={key}
                  icon={getIconForKey(key)}
                  label={formatKey(key)}
                  value={formatNumber(val)}
                />
              ))}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export default ModelInfo
