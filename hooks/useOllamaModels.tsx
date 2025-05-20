import { useEffect, useState } from "react";
import type { OllamaModel } from "@/types";
import { MESSAGE_KEYS } from "@/lib/constant";

export function useOllamaModels() {
  const [models, setModels] = useState<OllamaModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchModels = () => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: MESSAGE_KEYS.OLLAMA.GET_MODELS }, (response) => {
      if (response?.success) {
        setModels(response.data.models ?? []);
        setError(null);
      } else {
        setError("Failed to fetch models. Ensure Ollama is running or check the base URL.");
        setModels(null);
      }
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchModels();
  }, []);

  return { models, error, loading, refresh: fetchModels };
}
