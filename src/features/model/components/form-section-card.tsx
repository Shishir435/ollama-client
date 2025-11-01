import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import type { LucideIcon } from "@/lib/lucide-icon"

interface FormSectionCardProps {
  title: string
  description: string
  icon?: LucideIcon
  children: React.ReactNode
}

export const FormSectionCard = ({
  title,
  description,
  icon: Icon,
  children
}: FormSectionCardProps) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
          <CardTitle className="text-xl">{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}
