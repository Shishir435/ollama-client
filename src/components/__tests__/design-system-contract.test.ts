import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()
const sourceRoot = join(repoRoot, "src")

const listSourceFiles = (dir: string): string[] => {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const relativePath = relative(sourceRoot, path)
    if (relativePath.includes("__tests__")) continue
    if (statSync(path).isDirectory()) {
      files.push(...listSourceFiles(path))
    } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      files.push(path)
    }
  }
  return files
}

const sourceFiles = listSourceFiles(sourceRoot)
const location = (path: string, source: ts.SourceFile, position: number) => {
  const { line } = source.getLineAndCharacterOfPosition(position)
  return `${relative(repoRoot, path)}:${line + 1}`
}

describe("design-system source contracts", () => {
  it("uses named typography and radius tokens", () => {
    const offenders = sourceFiles.flatMap((path) => {
      const text = readFileSync(path, "utf8")
      return text
        .split("\n")
        .flatMap((line, index) =>
          /\btext-\[[^\]]+\]|\brounded-(?:md|lg)\b/.test(line)
            ? [`${relative(repoRoot, path)}:${index + 1}`]
            : []
        )
    })

    expect(offenders).toEqual([])
  })

  it("uses icon size tokens for Lucide and dynamic icon components", () => {
    const rawIconSize = /\b(?:size|h|w)-(?:2\.5|3|3\.5|4|5|6|7|8)\b/
    const offenders: string[] = []

    for (const path of sourceFiles.filter((file) => file.endsWith(".tsx"))) {
      const text = readFileSync(path, "utf8")
      const source = ts.createSourceFile(
        path,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
      const importedIcons = new Set(["Icon"])

      for (const statement of source.statements) {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          !["lucide-react", "@/lib/lucide-icon"].includes(
            statement.moduleSpecifier.text
          )
        ) {
          continue
        }
        const bindings = statement.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            importedIcons.add(element.name.text)
          }
        }
      }

      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(source)
          const isIcon =
            importedIcons.has(tag) ||
            tag === "Icon" ||
            tag.endsWith("Icon") ||
            tag.endsWith(".icon")
          if (isIcon) {
            const className = node.attributes.properties.find(
              (attribute) =>
                ts.isJsxAttribute(attribute) &&
                attribute.name.getText(source) === "className"
            )
            if (className && rawIconSize.test(className.getText(source))) {
              offenders.push(location(path, source, className.getStart(source)))
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }

    expect(offenders).toEqual([])
  })

  it("uses icon tokens in primitive SVG defaults", () => {
    const offenders = sourceFiles.flatMap((path) => {
      const text = readFileSync(path, "utf8")
      return text
        .split("\n")
        .flatMap((line, index) =>
          line.includes("svg") && /\]:size-(?:2\.5|3|3\.5|4)\b/.test(line)
            ? [`${relative(repoRoot, path)}:${index + 1}`]
            : []
        )
    })

    expect(offenders).toEqual([])
  })

  it("wraps icon-only buttons in the shared tooltip action", () => {
    const offenders: string[] = []

    for (const path of sourceFiles.filter((file) => file.endsWith(".tsx"))) {
      const text = readFileSync(path, "utf8")
      const source = ts.createSourceFile(
        path,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )

      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText(source) === "Button"
        ) {
          const size = node.attributes.properties.find(
            (attribute) =>
              ts.isJsxAttribute(attribute) &&
              attribute.name.getText(source) === "size"
          )
          const isIconButton =
            size &&
            ts.isJsxAttribute(size) &&
            size.initializer &&
            ts.isStringLiteral(size.initializer) &&
            size.initializer.text.startsWith("icon")

          if (isIconButton) {
            let parent: ts.Node | undefined = node.parent
            let wrapped = false
            while (parent) {
              if (
                (ts.isJsxOpeningElement(parent) ||
                  ts.isJsxSelfClosingElement(parent)) &&
                ["TooltipActionButton", "ModelMenu"].includes(
                  parent.tagName.getText(source)
                )
              ) {
                wrapped = true
                break
              }
              parent = parent.parent
            }
            if (!wrapped) {
              offenders.push(location(path, source, node.getStart(source)))
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }

    expect(offenders).toEqual([])
  })
})
