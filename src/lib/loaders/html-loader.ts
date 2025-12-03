import TurndownService from "turndown"
import type { DocumentLoader, HtmlLoaderOptions, LoaderDocument } from "./types"

/**
 * HTML Document Loader
 * Converts HTML to Markdown for clean text extraction
 */
export class HtmlLoader implements DocumentLoader {
  private html: string
  private url: string
  private turndownService: TurndownService

  constructor({ html, url }: HtmlLoaderOptions) {
    this.html = html
    this.url = url

    // Initialize Turndown service
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      emDelimiter: "_"
    })
  }

  /**
   * Load HTML and convert to markdown document
   */
  async load(): Promise<LoaderDocument[]> {
    try {
      // Convert HTML to Markdown
      const markdown = this.turndownService.turndown(this.html)

      const metadata = {
        source: this.url,
        type: "html"
      }

      return [
        {
          pageContent: markdown,
          metadata
        }
      ]
    } catch (error) {
      console.error("[HtmlLoader] Error converting HTML:", error)
      throw error
    }
  }
}
