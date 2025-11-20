import { useStorage } from "@plasmohq/storage/hook"
import type { ChangeEvent } from "react"
import { PerformanceWarning } from "@/components/performance-warning"
import { SocialHandles } from "@/components/social-handles"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SpeechSettings } from "@/features/chat/components/speech-settings"
import { ContentExtractionSettings } from "@/features/model/components/content-extraction-settings"
import { EmbeddingSettings } from "@/features/model/components/embedding-settings"
import { ModelPullPanel } from "@/features/model/components/model-pull-panel"
import { ModelSettingsForm } from "@/features/model/components/model-settings-form"
import { PromptTemplateManager } from "@/features/prompt/components/prompt-template-manager"
import { DEFAULT_FILE_UPLOAD_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import { Upload } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { Guides } from "@/options/components/guides"
import { ResetStorage } from "@/options/components/reset-storage"
import type { FileUploadConfig } from "@/types"

const FileUploadSettings = () => {
  const [config, setConfig] = useStorage<FileUploadConfig>(
    {
      key: STORAGE_KEYS.FILE_UPLOAD.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_FILE_UPLOAD_CONFIG
  )

  const handleMaxSizeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const mb = Number.parseFloat(e.target.value)
    if (!Number.isNaN(mb) && mb > 0) {
      setConfig((prev) => ({
        ...prev,
        maxFileSize: mb * 1024 * 1024
      }))
    }
  }

  const currentSizeMB = config?.maxFileSize
    ? (config.maxFileSize / (1024 * 1024)).toFixed(0)
    : "10"

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-xl">File Upload Settings</CardTitle>
        </div>
        <CardDescription>
          Configure file upload limits and behavior
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="max-file-size">Maximum File Size (MB)</Label>
          <Input
            id="max-file-size"
            type="number"
            min="1"
            value={currentSizeMB}
            onChange={handleMaxSizeChange}
            className="max-w-[200px]"
          />
          <p className="text-sm text-muted-foreground">
            Maximum allowed size for individual files. Larger files may take
            longer to process.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

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
      label: "Prompts",
      content: <PromptTemplateManager />
    },
    modelPull: {
      label: "Models",
      content: <ModelPullPanel />
    },
    contentExtraction: {
      label: "Extraction",
      content: <ContentExtractionSettings />
    },
    files: {
      label: "Files",
      content: <FileUploadSettings />
    },
    embeddings: {
      label: (
        <span className="flex items-center gap-2">
          Embeddings
          <Badge variant="secondary" className="text-xs">
            Beta
          </Badge>
        </span>
      ),
      content: <EmbeddingSettings />
    },
    voices: {
      label: "Voices",
      content: <SpeechSettings />
    },
    reset: {
      label: "Reset",
      content: <ResetStorage />
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
