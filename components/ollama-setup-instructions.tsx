import { MarkdownRenderer } from "@/components/markdown-renderer"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SETUP_TABS } from "@/lib/constant"

export default function OllamaSetupInstructions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Configuration Guide</CardTitle>
        <CardDescription>
          Follow these steps to prevent CORS issues when using this extension
          with Ollama.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <Tabs defaultValue="macos" className="w-full">
          <TabsList className="flex h-auto w-full flex-wrap gap-2">
            {SETUP_TABS.map(({ value, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex-1 text-xs sm:text-sm">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          {SETUP_TABS.map(({ value, markdown }) => (
            <TabsContent key={value} value={value}>
              <MarkdownRenderer content={markdown} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}
