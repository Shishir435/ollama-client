import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_CHANGELOG = path.join(__dirname, "../CHANGELOG.md")
const DOCS_OUTPUT = path.join(
  __dirname,
  "../docs-src/src/content/docs/about/changelog.md"
)

function generateChangelogDocs() {
  console.log("📦 Generating changelog docs...")

  if (!fs.existsSync(ROOT_CHANGELOG)) {
    console.error(`❌ CHANGELOG.md not found at ${ROOT_CHANGELOG}`)
    process.exit(1)
  }

  const changelog = fs.readFileSync(ROOT_CHANGELOG, "utf-8")

  const frontmatter = `---
title: Changelog
description: Release history for Ollama Client.
---
`

  const content = `${frontmatter}
${changelog}
`

  fs.writeFileSync(DOCS_OUTPUT, content)
  console.log(`✨ Generated changelog docs at ${DOCS_OUTPUT}`)
}

generateChangelogDocs()
