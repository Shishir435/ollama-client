import type React from "react"

import { SourcePreviewCard } from "./source-preview-card"

type FilePreviewCardProps = React.ComponentProps<typeof SourcePreviewCard>

export const FilePreviewCard = (props: FilePreviewCardProps) => (
  <SourcePreviewCard {...props} />
)
