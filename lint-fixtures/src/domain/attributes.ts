// Clean control: the canonical module of the attribute vocabularies may
// spell their names.
export const TreeEntryTypes = { Blob: "blob-entry", Tree: "tree-entry", Commit: "commit-entry" } as const
export const FileKinds = {
  File: "regular-file",
  Directory: "directory-kind",
  SymbolicLink: "symbolic-link",
  Other: "other-kind",
} as const
export const AttributeSources = {
  Tree: "revision-gitattributes",
  InfoAttributes: "info-attributes",
  AttributesFile: "core-attributes-file",
  ConditionalInclude: "conditional-include",
} as const
export const AttributeRefusalReasons = {
  Content: "has-content",
  NotRegular: "not-regular",
  Configured: "is-configured",
  ReadFailed: "read-failed",
} as const
