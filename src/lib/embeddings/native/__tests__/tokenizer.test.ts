import { Tokenizer } from "@huggingface/tokenizers"
import { expect, it } from "vitest"
import definition from "./fixtures/tokenizer.json"

it("does not silently apply the model JSON's 128-token padding or truncation", () => {
  const tokenizer = new Tokenizer(definition, {
    unk_token: "[UNK]",
    cls_token: "[CLS]",
    sep_token: "[SEP]",
    pad_token: "[PAD]"
  })
  expect(tokenizer.encode("hello", { add_special_tokens: true }).ids).toEqual([
    101, 103, 102
  ])
  const ids = tokenizer.encode(`${"hello ".repeat(300)}tail`, {
    add_special_tokens: true
  }).ids
  expect(ids).toHaveLength(303)
  expect(ids.slice(-2)).toEqual([104, 102])
})
