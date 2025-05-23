import type { SocialLink } from "@/types"
import { Bug, Github, Globe, Instagram, Linkedin, Twitter } from "lucide-react"

export const MESSAGE_KEYS = {
  OLLAMA: {
    GET_MODELS: "get-ollama-models",
    CHAT_WITH_MODEL: "chat-with-model",
    STREAM_RESPONSE: "ollama-stream-response",
    STOP_GENERATION: "stop-generation"
  }
}

export const STORAGE_KEYS = {
  OLLAMA: {
    BASE_URL: "ollama-base-url",
    SELECTED_MODEL: "selected-ollama-model"
  },
  THEME: {
    PREFERENCE: "light-dark-theme"
  }
}

export const SOCIAL_LINKS: SocialLink[] = [
  {
    label: "GitHub Page",
    href: "https://github.com/Shishir435/ollama-client",
    icon: Github
  },
  {
    label: "Portfolio",
    href: "https://www.shishirchaurasiya.in/",
    icon: Globe
  },
  {
    label: "Twitter",
    href: "https://twitter.com/_shishir435",
    icon: Twitter
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/_shishir435/",
    icon: Instagram
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/shishir-chaurasiya/",
    icon: Linkedin
  },
  {
    label: "Report Bug / Feature",
    href: "https://github.com/Shishir435/ollama-client/issues",
    icon: Bug
  }
]
