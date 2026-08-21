#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

fs.appendFileSync(path.join(process.cwd(), "pids"), `${process.pid}\n`)
process.stdin.resume()
