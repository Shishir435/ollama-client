import DOMPurify from "dompurify"
import { createElement, type ReactNode } from "react"

const REACT_ATTRIBUTE_NAMES: Record<string, string> = {
  allowfullscreen: "allowFullScreen",
  autocapitalize: "autoCapitalize",
  autofocus: "autoFocus",
  charset: "charSet",
  class: "className",
  colspan: "colSpan",
  contenteditable: "contentEditable",
  crossorigin: "crossOrigin",
  datetime: "dateTime",
  for: "htmlFor",
  formnovalidate: "formNoValidate",
  "http-equiv": "httpEquiv",
  itemid: "itemID",
  itemprop: "itemProp",
  itemref: "itemRef",
  itemscope: "itemScope",
  itemtype: "itemType",
  novalidate: "noValidate",
  readonly: "readOnly",
  rowspan: "rowSpan",
  tabindex: "tabIndex"
}

const BOOLEAN_ATTRIBUTES = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "readonly",
  "required",
  "reversed",
  "selected"
])

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
])

const TABLE_STRUCTURE_ELEMENTS = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "colgroup"
])

const styleToObject = (value: string): Record<string, string> => {
  const style = document.createElement("span").style
  style.cssText = value
  const result: Record<string, string> = {}
  for (let index = 0; index < style.length; index++) {
    const property = style.item(index)
    const reactProperty = property.startsWith("--")
      ? property
      : property.replace(/-([a-z])/g, (_match, letter: string) =>
          letter.toUpperCase()
        )
    result[reactProperty] = style.getPropertyValue(property).trim()
  }
  return result
}

const getReactProps = (element: Element): Record<string, unknown> => {
  const props: Record<string, unknown> = {}
  const tagName = element.localName

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase()
    if (name.startsWith("on")) continue

    if (name === "style") {
      const style = styleToObject(attribute.value)
      if (Object.keys(style).length > 0) props.style = style
      continue
    }

    const isDataOrAria = name.startsWith("data-") || name.startsWith("aria-")
    const reactName = REACT_ATTRIBUTE_NAMES[name] ?? name
    if (
      !isDataOrAria &&
      !REACT_ATTRIBUTE_NAMES[name] &&
      !REACT_SAFE_ATTRIBUTES.has(name) &&
      !BOOLEAN_ATTRIBUTES.has(name)
    ) {
      continue
    }

    if (tagName === "input" && name === "checked") {
      props.defaultChecked = true
      continue
    }
    if (tagName === "option" && name === "selected") {
      props.defaultSelected = true
      continue
    }
    if ((tagName === "input" || tagName === "textarea") && name === "value") {
      if (tagName === "input" && element.getAttribute("type") === "file") {
        continue
      }
      props.defaultValue = attribute.value
      continue
    }

    if (BOOLEAN_ATTRIBUTES.has(name)) {
      props[reactName] = true
      continue
    }

    props[reactName] = attribute.value
  }

  return props
}

const REACT_SAFE_ATTRIBUTES = new Set([
  "abbr",
  "align",
  "alt",
  "cite",
  "dir",
  "download",
  "height",
  "href",
  "id",
  "lang",
  "name",
  "rel",
  "role",
  "scope",
  "src",
  "start",
  "target",
  "title",
  "type",
  "value",
  "width"
])

const toReactNode = (node: Node, key: string): ReactNode => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const element = node as Element
  const tagName = element.localName
  const props = { ...getReactProps(element), key }
  if (VOID_ELEMENTS.has(tagName)) return createElement(tagName, props)

  const childNodes = Array.from(element.childNodes).filter(
    (child) =>
      !(
        TABLE_STRUCTURE_ELEMENTS.has(tagName) &&
        child.nodeType === Node.TEXT_NODE &&
        !child.textContent?.trim()
      )
  )
  const children = childNodes.map((child, index) =>
    toReactNode(child, `${key}.${index}`)
  )
  return createElement(tagName, props, ...children)
}

/** Turn sanitized markup into React elements so the browser never inserts HTML strings. */
export const sanitizedHtmlToReactNodes = (html: string): ReactNode[] => {
  const sanitizedHtml = DOMPurify.sanitize(html)
  const parsed = new DOMParser().parseFromString(sanitizedHtml, "text/html")
  return Array.from(parsed.body.childNodes, (node, index) =>
    toReactNode(node, String(index))
  )
}
