import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

const buildDir = path.resolve(process.cwd(), "build")

const toUnicodeEscape = (codePoint) => {
  if (codePoint <= 0xffff) {
    return `\\u${codePoint.toString(16).padStart(4, "0")}`
  }

  const normalized = codePoint - 0x10000
  const high = 0xd800 + (normalized >> 10)
  const low = 0xdc00 + (normalized & 0x3ff)

  return `\\u${high.toString(16).padStart(4, "0")}\\u${low
    .toString(16)
    .padStart(4, "0")}`
}

const normalizeToAscii = (input) => {
  let replaced = 0
  let output = ""

  for (let index = 0; index < input.length; ) {
    const codePoint = input.codePointAt(index)
    const char = String.fromCodePoint(codePoint)

    if (codePoint > 0x7f) {
      output += toUnicodeEscape(codePoint)
      replaced += 1
    } else {
      output += char
    }

    index += char.length
  }

  return { output, replaced }
}

const walk = async (dir) => {
  const entries = await readdir(dir)
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry)
    const entryStat = await stat(fullPath)

    if (entryStat.isDirectory()) {
      files.push(...(await walk(fullPath)))
      continue
    }

    files.push(fullPath)
  }

  return files
}

const run = async () => {
  const files = await walk(buildDir)
  const jsFiles = files.filter((file) => file.endsWith(".js"))

  let updatedFiles = 0
  let replacedChars = 0

  for (const file of jsFiles) {
    const source = await readFile(file, "utf8")
    const normalized = normalizeToAscii(source)

    if (normalized.replaced === 0) {
      continue
    }

    await writeFile(file, normalized.output, "utf8")
    updatedFiles += 1
    replacedChars += normalized.replaced
  }

  console.log(
    `normalize-build-encoding: updated ${updatedFiles} file(s), replaced ${replacedChars} char(s)`
  )
}

await run()
