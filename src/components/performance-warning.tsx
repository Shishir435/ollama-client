import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const PerformanceWarning = () => {
  return (
    <Card className="mt-6 border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-yellow-800 dark:text-yellow-300">
          ⚠️ Performance Notice
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-yellow-900 dark:text-yellow-200">
        This extension is a user interface for your local Ollama server.
        Response time and model output quality depend entirely on your device's
        hardware (CPU, RAM, GPU) and the specific model you're using. No
        processing is done by the extension itself.
      </CardContent>
    </Card>
  )
}
