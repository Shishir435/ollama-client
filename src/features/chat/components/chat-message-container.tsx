import { cn } from "@/lib/utils"

export default function ChatMessageContainer({
  isUser,
  children
}: {
  isUser: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "group flex w-full flex-col items-start transition-all duration-200",
        isUser && "items-end"
      )}>
      {children}
    </div>
  )
}
