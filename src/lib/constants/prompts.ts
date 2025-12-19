import type { PromptTemplate } from "@/types"

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "summarize",
    title: "Summarize Content",
    description: "Create concise bullet-point summaries of any content",
    category: "Analysis",
    userPrompt:
      "Summarize the following content in bullet points, highlighting the key information and main takeaways.",
    tags: ["summary", "analysis", "bullets"],
    usageCount: 0
  },
  {
    id: "explain-code",
    title: "Code Explanation",
    description: "Get detailed step-by-step code explanations",
    category: "Development",
    userPrompt:
      "Explain the following code step by step, including what each part does and how it works together.",
    tags: ["code", "explanation", "development"],
    usageCount: 0
  },
  {
    id: "translate",
    title: "Language Translation",
    description: "Translate text between different languages",
    category: "Language",
    userPrompt:
      "Translate the following text into English. If it's already in English, translate it to Spanish.",
    tags: ["translation", "language", "multilingual"],
    usageCount: 0
  },
  {
    id: "critique",
    title: "Content Critique",
    description: "Get constructive feedback and improvement suggestions",
    category: "Review",
    userPrompt:
      "Provide constructive critique for this content, highlighting strengths and areas for improvement with specific suggestions.",
    tags: ["critique", "feedback", "review"],
    usageCount: 0
  },
  {
    id: "brainstorm",
    title: "Idea Brainstorming",
    description: "Generate creative ideas and solutions",
    category: "Creative",
    userPrompt:
      "Help me brainstorm creative ideas for the following topic. Provide at least 10 diverse and innovative suggestions.",
    tags: ["brainstorm", "creative", "ideas"],
    usageCount: 0
  },
  {
    id: "debug-code",
    title: "Debug Code Issues",
    description: "Identify and fix code problems",
    category: "Development",
    userPrompt:
      "Help me debug this code. Identify any issues, explain what's wrong, and provide a corrected version.",
    tags: ["debug", "code", "fix", "development"],
    usageCount: 0
  },
  {
    id: "email-professional",
    title: "Professional Email",
    description: "Draft professional business emails",
    category: "Communication",
    userPrompt:
      "Help me write a professional email for the following situation. Make it clear, concise, and appropriately formal.",
    tags: ["email", "professional", "business"],
    usageCount: 0
  },
  {
    id: "research-outline",
    title: "Research Outline",
    description: "Create structured research outlines",
    category: "Research",
    userPrompt:
      "Create a comprehensive research outline for the following topic, including main sections, key questions, and potential sources.",
    tags: ["research", "outline", "structure"],
    usageCount: 0
  }
]
