import { Badge } from "@/components/ui/badge"

interface PromptTemplateVariableBadgesProps {
  names: string[]
}

export const PromptTemplateVariableBadges = ({
  names
}: PromptTemplateVariableBadgesProps) => {
  if (names.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {names.map((name) => (
        <Badge key={name} variant="outline" className="font-mono text-micro">
          {`{{${name}}}`}
        </Badge>
      ))}
    </div>
  )
}
