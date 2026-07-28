import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  backend: vi.fn(),
  query: vi.fn(),
  run: vi.fn(),
  txBegin: vi.fn(),
  txCommit: vi.fn(),
  txRollback: vi.fn()
}))

vi.mock("@/lib/persistence/backend", () => ({
  readPersistenceBackend: mocks.backend
}))

vi.mock("@/lib/persistence/client", () => ({
  rpcExportDb: vi.fn(),
  rpcImportDb: vi.fn(),
  rpcPing: vi.fn(),
  rpcQuery: mocks.query,
  rpcReset: vi.fn(),
  rpcRun: mocks.run,
  rpcTxBegin: mocks.txBegin,
  rpcTxCommit: mocks.txCommit,
  rpcTxRollback: mocks.txRollback
}))

import { run, withTransaction } from "../db"

describe("SQLite transaction scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.backend.mockResolvedValue("opfs")
    mocks.query.mockResolvedValue([])
    mocks.run.mockResolvedValue({ lastInsertRowid: 0, changes: 1 })
    mocks.txBegin.mockResolvedValue(undefined)
    mocks.txCommit.mockResolvedValue(undefined)
    mocks.txRollback.mockResolvedValue(undefined)
  })

  it("parks unrelated statements instead of inheriting an active token", async () => {
    let finishRead: (() => void) | undefined
    mocks.query.mockImplementationOnce(
      () =>
        new Promise<never[]>((resolve) => {
          finishRead = () => resolve([])
        })
    )

    const transaction = withTransaction(async (tx) => {
      await tx.query("SELECT usageCount FROM prompt_templates")
      await tx.run("UPDATE prompt_templates SET title = 'Updated'")
    })

    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledOnce())
    const standalone = run(
      "UPDATE prompt_templates SET usageCount = usageCount + 1"
    )

    await Promise.resolve()
    expect(mocks.run).not.toHaveBeenCalled()

    finishRead?.()
    await transaction
    await standalone

    const token = mocks.txBegin.mock.calls[0]?.[0]
    expect(token).toEqual(expect.any(String))
    expect(mocks.query).toHaveBeenCalledWith(
      "SELECT usageCount FROM prompt_templates",
      [],
      token
    )
    expect(mocks.run).toHaveBeenNthCalledWith(
      1,
      "UPDATE prompt_templates SET title = 'Updated'",
      [],
      token
    )
    expect(mocks.run).toHaveBeenNthCalledWith(
      2,
      "UPDATE prompt_templates SET usageCount = usageCount + 1",
      [],
      undefined
    )
    expect(mocks.txCommit).toHaveBeenCalledWith(token)
  })
})
