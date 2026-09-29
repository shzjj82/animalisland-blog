export type FileKind = "word" | "pdf" | "excel" | "code";

/** 扩展名 → highlight.js 语言名 */
const CODE_LANGUAGES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  json: "json",
  py: "python",
  java: "java",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  html: "xml",
  htm: "xml",
  vue: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  toml: "ini",
  ini: "ini",
  conf: "ini",
};

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  doc: "word",
  docx: "word",
  pdf: "pdf",
  xls: "excel",
  xlsx: "excel",
  csv: "excel",
  ...Object.fromEntries(Object.keys(CODE_LANGUAGES).map((ext) => [ext, "code" as const])),
};

export const ATTACHMENT_ACCEPT = Object.keys(KIND_BY_EXTENSION)
  .map((ext) => `.${ext}`)
  .join(",");

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export function fileExtension(name: string): string {
  return name.toLowerCase().match(/\.([^./]+)$/)?.[1] ?? "";
}

export function fileKind(name: string): FileKind | null {
  return KIND_BY_EXTENSION[fileExtension(name)] ?? null;
}

export function codeLanguage(name: string): string | undefined {
  return CODE_LANGUAGES[fileExtension(name)];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
