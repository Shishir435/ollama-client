import { cn } from "@/lib/utils"

export interface ComposerShellProps {
  children: React.ReactNode
  isFocused: boolean
  isDragging: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export const ComposerShell = ({
  children,
  isFocused,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop
}: ComposerShellProps) => (
  // biome-ignore lint/a11y/noStaticElementInteractions: Drag and drop zone wrapper.
  <div
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    className={cn(
      "relative rounded-panel border bg-surface-composer transition-all duration-300",
      isFocused
        ? "border-app-primary/45 shadow-sm"
        : "border-border/45 hover:border-border/80",
      isDragging && "border-app-primary border-dashed bg-app-primary-soft/60"
    )}>
    {children}
  </div>
)
