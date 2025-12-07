import { render, screen } from "@testing-library/react"
import { Globe } from "lucide-react"
import { describe, expect, it } from "vitest"
import { SettingsCard } from "../settings-card"


describe("SettingsCard", () => {
  it("renders with title and description", () => {
    render(
      <SettingsCard title="Test Title" description="Test Description">
        <div>Test Content</div>
      </SettingsCard>
    )

    expect(screen.getByText("Test Title")).toBeInTheDocument()
    expect(screen.getByText("Test Description")).toBeInTheDocument()
    expect(screen.getByText("Test Content")).toBeInTheDocument()
  })

  it("renders with icon when provided", () => {
    const { container } = render(
      <SettingsCard
        icon={Globe}
        title="Test Title"
        description="Test Description">
        <div>Content</div>
      </SettingsCard>
    )

    const icon = container.querySelector("svg")
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass("h-5", "w-5", "text-muted-foreground")
  })

  it("renders badge when provided", () => {
    render(
      <SettingsCard
        title="Test Title"
        description="Test Description"
        badge="Beta">
        <div>Content</div>
      </SettingsCard>
    )

    expect(screen.getByText("Beta")).toBeInTheDocument()
  })

  it("does not render icon or badge when not provided", () => {
    const { container } = render(
      <SettingsCard title="Test Title" description="Test Description">
        <div>Content</div>
      </SettingsCard>
    )

    const icon = container.querySelector("svg")
    expect(icon).not.toBeInTheDocument()
    expect(screen.queryByText("Beta")).not.toBeInTheDocument()
  })

  it("applies custom className to Card", () => {
    const { container } = render(
      <SettingsCard
        title="Test Title"
        description="Test Description"
        className="custom-class">
        <div>Content</div>
      </SettingsCard>
    )

    const card = container.firstChild
    expect(card).toHaveClass("custom-class")
  })

  it("applies custom headerClassName", () => {
    const { container } = render(
      <SettingsCard
        title="Test Title"
        description="Test Description"
        headerClassName="custom-header">
        <div>Content</div>
      </SettingsCard>
    )

    // CardHeader is the element with custom-header class
    const cardHeader = container.querySelector(".custom-header")
    expect(cardHeader).toBeInTheDocument()
  })

  it("applies default pb-4 class when headerClassName not provided", () => {
    const { container } = render(
      <SettingsCard title="Test Title" description="Test Description">
        <div>Content</div>
      </SettingsCard>
    )

    // CardHeader should have pb-4 class by default
    const cardHeader = container.querySelector(".pb-4")
    expect(cardHeader).toBeInTheDocument()
  })

  it("applies custom contentClassName", () => {
    render(
      <SettingsCard
        title="Test Title"
        description="Test Description"
        contentClassName="custom-content">
        <div>Content</div>
      </SettingsCard>
    )

    const content = screen.getByText("Content").parentElement
    expect(content).toHaveClass("custom-content")
  })

  it("applies default space-y-4 class when contentClassName not provided", () => {
    render(
      <SettingsCard title="Test Title" description="Test Description">
        <div>Content</div>
      </SettingsCard>
    )

    const content = screen.getByText("Content").parentElement
    expect(content).toHaveClass("space-y-4")
  })

  it("renders children correctly", () => {
    render(
      <SettingsCard title="Test Title" description="Test Description">
        <div>Child 1</div>
        <div>Child 2</div>
      </SettingsCard>
    )

    expect(screen.getByText("Child 1")).toBeInTheDocument()
    expect(screen.getByText("Child 2")).toBeInTheDocument()
  })
})
