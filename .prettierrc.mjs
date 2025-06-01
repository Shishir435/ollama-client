/**
 * @type {import('prettier').Options}
 */
export default {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: false,
  singleQuote: false,
  trailingComma: "none",
  bracketSpacing: true,
  bracketSameLine: true,
  plugins: [
    "@ianvs/prettier-plugin-sort-imports",
    "prettier-plugin-tailwindcss"
  ],
  importOrder: [
    "^react$", // React first
    "^react/(.*)$", // Then React submodules
    "",

    "<BUILTIN_MODULES>", // Node.js built-ins
    "<THIRD_PARTY_MODULES>", // All other 3rd party modules
    "",

    "^@/components/(.*)$",
    "^@/hooks/(.*)$",
    "^@/context/(.*)$",
    "^@/lib/(.*)$",
    "^@/(.*)$", // Catch-all for other aliases
    "",

    "^@plasmo/(.*)$",
    "^@plasmohq/(.*)$",
    "",

    "^~(.*)$", // e.g., `~/utils/foo`
    "",

    "^[./]" // Relative imports at the end
  ]
}
