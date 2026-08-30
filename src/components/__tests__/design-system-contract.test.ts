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

const collectImportedIcons = (source: ts.SourceFile): Set<string> => {
  const importedIcons = new Set(["Icon"])
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (statement.moduleSpecifier.text !== "lucide-react") continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements)
      importedIcons.add(element.name.text)
  }
  return importedIcons
}

const jsxClassName = (
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  source: ts.SourceFile
): ts.JsxAttribute | undefined =>
  node.attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(source) === "className"
  )

const isIconTag = (tag: string, importedIcons: Set<string>): boolean =>
  importedIcons.has(tag) ||
  tag === "Icon" ||
  tag.endsWith("Icon") ||
  tag.endsWith(".icon")

const collectRawIconSizes = (
  path: string,
  source: ts.SourceFile,
  rawIconSize: RegExp,
  offenders: string[]
): void => {
  const importedIcons = collectImportedIcons(source)
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source)
      const className = isIconTag(tag, importedIcons)
        ? jsxClassName(node, source)
        : undefined
      if (className && rawIconSize.test(className.getText(source))) {
        offenders.push(location(path, source, className.getStart(source)))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

const isIconButton = (
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  source: ts.SourceFile
): boolean => {
  if (node.tagName.getText(source) !== "Button") return false
  const size = node.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "size"
  )
  return Boolean(
    size &&
      ts.isJsxAttribute(size) &&
      size.initializer &&
      ts.isStringLiteral(size.initializer) &&
      size.initializer.text.startsWith("icon")
  )
}

const isTooltipWrapper = (node: ts.Node, source: ts.SourceFile): boolean =>
  (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
  ["TooltipActionButton", "ModelMenu"].includes(node.tagName.getText(source))

const isWrappedIconButton = (node: ts.Node, source: ts.SourceFile): boolean => {
  let parent = node.parent
  while (parent) {
    if (isTooltipWrapper(parent, source)) return true
    parent = parent.parent
  }
  return false
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
      collectRawIconSizes(path, source, rawIconSize, offenders)
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

      const visit = (node: ts.Node): void => {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          isIconButton(node, source) &&
          !isWrappedIconButton(node, source)
        ) {
          offenders.push(location(path, source, node.getStart(source)))
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }

    expect(offenders).toEqual([])
  })
})
