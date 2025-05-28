import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+\n/g, "\n") // Remove trailing spaces before newlines
    .replace(/\n{3,}/g, "\n\n") // Limit consecutive newlines to 2
    .replace(/[ \t]{2,}/g, " ") // Convert multiple spaces/tabs to one space
    .trim()
}
