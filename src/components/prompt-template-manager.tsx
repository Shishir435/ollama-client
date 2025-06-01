import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { usePromptTemplates } from "@/hooks/use-prompt-templates"
import { Trash2 } from "lucide-react"
import { useState } from "react"
import { v4 as uuidv4 } from "uuid"

export const PromptTemplateManager = () => {
  const { templates, addTemplate, updateTemplate, deleteTemplate } =
    usePromptTemplates()

  const [newName, setNewName] = useState("")
  const [newContent, setNewContent] = useState("")

  const handleAdd = () => {
    if (!newName.trim() || !newContent.trim()) return
    const newTemplate = {
      id: uuidv4(),
      title: newName.trim(),
      userPrompt: newContent.trim()
    }
    addTemplate(newTemplate)
    setNewName("")
    setNewContent("")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Prompt Templates</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        <Tabs defaultValue={templates[0]?.id ?? "new"} className="w-full">
          <TabsList className="flex h-auto max-w-full flex-wrap justify-evenly gap-2">
            <TabsTrigger value="new" className="text-xs sm:text-sm">
              ➕ New
            </TabsTrigger>
            {templates.map((template) => (
              <TabsTrigger
                key={template.id}
                value={template.id}
                className="max-w-[150px] truncate text-xs sm:text-sm">
                {template.title || "Untitled"}
              </TabsTrigger>
            ))}
          </TabsList>

          {templates.map((template) => (
            <TabsContent key={template.id} value={template.id}>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <Input
                    value={template.title}
                    placeholder="Template title"
                    onChange={(e) =>
                      updateTemplate(template.id, { title: e.target.value })
                    }
                  />
                  <Button
                    variant="destructive"
                    onClick={() => deleteTemplate(template.id)}>
                    <Trash2 className="mr-1 h-4 w-4" />
                    Delete
                  </Button>
                </div>
                <Textarea
                  value={template.userPrompt}
                  placeholder="Template content"
                  rows={3}
                  onChange={(e) =>
                    updateTemplate(template.id, {
                      userPrompt: e.target.value
                    })
                  }
                />
              </div>
            </TabsContent>
          ))}

          <TabsContent value="new">
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between gap-2">
                <Input
                  placeholder="New Template Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Button onClick={handleAdd}>Add Template</Button>
              </div>
              <Textarea
                placeholder="New Template Content"
                rows={3}
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
