import { cn } from "@/lib/class-names"

export const ChatMessageContainer = ({
  isUser,
  children
}: {
  isUser: boolean
  children: React.ReactNode
}) => {
  return (
    <div
      className={cn(
        "group flex w-full flex-col items-start",
        isUser && "items-end"
      )}>
      {children}
    </div>
  )
}
