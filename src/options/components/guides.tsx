import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { GUIDES } from "@/lib/constants-ui"
import { ExternalLink, Notebook } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export const Guides = () => {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Notebook className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">
              Helpful Guides & Documentation
            </CardTitle>
          </div>
          <CardDescription className="text-sm">
            Need help setting up Ollama Client or exploring features? Check out
            these useful resources
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-3">
            {GUIDES.map(({ label, href, description, badge, icon: Icon }) => (
              <Card
                key={href}
                className="group transition-all hover:border-primary/20 hover:shadow-sm">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex-shrink-0 text-muted-foreground transition-colors group-hover:text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <h4 className="truncate text-sm font-medium">
                          {label}
                        </h4>
                        <Badge
                          variant="secondary"
                          className="flex-shrink-0 text-xs">
                          {badge}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {description}
                      </p>
                    </div>
                  </div>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      buttonVariants({ variant: "link" }),
                      "flex items-center justify-center"
                    )}>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="border-t pt-4">
            <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
              <div className="text-center sm:text-left">
                <h4 className="mb-1 text-sm font-medium">
                  Support the Project
                </h4>
                <p className="text-xs text-muted-foreground">
                  Help us grow by featuring Ollama Client on Product Hunt
                </p>
              </div>
              <div className="flex-shrink-0">
                <a
                  href="https://www.producthunt.com/products/ollama-client?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-ollama&#0045;client"
                  target="_blank"
                  rel="noreferrer"
                  className="block transition-opacity hover:opacity-80">
                  <img
                    src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=975260&theme=light&t=1749479481982"
                    alt="Ollama Client - Chat with local LLMs — right inside your browser | Product Hunt"
                    className="h-[48px] w-[220px] rounded border"
                    width="220"
                    height="48"
                  />
                </a>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
