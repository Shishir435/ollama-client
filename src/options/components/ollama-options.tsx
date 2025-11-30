import { useTranslation } from "react-i18next"

import { LanguageSelector } from "@/components/language-selector"
import { PerformanceWarning } from "@/components/performance-warning"
import { SocialHandles } from "@/components/social-handles"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { MiniBadge } from "@/components/ui/mini-badge"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SpeechSettings } from "@/features/chat/components/speech-settings"
import { MemorySettings } from "@/features/memory/components/memory-settings"
import { ContentExtractionSettings } from "@/features/model/components/content-extraction-settings"
import { EmbeddingSettings } from "@/features/model/components/embedding-settings"
import { ModelPullPanel } from "@/features/model/components/model-pull-panel"
import { ModelSettingsForm } from "@/features/model/components/model-settings-form"
import { PromptTemplateManager } from "@/features/prompt/components/prompt-template-manager"
import { Guides } from "@/options/components/guides"
import { ResetStorage } from "@/options/components/reset-storage"

export const OllamaOptions = () => {
  const { t } = useTranslation()

  const tabSections = {
    general: {
      label: t("settings.tabs.general"),
      content: (
        <div className="space-y-6">
          <PerformanceWarning />
          <LanguageSelector />
          <ModelSettingsForm />
        </div>
      )
    },
    templates: {
      label: t("settings.tabs.prompts"),
      content: <PromptTemplateManager />
    },
    modelPull: {
      label: t("settings.tabs.models"),
      content: <ModelPullPanel />
    },
    contentExtraction: {
      label: t("settings.tabs.extraction"),
      content: <ContentExtractionSettings />
    },

    embeddings: {
      label: (
        <span className="flex items-center gap-1.5">
          {t("settings.tabs.embeddings")}
          <MiniBadge text="Beta" />
        </span>
      ),
      content: <EmbeddingSettings />
    },
    memory: {
      label: (
        <span className="flex items-center gap-1.5">
          {t("settings.tabs.memory")}
          <MiniBadge text="Beta" />
        </span>
      ),
      content: <MemorySettings />
    },
    voices: {
      label: t("settings.tabs.voices"),
      content: <SpeechSettings />
    },
    reset: {
      label: t("settings.tabs.reset"),
      content: <ResetStorage />
    },
    setup: {
      label: t("settings.tabs.guides"),
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
        <CardTitle className="text-lg">{t("settings.page.title")}</CardTitle>
        <CardDescription>{t("settings.page.description")}</CardDescription>
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
