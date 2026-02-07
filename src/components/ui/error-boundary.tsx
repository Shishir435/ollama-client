import { AlertCircle, RefreshCw } from "lucide-react"
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
            <CardFooter>
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
