import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { GUIDES } from "@/lib/constants"

export default function Guides() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Helpful Guides & Documentation</CardTitle>
        <CardDescription>
          Need help setting up Ollama Client or exploring features? Check out
          these useful links:
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
            {GUIDES.map(({ label, href }) => (
              <li key={href}>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline hover:text-primary/80">
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <div>
            <a
              href="https://www.producthunt.com/products/ollama-client?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-ollama&#0045;client"
              target="_blank">
              <img
                src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=975260&theme=light&t=1749479481982"
                alt="Ollama&#0032;Client - Chat&#0032;with&#0032;local&#0032;LLMs&#0032;—&#0032;right&#0032;inside&#0032;your&#0032;browser | Product Hunt"
                className="h-[54px] w-[250px]"
                width="250"
                height="54"
              />
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
