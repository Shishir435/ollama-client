import { PerformanceWarning } from "@/components/performance-warning"
import { SocialHandles } from "@/components/social-handles"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SpeechSettings } from "@/features/chat/components/speech-settings"
import { ExcludedUrls } from "@/features/model/components/exclude-urls"
import { ModelPullPanel } from "@/features/model/components/model-pull-panel"
import { ModelSettingsForm } from "@/features/model/components/model-settings-form"
import { PromptTemplateManager } from "@/features/prompt/components/prompt-template-manager"
import { Guides } from "@/options/components/guides"

export const OllamaOptions = () => {
  const tabSections = {
    general: {
      label: "General",
      content: (
        <div className="space-y-6">
          <PerformanceWarning />
          <ModelSettingsForm />
        </div>
      )
    },
    templates: {
      label: "Prompt Templates",
      content: <PromptTemplateManager />
    },
    modelPull: {
      label: "Model Library",
      content: <ModelPullPanel />
    },
    exclusions: {
      label: "Excluded URLs",
      content: <ExcludedUrls />
    },
    voices: {
      label: "Voice Settings",
      content: <SpeechSettings />
    },
    setup: {
      label: "Guides",
      content: (
        <div className="space-y-6">
          <PerformanceWarning />
          <Guides />
          <SocialHandles />
        </div>
      )
    }
  }

  return (
    <Card className="mx-auto my-4 max-w-4xl space-y-6 p-4">
      <CardHeader>
        <CardTitle className="text-lg">Ollama Client Settings</CardTitle>
        <CardDescription>
          Manage your Ollama setup, models, prompts, voices, and more — all in
          one place. For tips and setup instructions, see the Guides tab.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="mb-4 flex h-auto flex-wrap gap-2">
            {Object.entries(tabSections).map(([key, tab]) => (
              <TabsTrigger key={key} value={key} className="flex-1">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {Object.entries(tabSections).map(([key, tab]) => (
            <TabsContent key={key} value={key} className="space-y-4">
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}
