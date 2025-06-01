import SettingsButton from "@/components/settings-button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { usePromptTemplates } from "@/hooks/use-prompt-templates"

export default function PromptSelectorDialog({
  open,
  onSelect,
  onClose
}: {
  open: boolean
  onSelect: (prompt: string) => void
  onClose: () => void
}) {
  const { templates } = usePromptTemplates()

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-xl p-0">
        <DialogHeader className="border-b px-4 py-2">
          <DialogTitle className="mr-6 flex items-center justify-between text-sm font-medium">
            Prompt Templates <SettingsButton />
          </DialogTitle>
        </DialogHeader>

        {templates?.length ? (
          <ScrollArea className="max-h-[40vh] px-4 py-2">
            <ul className="space-y-2">
              {templates.map((template) => (
                <li key={template.id}>
                  <button
                    onClick={() => onSelect(template.userPrompt)}
                    className="w-full rounded-md bg-muted px-3 py-2 text-left text-sm hover:bg-muted-foreground/10">
                    <span className="block font-semibold">
                      {template.title}
                    </span>
                    <span className="block text-muted-foreground">
                      {template.userPrompt.slice(0, 100)}
                      {template.userPrompt.length > 100 ? "..." : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No prompt templates saved.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
