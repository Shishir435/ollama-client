import { useRef, useState } from "react"

import {
  BarChart3,
  Calendar,
  Copy,
  CopyCheck,
  Download,
  FileText,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload
} from "lucide-react"
import { v4 as uuidv4 } from "uuid"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { usePromptTemplates } from "@/features/prompt/hooks/use-prompt-templates"
import type { PromptTemplate } from "@/types"

export const PromptTemplateManager = () => {
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    importTemplates,
    exportTemplates,
    resetToDefaults,
    getCategories
  } = usePromptTemplates()

  const [activeTab, setActiveTab] = useState("new")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [sortBy, setSortBy] = useState<"recent" | "popular" | "alphabetical">(
    "recent"
  )
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [newTemplate, setNewTemplate] = useState({
    title: "",
    description: "",
    category: "",
    userPrompt: "",
    systemPrompt: "",
    tags: ""
  })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const categories = getCategories()

  const filteredTemplates =
    templates
      ?.filter((template) => {
        const matchesSearch =
          !searchQuery ||
          template.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          template.description
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          template.userPrompt.toLowerCase().includes(searchQuery.toLowerCase())

        const matchesCategory =
          selectedCategory === "all" || template.category === selectedCategory

        return matchesSearch && matchesCategory
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "popular":
            return (b.usageCount || 0) - (a.usageCount || 0)
          case "alphabetical":
            return a.title.localeCompare(b.title)
          case "recent":
          default:
            return (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
        }
      }) || []

  const handleAddTemplate = () => {
    if (!newTemplate.title.trim() || !newTemplate.userPrompt.trim()) return

    const template: Omit<PromptTemplate, "createdAt" | "usageCount"> = {
      id: uuidv4(),
      title: newTemplate.title.trim(),
      description: newTemplate.description.trim() || undefined,
      category: newTemplate.category.trim() || undefined,
      userPrompt: newTemplate.userPrompt.trim(),
      systemPrompt: newTemplate.systemPrompt.trim() || undefined,
      tags: newTemplate.tags.trim()
        ? newTemplate.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined
    }

    addTemplate(template)
    setNewTemplate({
      title: "",
      description: "",
      category: "",
      userPrompt: "",
      systemPrompt: "",
      tags: ""
    })
    setActiveTab(template.id)
  }

  const handleExport = () => {
    const dataStr = JSON.stringify(exportTemplates(), null, 2)
    const dataUri =
      "data:application/json;charset=utf-8," + encodeURIComponent(dataStr)

    const exportFileDefaultName = `prompt-templates-${new Date().toISOString().split("T")[0]}.json`

    const linkElement = document.createElement("a")
    linkElement.setAttribute("href", dataUri)
    linkElement.setAttribute("download", exportFileDefaultName)
    linkElement.click()
  }

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(
          e.target?.result as string
        ) as PromptTemplate[]
        importTemplates(imported)
      } catch (error) {
        console.error("Failed to import templates:", error)
        alert("Failed to import templates. Please check the file format.")
      }
    }
    reader.readAsText(file)

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error("Failed to copy: ", err)
    }
  }

  return (
    <div className="mx-auto space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-xl">Prompt Templates</CardTitle>
              </div>
              <CardDescription>
                Manage your collection of {templates?.length || 0} prompt
                templates
              </CardDescription>
            </div>

            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleExport}>
                    <Download className="mr-2 h-4 w-4" />
                    Export Templates
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => fileInputRef.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" />
                    Import Templates
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Reset to Defaults
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Reset to Default Templates?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This will replace all your current templates with the
                          default ones. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={resetToDefaults}>
                          Reset Templates
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="mt-4 flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select
              value={selectedCategory}
              onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={sortBy}
              onValueChange={(value: any) => setSortBy(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recent</SelectItem>
                <SelectItem value="popular">Popular</SelectItem>
                <SelectItem value="alphabetical">A-Z</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full">
            <ScrollArea className="w-full">
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 p-1">
                <TabsTrigger
                  value="new"
                  className="flex items-center gap-2 text-xs sm:text-sm">
                  <Plus className="h-4 w-4" />
                  New Template
                </TabsTrigger>
                {filteredTemplates.map((template) => (
                  <TabsTrigger
                    key={template.id}
                    value={template.id}
                    className="flex max-w-[200px] items-center gap-2 text-xs sm:text-sm">
                    <span className="truncate">
                      {template.title || "Untitled"}
                    </span>
                    {(template.usageCount || 0) > 0 && (
                      <Badge variant="secondary" className="px-1 py-0 text-xs">
                        {template.usageCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </ScrollArea>

            <TabsContent value="new" className="space-y-4">
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title *</Label>
                    <Input
                      id="title"
                      placeholder="Template title"
                      value={newTemplate.title}
                      onChange={(e) =>
                        setNewTemplate((prev) => ({
                          ...prev,
                          title: e.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Input
                      id="category"
                      placeholder="e.g., Development, Writing"
                      value={newTemplate.category}
                      onChange={(e) =>
                        setNewTemplate((prev) => ({
                          ...prev,
                          category: e.target.value
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    placeholder="Brief description of what this template does"
                    value={newTemplate.description}
                    onChange={(e) =>
                      setNewTemplate((prev) => ({
                        ...prev,
                        description: e.target.value
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tags">Tags</Label>
                  <Input
                    id="tags"
                    placeholder="tag1, tag2, tag3"
                    value={newTemplate.tags}
                    onChange={(e) =>
                      setNewTemplate((prev) => ({
                        ...prev,
                        tags: e.target.value
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="user-prompt">User Prompt *</Label>
                  <Textarea
                    id="user-prompt"
                    placeholder="The main prompt template"
                    rows={4}
                    value={newTemplate.userPrompt}
                    onChange={(e) =>
                      setNewTemplate((prev) => ({
                        ...prev,
                        userPrompt: e.target.value
                      }))
                    }
                  />
                </div>

                <Button
                  onClick={handleAddTemplate}
                  disabled={
                    !newTemplate.title.trim() || !newTemplate.userPrompt.trim()
                  }
                  className="w-full">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Template
                </Button>
              </div>
            </TabsContent>

            {filteredTemplates.map((template) => (
              <TabsContent
                key={template.id}
                value={template.id}
                className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{template.title}</h3>
                    {template.category && (
                      <Badge variant="outline">{template.category}</Badge>
                    )}
                    {(template.usageCount || 0) > 0 && (
                      <Badge variant="secondary" className="gap-1">
                        <BarChart3 className="h-3 w-3" />
                        {template.usageCount}
                      </Badge>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(template.userPrompt, template.id)
                      }>
                      {copiedId === template.id ? (
                        <CopyCheck className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Template</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{template.title}"?
                            This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteTemplate(template.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Title</Label>
                      <Input
                        value={template.title}
                        onChange={(e) =>
                          updateTemplate(template.id, { title: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Input
                        value={template.category || ""}
                        placeholder="e.g., Development, Writing"
                        onChange={(e) =>
                          updateTemplate(template.id, {
                            category: e.target.value || undefined
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input
                      value={template.description || ""}
                      placeholder="Brief description"
                      onChange={(e) =>
                        updateTemplate(template.id, {
                          description: e.target.value || undefined
                        })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Tags</Label>
                    <Input
                      value={template.tags?.join(", ") || ""}
                      placeholder="tag1, tag2, tag3"
                      onChange={(e) =>
                        updateTemplate(template.id, {
                          tags: e.target.value
                            ? e.target.value
                                .split(",")
                                .map((tag) => tag.trim())
                                .filter(Boolean)
                            : undefined
                        })
                      }
                    />
                  </div>

                  {template.systemPrompt !== undefined && (
                    <div className="space-y-2">
                      <Label>System Prompt</Label>
                      <Textarea
                        value={template.systemPrompt || ""}
                        rows={3}
                        onChange={(e) =>
                          updateTemplate(template.id, {
                            systemPrompt: e.target.value || undefined
                          })
                        }
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>User Prompt</Label>
                    <Textarea
                      value={template.userPrompt}
                      rows={4}
                      onChange={(e) =>
                        updateTemplate(template.id, {
                          userPrompt: e.target.value
                        })
                      }
                    />
                  </div>

                  {(template.createdAt || template.usageCount) && (
                    <div className="flex gap-4 border-t pt-2 text-sm text-muted-foreground">
                      {template.createdAt && (
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Created {template.createdAt.toLocaleDateString()}
                        </div>
                      )}
                      {(template.usageCount || 0) > 0 && (
                        <div className="flex items-center gap-1">
                          <Star className="h-3 w-3" />
                          Used {template.usageCount} times
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            style={{ display: "none" }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
