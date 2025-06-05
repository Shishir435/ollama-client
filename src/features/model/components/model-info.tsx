import React from "react"

import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useModelInfo } from "@/features/model/hooks/use-model-info"

const ModelInfo = ({ selectedModel }: { selectedModel: string }) => {
  const { error, loading, modelInfo, refresh } = useModelInfo(selectedModel)

  const details = modelInfo?.details ?? {}

  return (
    <div>
      {loading ? (
        <Skeleton className="h-12 w-full" />
      ) : error ? (
        <div className="text-sm text-red-500">{error}</div>
      ) : modelInfo ? (
        <>
          <div className="flex flex-wrap items-center justify-evenly gap-2 space-y-1 text-sm">
            <p>
              <strong>Quantization:</strong>{" "}
              <span className="text-muted-foreground">
                {details.quantization_level || "N/A"}
              </span>
            </p>
            <p>
              <strong>Family:</strong>{" "}
              <span className="text-muted-foreground">
                {details.family || "N/A"}
              </span>
            </p>
            <p>
              <strong>Format:</strong>{" "}
              <span className="text-muted-foreground">
                {details.format || "N/A"}
              </span>
            </p>
            <p>
              <strong>Parameters:</strong>{" "}
              <span className="text-muted-foreground">
                {details.parameter_size || "None"}
              </span>
            </p>
            <Button variant="ghost" size="icon" onClick={refresh}>
              <RefreshCw />
            </Button>
          </div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">
          No model selected or no data available.
        </div>
      )}
    </div>
  )
}

export default ModelInfo
