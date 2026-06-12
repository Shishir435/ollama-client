import { describe, expect, it } from "vitest"
import { splitDropFiles } from "../drop-file-policy"

describe("drop-file-policy", () => {
  it("separates current file attachments from future image attachments", () => {
    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" })
    const imageFile = new File(["png"], "image.png", { type: "image/png" })

    const result = splitDropFiles([textFile, imageFile])

    expect(result.acceptedFiles).toEqual([textFile])
    expect(result.rejectedImages).toEqual([imageFile])
  })
})
