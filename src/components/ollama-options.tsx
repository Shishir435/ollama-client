import BaseUrlSettings from "@/components/base-url-settings"
import ExcludedUrls from "@/components/exclude-urls"
import { ModelPullPanel } from "@/components/model-pull-panel"
import { ModelSettingsForm } from "@/components/model-settings-form"
import PerformanceWarning from "@/components/performance-warning"
import ThemeToggle from "@/components/theme-toggle"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const OllamaOptions = () => {
  const tabSections = {
    general: {
      label: "General",
      content: (
        <div className="space-y-6">
          <BaseUrlSettings />
          <ModelSettingsForm />
          <PerformanceWarning />
        </div>
      )
    },
    modelPull: {
      label: "Pull model",
      content: <ModelPullPanel />
    },
    exclusions: {
      label: "Excluded URLs",
      content: <ExcludedUrls />
    },
    appearance: {
      label: "Appearance",
      content: (
        <div className="flex items-center justify-center gap-2">
          <ThemeToggle />
        </div>
      )
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Ollama Client Settings</CardTitle>
        <CardDescription>
          Configure your Ollama server, excluded sites, and appearance.
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

export default OllamaOptions
