import { highlightCode } from "@/lib/highlight";

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

type CodeData = {
  code: string;
  language: string;
};

export class CodeTool {
  static get toolbox() {
    return {
      title: "Code",
      icon: '<svg width="17" height="15" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M8.3 6.3 2.6 12l5.7 5.7 1.4-1.4L5.4 12l4.3-4.3-1.4-1.4zm7.4 0-1.4 1.4L18.6 12l-4.3 4.3 1.4 1.4 5.7-5.7-5.7-5.7z"/></svg>',
    };
  }

  static get enableLineBreaks() {
    return true;
  }

  static get isReadOnlySupported() {
    return true;
  }

  private data: CodeData;
  private wrap: HTMLDivElement | null = null;
  private area: HTMLTextAreaElement | null = null;
  private select: HTMLSelectElement | null = null;
  private highlight: HTMLElement | null = null;

  constructor({ data }: { data?: Partial<CodeData> }) {
    this.data = {
      code: typeof data?.code === "string" ? data.code : "",
      language: CODE_LANGUAGES.some((item) => item.id === data?.language)
        ? String(data?.language)
        : "typescript",
    };
  }

  render() {
    this.wrap = document.createElement("div");
    this.wrap.className = "code-tool";

    this.select = document.createElement("select");
    this.select.className = "code-tool-lang";
    this.select.setAttribute("aria-label", "代码语言");
    for (const item of CODE_LANGUAGES) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      if (item.id === this.data.language) {
        option.selected = true;
      }
      this.select.append(option);
    }
    this.select.addEventListener("change", () => {
      this.data.language = this.select?.value ?? "typescript";
      this.paint();
    });

    const body = document.createElement("div");
    body.className = "code-tool-body";

    const pre = document.createElement("pre");
    pre.className = "code-tool-hl";
    pre.setAttribute("aria-hidden", "true");
    this.highlight = document.createElement("code");
    this.highlight.className = "hljs";
    pre.append(this.highlight);

    this.area = document.createElement("textarea");
    this.area.className = "code-tool-area";
    this.area.placeholder = "写一段代码…";
    this.area.value = this.data.code;
    this.area.spellcheck = false;
    this.area.addEventListener("input", () => {
      this.paint();
      this.resize();
    });
    this.area.addEventListener("scroll", () => {
      pre.scrollTop = this.area?.scrollTop ?? 0;
      pre.scrollLeft = this.area?.scrollLeft ?? 0;
    });

    body.append(pre, this.area);
    this.wrap.append(this.select, body);
    this.paint();
    requestAnimationFrame(() => this.resize());
    return this.wrap;
  }

  save(): CodeData {
    return {
      code: this.area?.value ?? "",
      language: this.select?.value ?? this.data.language,
    };
  }

  private paint() {
    if (!this.highlight || !this.area) {
      return;
    }
    const code = this.area.value.endsWith("\n") ? `${this.area.value} ` : this.area.value;
    this.highlight.innerHTML = highlightCode(code || " ", this.select?.value ?? this.data.language);
  }

  private resize() {
    if (!this.area) {
      return;
    }
    this.area.style.height = "auto";
    this.area.style.height = `${Math.max(180, this.area.scrollHeight)}px`;
  }
}
