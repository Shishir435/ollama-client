import React, { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import {
  ChevronDown,
  Cpu,
  Database,
  FileText,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  Settings,
  Zap
} from "@/lib/lucide-icon"
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

const flattenObject = (
  obj: Record<string, any>,
  prefix = ""
): Record<string, any> => {
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

export const ModelInfo = ({ selectedModel }: { selectedModel: string }) => {
  const { error, loading, modelInfo, refresh } = useModelInfo(selectedModel)
  const [isExpanded, setIsExpanded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = () => {
    setRefreshing(true)
    refresh()
    setRefreshing(false)
  }
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
          <Database className="mr-2 h-4 w-4 text-muted-foreground" />
          No model data
        </div>
      </div>
    )
  }

  return (
    <Card className="w-full rounded-lg border-border bg-card text-card-foreground">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <div className="flex cursor-pointer items-center justify-between p-2 transition-colors hover:bg-muted/20">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Model Information</h3>
              {loading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            <div className="flex items-center gap-2">
              {modelInfo && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {primaryEntries.map(([key, val], index) => (
                    <React.Fragment key={key}>
                      <span className="font-mono text-xs">
                        {key.includes("parameter")
                          ? `${formatCompactNumber(val)} Params`
                          : key.includes("context")
                            ? `${formatCompactNumber(val)} Ctx`
                            : key.includes("file_type") &&
                                typeof val === "number"
                              ? fileTypeMap[val] ?? val
                              : val}
                      </span>
                      {index < primaryEntries.length - 1 && <span>•</span>}
                    </React.Fragment>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRefresh()
                      }}
                      disabled={refreshing}
                      className="h-8 w-8 p-0">
                      <RefreshCw
                        className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Refresh model info</p>
                  </TooltipContent>
                </Tooltip>

                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
              </div>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-border px-4 pb-4 pt-4">
            {!modelInfo || error ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Cpu className="mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {error
                    ? "Error fetching model data"
                    : "No model data available"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {error ? error : "Could not retrieve model details."}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {capabilities.length > 0 && (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" />
                      <h4 className="font-semibold">Capabilities</h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {capabilities.map((cap) => (
                        <Badge
                          key={cap}
                          variant="secondary"
                          className="gap-1.5 text-xs">
                          {getCapabilityIcon(cap)}
                          {cap}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <h4 className="font-semibold">Technical Details</h4>
                  </div>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                    {allEntries.map(([key, val]) => (
                      <DetailRow
                        key={key}
                        icon={getIconForKey(key)}
                        label={formatKey(key)}
                        value={
                          key.includes("file_type") && typeof val === "number"
                            ? fileTypeMap[val] ?? `Unknown (${val})`
                            : formatNumber(val)
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
