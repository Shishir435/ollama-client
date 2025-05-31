import OllamaOptions from "@/components/ollama-options"
import OllamaSetupInstructions from "@/components/ollama-setup-instructions"
import { PromptTemplateManager } from "@/components/prompt-template-manager"
import SocialHandles from "@/components/social-handles"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

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
        <TabsList className="flex gap-2">
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
