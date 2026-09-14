export const CODE_LANGUAGES = [
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "tsx", label: "TSX" },
  { id: "css", label: "CSS" },
  { id: "html", label: "HTML" },
  { id: "json", label: "JSON" },
  { id: "bash", label: "Bash" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "plaintext", label: "纯文本" },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]["id"];

export function codeLanguageLabel(value: unknown): string {
  const id = typeof value === "string" ? value : "";
  return CODE_LANGUAGES.find((item) => item.id === id)?.label ?? (id || "代码");
}
