interface ImportMeta {
  glob(
    pattern: string,
    options?: {
      eager?: boolean
      import?: string
    }
  ): Record<string, () => Promise<{ default: unknown }>>
}
