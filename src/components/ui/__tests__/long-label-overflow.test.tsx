import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Tabs, TabsList, TabsTrigger } from "../tabs"

const GERMAN = "Geschwindigkeitsbegrenzungsüberwachung"
const RUSSIAN = "Автоматизированная проверка совместимости"

describe("long localized labels", () => {
  it.each([GERMAN, RUSSIAN])(
    "lets a segmented tab wrap instead of clipping (%s)",
    (label) => {
      render(
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">{label}</TabsTrigger>
          </TabsList>
        </Tabs>
      )
      const tab = screen.getByRole("tab", { name: label })
      expect(tab.className).toContain("min-w-0")
      expect(tab.className).toContain("wrap-anywhere")
      expect(tab.className).not.toContain("whitespace-nowrap")
    }
  )
})
