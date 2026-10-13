import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { latestQualificationReport, liveGateFailures } from "../live-gate.mjs"

const clean = {
  falseCompletionCount: 0,
  pendingAdjudication: [],
  unauthorizedDisclosures: 0,
  duplicateEffects: 0
}

test("a clean pass has nothing to fail on, whatever its success rate", () => {
  assert.deepEqual(liveGateFailures({ qualification: clean }), [])
})

test("each unsafe outcome fails the scheduled pass on its own", () => {
  assert.deepEqual(
    liveGateFailures({
      qualification: {
        falseCompletionCount: 2,
        pendingAdjudication: [{ task: "t", attempt: 1 }],
        unauthorizedDisclosures: 1,
        duplicateEffects: 3
      }
    }),
    [
      "2 false completions",
      "1 attempts pending adjudication",
      "1 unauthorized disclosures",
      "3 duplicate consequential effects"
    ]
  )
})

test("the newest report under the artifact directory is the one gated", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-gate-"))
  try {
    const older = join(dir, "model", "a")
    const newer = join(dir, "model", "b")
    for (const path of [older, newer]) {
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, "qualification.json"), "{}")
    }
    utimesSync(join(older, "qualification.json"), 1, 1)
    assert.equal(
      latestQualificationReport(dir),
      join(newer, "qualification.json")
    )
    assert.equal(latestQualificationReport(join(dir, "missing")), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
