import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

/** Walk emitted static imports/re-exports once; import() remains lazy. */
export const eagerPageFiles = (
  outputDir: string,
  htmlName: string
): string[] => {
  const root = path.resolve(outputDir)
  const seen = new Set<string>()
  const visit = (file: string): void => {
    if (seen.has(file)) return
    if (!fs.existsSync(file)) throw new Error(`Missing eager asset: ${file}`)
    seen.add(file)
    if (!/\.m?js$/.test(file)) return
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest
    )
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement)
      )
        continue
      const specifier = statement.moduleSpecifier
      if (specifier && ts.isStringLiteral(specifier))
        resolveAndVisit(specifier.text, file)
    }
  }
  const resolveAndVisit = (specifier: string, importer: string): void => {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(specifier)) return
    const pathname = specifier.split(/[?#]/)[0]
    const file = pathname.startsWith("/")
      ? path.join(root, pathname.slice(1))
      : path.resolve(path.dirname(importer), pathname)
    if (!file.startsWith(`${root}${path.sep}`))
      throw new Error(`Eager asset outside output: ${specifier}`)
    visit(file)
  }
  const htmlPath = path.join(root, htmlName)
  visit(htmlPath)
  const html = fs.readFileSync(htmlPath, "utf8")
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[0]
    const attributes = new Map(
      [...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map((attribute) => [
        attribute[1].toLowerCase(),
        attribute[2]
      ])
    )
    if (match[1].toLowerCase() === "script") {
      const src = attributes.get("src")
      if (src) resolveAndVisit(src, htmlPath)
    } else if (
      ["stylesheet", "modulepreload"].includes(attributes.get("rel") ?? "")
    ) {
      const href = attributes.get("href")
      if (href) resolveAndVisit(href, htmlPath)
    }
  }
  return [...seen]
}
