import { AlertCircle, Download, RefreshCw } from "lucide-react"
import React, { Component, type ReactNode } from "react"
import { type WithTranslation, withTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { logger } from "@/lib/logger"

interface Props extends WithTranslation {
  children?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundaryBase extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error("Uncaught error in component tree", error.message, {
      error: error.toString(),
      componentStack: errorInfo.componentStack
    })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleExportLogs = async () => {
    try {
      const logs = await logger.exportLogs()
      const blob = new Blob([JSON.stringify(logs, null, 2)], {
        type: "application/json"
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `ollama-client-crash-logs-${new Date().toISOString()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error("Failed to export logs from error boundary", e)
    }
  }

  public render() {
    const { t } = this.props

    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-4 bg-background">
          <Card className="w-full max-w-lg border-destructive/50">
            <CardHeader>
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-6 h-6" />
                <CardTitle>{t("errorBoundary.title")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("errorBoundary.description")}
              </p>
              {this.state.error && (
                <div className="p-2 text-xs font-mono rounded bg-muted text-muted-foreground overflow-auto max-h-32">
                  {this.state.error.toString()}
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={this.handleExportLogs}>
                <Download className="w-4 h-4 mr-2" />
                {t("errorBoundary.exportLogs")}
              </Button>
              <Button
                variant="default"
                className="w-full sm:w-auto"
                onClick={this.handleReload}>
                <RefreshCw className="w-4 h-4 mr-2" />
                {t("errorBoundary.reload")}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryBase)
