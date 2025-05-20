import { Button } from "@/components/ui/button"
import { useState } from "react"
import "../globals.css"
type OllamaModel = {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

function IndexSidePanel() {
  const [models, setModels] = useState<OllamaModel[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchModels = () => {
    chrome.runtime.sendMessage({ type: "get-ollama-models" }, (response) => {
      if (response.success) {
        setModels(response.data.models ?? [])
        setError(null)
      } else {
        setError("Failed to fetch models. Ensure Ollama is running.")
        setModels(null)
      }
    })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", padding: 16 }}>
      <Button onClick={fetchModels}>Fetch Ollama Models</Button>
      {error && <p style={{ color: "red" }}>{error}</p>}

      {models && (
        <ul>
          {models.map((model) => (
            <li key={model.name} style={{ marginBottom: 12 }}>
              <strong>{model.name}</strong> ({model.model}) <br />
              Size: {(model.size / (1024 * 1024)).toFixed(2)} MB <br />
              Modified: {new Date(model.modified_at).toLocaleString()} <br />
              Format: {model.details.format}, Params: {model.details.parameter_size} <br />
              Quantization: {model.details.quantization_level}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default IndexSidePanel
