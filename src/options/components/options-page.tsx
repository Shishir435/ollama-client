import SocialHandles from "@/components/social-handles"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PromptTemplateManager } from "@/features/prompt/components/prompt-template-manager"
import OllamaOptions from "@/options/components/ollama-options"
import OllamaSetupInstructions from "@/options/components/ollama-setup-instructions"

const tabConfig = [
  {
    value: "settings",
    label: "Settings",
    content: <OllamaOptions />
  },
  {
    value: "templates",
    label: "Prompt Templates",
    content: <PromptTemplateManager />
  },
  {
    value: "setup",
    label: "CORS Setup",
    content: <OllamaSetupInstructions />
  }
]
const OptionsPage = () => {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <Tabs defaultValue="settings" className="w-full">
        <TabsList className="flex h-auto flex-wrap gap-2">
          {tabConfig.map(({ value, label }) => (
            <TabsTrigger key={value} value={value} className="flex-1">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabConfig.map(({ value, content }) => (
          <TabsContent key={value} value={value}>
            {content}
          </TabsContent>
        ))}
      </Tabs>

      <div className="mt-4 flex justify-center">
        <SocialHandles />
      </div>
    </div>
  )
}

export default OptionsPage
