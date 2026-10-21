import DOMPurify from "dompurify"
import { createElement, type ReactNode } from "react"

const SVG_NAMESPACE = "http://www.w3.org/2000/svg"

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
  tabindex: "tabIndex",
  "accent-height": "accentHeight",
  "alignment-baseline": "alignmentBaseline",
  "baseline-shift": "baselineShift",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "color-interpolation": "colorInterpolation",
  "color-interpolation-filters": "colorInterpolationFilters",
  "color-rendering": "colorRendering",
  "dominant-baseline": "dominantBaseline",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "flood-color": "floodColor",
  "flood-opacity": "floodOpacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-style": "fontStyle",
  "font-weight": "fontWeight",
  "marker-end": "markerEnd",
  "marker-mid": "markerMid",
  "marker-start": "markerStart",
  pathlength: "pathLength",
  patterncontentunits: "patternContentUnits",
  patterntransform: "patternTransform",
  patternunits: "patternUnits",
  preserveaspectratio: "preserveAspectRatio",
  refx: "refX",
  refy: "refY",
  "shape-rendering": "shapeRendering",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stroke-width": "strokeWidth",
  "text-anchor": "textAnchor",
  "text-decoration": "textDecoration",
  "text-rendering": "textRendering",
  "vector-effect": "vectorEffect",
  viewbox: "viewBox",
  "word-spacing": "wordSpacing",
  "writing-mode": "writingMode",
  "xlink:href": "xlinkHref",
  "xml:lang": "xmlLang",
  "xml:space": "xmlSpace"
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
  const isSvgElement = element.namespaceURI === SVG_NAMESPACE

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
      !(isSvgElement && SVG_SAFE_ATTRIBUTES.has(name)) &&
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

const SVG_SAFE_ATTRIBUTES = new Set([
  "accent-height",
  "alignment-baseline",
  "baseline-shift",
  "clip-path",
  "clip-rule",
  "color",
  "color-interpolation",
  "color-interpolation-filters",
  "color-rendering",
  "cx",
  "cy",
  "d",
  "direction",
  "display",
  "dominant-baseline",
  "fill",
  "fill-opacity",
  "fill-rule",
  "filter",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "height",
  "href",
  "marker-end",
  "marker-mid",
  "marker-start",
  "opacity",
  "pathlength",
  "points",
  "preserveaspectratio",
  "r",
  "refx",
  "refy",
  "shape-rendering",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "text-decoration",
  "text-rendering",
  "transform",
  "vector-effect",
  "viewbox",
  "visibility",
  "width",
  "word-spacing",
  "writing-mode",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2"
])

export interface SanitizedHtmlCodeBlock {
  key: string
  code: string
  language: string
  pre: ReactNode
}

type CodeBlockRenderer = (block: SanitizedHtmlCodeBlock) => ReactNode

const toReactNode = (
  node: Node,
  key: string,
  renderCodeBlock?: CodeBlockRenderer
): ReactNode => {
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
    toReactNode(child, `${key}.${index}`, renderCodeBlock)
  )
  const reactElement = createElement(tagName, props, ...children)
  if (tagName === "pre" && renderCodeBlock) {
    return renderCodeBlock({
      key,
      code: element.querySelector("code")?.textContent ?? "",
      language: element.getAttribute("data-code-language") ?? "",
      pre: reactElement
    })
  }
  return reactElement
}

/** Turn sanitized markup into React elements so the browser never inserts HTML strings. */
export const sanitizedHtmlToReactNodes = (
  html: string,
  renderCodeBlock?: CodeBlockRenderer
): ReactNode[] => {
  const sanitizedHtml = DOMPurify.sanitize(html)
  const parsed = new DOMParser().parseFromString(sanitizedHtml, "text/html")
  return Array.from(parsed.body.childNodes, (node, index) =>
    toReactNode(node, String(index), renderCodeBlock)
  )
}
