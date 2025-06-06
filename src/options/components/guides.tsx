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
      </CardContent>
    </Card>
  )
}
