import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import csharp from "highlight.js/lib/languages/csharp"
import css from "highlight.js/lib/languages/css"
import dockerfile from "highlight.js/lib/languages/dockerfile"
import go from "highlight.js/lib/languages/go"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import kotlin from "highlight.js/lib/languages/kotlin"
import markdown from "highlight.js/lib/languages/markdown"
import php from "highlight.js/lib/languages/php"
import python from "highlight.js/lib/languages/python"
import ruby from "highlight.js/lib/languages/ruby"
import rust from "highlight.js/lib/languages/rust"
import shell from "highlight.js/lib/languages/shell"
import sql from "highlight.js/lib/languages/sql"
import swift from "highlight.js/lib/languages/swift"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"

hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("python", python)
hljs.registerLanguage("java", java)
hljs.registerLanguage("c", c)
hljs.registerLanguage("cpp", cpp)
hljs.registerLanguage("csharp", csharp)
hljs.registerLanguage("go", go)
hljs.registerLanguage("rust", rust)
hljs.registerLanguage("php", php)
hljs.registerLanguage("ruby", ruby)
hljs.registerLanguage("bash", bash)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("yaml", yaml)
hljs.registerLanguage("html", xml)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("css", css)
hljs.registerLanguage("sql", sql)
hljs.registerLanguage("dockerfile", dockerfile)
hljs.registerLanguage("shell", shell)
hljs.registerLanguage("kotlin", kotlin)
hljs.registerLanguage("swift", swift)

export { hljs }
