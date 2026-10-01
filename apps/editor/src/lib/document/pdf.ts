import type { EditorJsDocument } from "@myblog/shared";
import regularUrl from "@/assets/fonts/NotoSansSC-Regular.ttf?url";
import boldUrl from "@/assets/fonts/NotoSansSC-Bold.ttf?url";
import { t } from "@/i18n";
import { parseInline, stripTags, type ListItem } from "./inline";

/** 与 Word 导出同一套墨色。字号按半磅换算：正文 12pt，标题 26 / 18 / 15。 */
const INK = "#191919";
const MUTED = "#787774";
const LINE = "#E6E6E6";
const WASH = "#F7F7F5";
const FONT = "NotoSansSC";
/** A4 595.28pt，左右页边距各 65pt */
const CONTENT_WIDTH = 465;

const HEADING = [
  { fontSize: 26, top: 10, bottom: 6 },
  { fontSize: 18, top: 16, bottom: 4 },
  { fontSize: 15, top: 13, bottom: 3 },
] as const;

type PdfSpan = {
  text: string;
  bold?: boolean;
  italics?: boolean;
  fontSize?: number;
  color?: string;
  link?: string;
  decoration?: "underline";
};

type PdfNode = Record<string, unknown>;

type PdfMake = {
  createPdf: (
    definition: unknown,
    tableLayouts: null,
    fonts: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }>,
    vfs: Record<string, string>,
  ) => { getBuffer: (callback: (buffer: Uint8Array) => void) => void };
};

const fonts = {
  NotoSansSC: {
    normal: "NotoSansSC-Regular.ttf",
    bold: "NotoSansSC-Bold.ttf",
    italics: "NotoSansSC-Regular.ttf",
    bolditalics: "NotoSansSC-Bold.ttf",
  },
};

let fontPack: Promise<{ pdfMake: PdfMake; vfs: Record<string, string> }> | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

async function fontFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(t("app.exportFailed"));
  }
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
}

function loadPdfMake(): Promise<{ pdfMake: PdfMake; vfs: Record<string, string> }> {
  if (!fontPack) {
    fontPack = (async () => {
      const [pdfMake, regular, bold] = await Promise.all([
        import("pdfmake/build/pdfmake").then((module) => (module.default ?? module) as PdfMake),
        fontFile(regularUrl),
        fontFile(boldUrl),
      ]);
      return {
        pdfMake,
        vfs: {
          "NotoSansSC-Regular.ttf": regular,
          "NotoSansSC-Bold.ttf": bold,
        },
      };
    })().catch((error: unknown) => {
      fontPack = null;
      throw error;
    });
  }
  return fontPack;
}

function inlineSpans(html: string, look: { bold?: boolean; fontSize?: number } = {}): PdfSpan[] {
  const spans: PdfSpan[] = [];
  for (const part of parseInline(html)) {
    if (part.kind === "break") {
      spans.push({ text: "\n" });
      continue;
    }
    if (part.kind === "link") {
      spans.push({
        text: part.text,
        link: part.href,
        decoration: "underline",
        color: INK,
        bold: Boolean(part.bold || look.bold),
        italics: Boolean(part.italics),
        fontSize: look.fontSize,
      });
      continue;
    }
    spans.push({
      text: part.text,
      bold: Boolean(part.bold || look.bold),
      italics: Boolean(part.italics),
      fontSize: look.fontSize,
    });
  }
  return spans.length ? spans : [{ text: " " }];
}

function checklist(items: ListItem[], depth = 0): PdfNode[] {
  const out: PdfNode[] = [];
  for (const item of items) {
    out.push({
      text: [
        { text: item.meta?.checked ? "☑ " : "☐ ", color: item.meta?.checked ? INK : MUTED },
        ...inlineSpans(String(item.content ?? "")),
      ],
      margin: [14 + depth * 16, 1, 0, 1],
    });
    if (item.items?.length) {
      out.push(...checklist(item.items, depth + 1));
    }
  }
  return out;
}

function bulletList(style: string, items: ListItem[]): PdfNode {
  const key = style === "ordered" ? "ol" : "ul";
  return {
    [key]: items.map((item) => {
      const line = { text: inlineSpans(String(item.content ?? "")) };
      if (!item.items?.length) {
        return line;
      }
      return { stack: [line, bulletList(style, item.items)] };
    }),
    margin: [0, 2, 0, 6],
  };
}

const grid = {
  hLineWidth: () => 0.6,
  vLineWidth: () => 0.6,
  hLineColor: () => LINE,
  vLineColor: () => LINE,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

function tableNode(data: Record<string, unknown>): PdfNode | null {
  const rows = (data.content as string[][] | undefined) ?? [];
  if (!rows.length) {
    return null;
  }
  const head = Boolean(data.withHeadings);
  const width = Math.max(...rows.map((row) => row.length), 1);
  return {
    margin: [0, 8, 0, 8],
    table: {
      headerRows: head ? 1 : 0,
      widths: Array.from({ length: width }, () => "*"),
      body: rows.map((row, rowIndex) => {
        const isHead = head && rowIndex === 0;
        return Array.from({ length: width }, (_, col) => ({
          text: inlineSpans(String(row[col] ?? ""), { bold: isHead }),
          ...(isHead ? { fillColor: WASH } : {}),
        }));
      }),
    },
    layout: grid,
  };
}

function card(text: string, hint?: string): PdfNode {
  return {
    margin: [0, 6, 0, 6],
    table: {
      widths: ["*"],
      body: [
        [
          {
            text: hint ? [{ text: `${hint}  `, color: MUTED, fontSize: 10 }, { text, bold: true }] : text,
            bold: !hint,
            fillColor: WASH,
            margin: [8, 6, 8, 6],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.6,
      vLineWidth: (index: number) => (index === 0 ? 2.5 : 0.6),
      hLineColor: () => LINE,
      vLineColor: (index: number) => (index === 0 ? INK : LINE),
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 2,
      paddingBottom: () => 2,
    },
  };
}

function blocksToContent(doc: EditorJsDocument): PdfNode[] {
  const content: PdfNode[] = [];
  for (const block of doc.blocks ?? []) {
    const data = (block.data ?? {}) as Record<string, unknown>;
    const first = content.length === 0;
    switch (block.type) {
      case "header": {
        const level = Math.min(3, Math.max(1, Number(data.level) || 1));
        const look = HEADING[level - 1];
        content.push({
          text: inlineSpans(String(data.text ?? ""), { bold: true, fontSize: look.fontSize }),
          fontSize: look.fontSize,
          bold: true,
          lineHeight: 1.25,
          margin: [0, first ? 0 : look.top, 0, look.bottom],
        });
        break;
      }
      case "paragraph":
        content.push({ text: inlineSpans(String(data.text ?? "")), margin: [0, 2, 0, 4] });
        break;
      case "list": {
        const style = String(data.style ?? "unordered");
        const items = (data.items as ListItem[] | undefined) ?? [];
        if (style === "checklist") {
          content.push(...checklist(items));
        } else {
          content.push(bulletList(style, items));
        }
        break;
      }
      case "quote": {
        const caption = data.caption ? stripTags(String(data.caption)) : "";
        const stack: PdfNode[] = [{ text: inlineSpans(String(data.text ?? "")) }];
        if (caption) {
          stack.push({ text: caption, italics: true, color: MUTED, fontSize: 9, margin: [0, 4, 0, 0] });
        }
        content.push({
          margin: [0, 8, 0, 8],
          table: {
            widths: [3, "*"],
            body: [
              [
                { text: " ", fontSize: 1, fillColor: INK },
                { stack, margin: [10, 1, 0, 1] },
              ],
            ],
          },
          layout: "noBorders",
        });
        break;
      }
      case "delimiter":
        content.push({
          margin: [0, 12, 0, 12],
          canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.8, lineColor: LINE }],
        });
        break;
      case "table": {
        const table = tableNode(data);
        if (table) {
          content.push(table);
        }
        break;
      }
      case "pageLink": {
        const title = String(data.title ?? "").trim();
        content.push(card(title || t("common.subpage"), title ? t("common.subpage") : undefined));
        break;
      }
      case "attachment":
        if (data.name) {
          content.push(card(String(data.name)));
        }
        break;
      default:
        break;
    }
  }
  return content.length ? content : [{ text: " " }];
}

/** 用内嵌思源黑体生成 PDF，不依赖系统打印。 */
export async function renderPdf(doc: EditorJsDocument): Promise<Uint8Array<ArrayBuffer>> {
  const { pdfMake, vfs } = await loadPdfMake();
  const pdf = pdfMake.createPdf(
    {
      pageSize: "A4",
      pageMargins: [65, 57, 65, 57],
      defaultStyle: { font: FONT, fontSize: 12, color: INK, lineHeight: 1.7 },
      content: blocksToContent(doc),
    },
    null,
    fonts,
    vfs,
  );
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(t("app.exportFailed"))), 20_000);
    try {
      pdf.getBuffer((result) => {
        window.clearTimeout(timer);
        const bytes = new Uint8Array(result.byteLength);
        bytes.set(result);
        resolve(bytes);
      });
    } catch (error) {
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(t("app.exportFailed")));
    }
  });
}
