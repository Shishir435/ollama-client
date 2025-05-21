import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Terminal } from "lucide-react"

export default function OllamaSetupInstructions() {
  return (
    <div className="space-y-4 p-4">
      <Alert>
        <Terminal className="h-5 w-5" />
        <AlertTitle>Ollama Configuration Required</AlertTitle>
        <AlertDescription>
          To avoid CORS issues, configure your Ollama server to allow requests
          from Chrome extensions.
        </AlertDescription>
      </Alert>

      <Accordion type="single" collapsible className="w-full">
        {/* macOS */}
        <AccordionItem value="macos">
          <AccordionTrigger>🖥️ macOS</AccordionTrigger>
          <AccordionContent>
            <p className="mb-2">If you’re using a Launch Agent:</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Open terminal and run:{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  nano ~/Library/LaunchAgents/com.ollama.server.plist
                </code>
              </li>
              <li>
                Add this inside{" "}
                <code>&lt;key&gt;EnvironmentVariables&lt;/key&gt;</code>:
                <pre className="mt-2 rounded bg-muted p-2 text-sm">
                  {`<key>OLLAMA_ORIGINS</key>
<string>chrome-extension://*</string>`}
                </pre>
              </li>
              <li>
                Save the file and reload the Launch Agent:
                <pre className="mt-2 rounded bg-muted p-2 text-sm">
                  {`launchctl unload ~/Library/LaunchAgents/com.ollama.server.plist
launchctl load -w ~/Library/LaunchAgents/com.ollama.server.plist`}
                </pre>
              </li>
            </ol>
          </AccordionContent>
        </AccordionItem>

        {/* Linux */}
        <AccordionItem value="linux">
          <AccordionTrigger>🐧 Linux (systemd)</AccordionTrigger>
          <AccordionContent>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Edit the Ollama service:
                <pre className="mt-2 rounded bg-muted p-2 text-sm">
                  sudo systemctl edit --full ollama.service
                </pre>
              </li>
              <li>
                Under <code>[Service]</code>, add:
                <pre className="mt-2 rounded bg-muted p-2 text-sm">
                  Environment="OLLAMA_ORIGINS=chrome-extension://*"
                </pre>
              </li>
              <li>
                Reload and restart:
                <pre className="mt-2 rounded bg-muted p-2 text-sm">
                  {`sudo systemctl daemon-reload
sudo systemctl restart ollama`}
                </pre>
              </li>
            </ol>
          </AccordionContent>
        </AccordionItem>

        {/* Windows */}
        <AccordionItem value="windows">
          <AccordionTrigger>🪟 Windows</AccordionTrigger>
          <AccordionContent>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Open Run (Win + R), type <code>sysdm.cpl</code>, and press
                Enter.
              </li>
              <li>
                Go to the <strong>Advanced</strong> tab → click{" "}
                <strong>Environment Variables</strong>.
              </li>
              <li>
                Add a new <strong>User Variable</strong>:
                <ul className="mt-2 list-disc pl-5">
                  <li>
                    <strong>Name:</strong> <code>OLLAMA_ORIGINS</code>
                  </li>
                  <li>
                    <strong>Value:</strong> <code>chrome-extension://*</code>
                  </li>
                </ul>
              </li>
              <li>Restart Ollama for the changes to take effect.</li>
            </ol>
          </AccordionContent>
        </AccordionItem>

        {/* Extra tip */}
        <AccordionItem value="multi-origin">
          <AccordionTrigger>💡 Allowing Multiple Origins</AccordionTrigger>
          <AccordionContent>
            <p>
              If you want to allow multiple origins (e.g., localhost +
              extension), use:
            </p>
            <pre className="mt-2 rounded bg-muted p-2 text-sm">
              OLLAMA_ORIGINS=chrome-extension://*,http://localhost:3000
            </pre>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
