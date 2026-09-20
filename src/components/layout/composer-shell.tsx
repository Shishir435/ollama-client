import { cn } from "@/lib/class-names"

/**
 * The bordered surface a panel composes into: a text area with its control
 * row beneath, inside one box that lights up on focus.
 *
 * Shared, because both surfaces compose. The Agent's goal was a bare textarea
 * with a label above it and its controls somewhere else entirely, so the two
 * halves of one panel looked like two applications. Drag handling is optional
 * — the Agent takes no attachments, and a shell that demanded them would have
 * made every caller invent three no-ops.
 */
export interface ComposerShellProps {
  children: React.ReactNode
  isFocused: boolean
  isDragging?: boolean
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}

export const ComposerShell = ({
  children,
  isFocused,
  isDragging = false,
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
        : "border-border hover:border-border-strong",
      isDragging && "border-app-primary border-dashed bg-app-primary-soft/60"
    )}>
    {children}
  </div>
)
