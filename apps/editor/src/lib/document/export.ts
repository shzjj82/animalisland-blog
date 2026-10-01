import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlignTable,
  WidthType,
  type FileChild,
  type IBorderOptions,
} from "docx";
import type { EditorJsDocument } from "@myblog/shared";
import { t } from "@/i18n";
import { parseInline, stripTags, type ListItem } from "./inline";
import { renderPdf } from "./pdf";

export type ExportFormat = "pdf" | "word";

/** 与编辑器同一套黑灰：正文 #191919，次要文字 #787774，底 #F7F7F5，线 #E6E6E6 */
const INK = "191919";
const MUTED = "787774";
const LINE = "E6E6E6";
const WASH = "F7F7F5";
const BODY = 24;
const FONT = {
  ascii: "PingFang SC",
  hAnsi: "PingFang SC",
  eastAsia: "PingFang SC",
  cs: "PingFang SC",
  hint: "eastAsia",
} as const;

const BODY_SPACING = { before: 40, after: 80, line: 408, lineRule: LineRuleType.AUTO };
const HAIRLINE: IBorderOptions = { style: BorderStyle.SINGLE, size: 8, color: LINE };

const HEADING = [
  { size: 52, before: 200, after: 120, line: 288 },
  { size: 36, before: 320, after: 80, line: 312 },
  { size: 30, before: 260, after: 60, line: 312 },
] as const;

type RunLook = { size?: number; bold?: boolean; italics?: boolean; color?: string };

function textRun(text: string, look: RunLook = {}, marks?: { bold?: boolean; italics?: boolean }): TextRun {
  return new TextRun({
    text,
    font: FONT,
    size: look.size ?? BODY,
    color: look.color ?? INK,
    bold: Boolean(marks?.bold || look.bold),
    italics: Boolean(marks?.italics || look.italics),
  });
}

function inlineRuns(html: string, look: RunLook = {}): Array<TextRun | ExternalHyperlink> {
  const runs: Array<TextRun | ExternalHyperlink> = [];
  for (const part of parseInline(html)) {
    if (part.kind === "break") {
      runs.push(new TextRun({ break: 1, font: FONT, size: look.size ?? BODY }));
      continue;
    }
    if (part.kind === "link") {
      runs.push(
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: part.text,
              font: FONT,
              size: look.size ?? BODY,
              color: INK,
              bold: Boolean(part.bold || look.bold),
              italics: Boolean(part.italics || look.italics),
              underline: { type: UnderlineType.SINGLE, color: INK },
              style: "Hyperlink",
            }),
          ],
          link: part.href,
        }),
      );
      continue;
    }
    runs.push(textRun(part.text, look, { bold: part.bold, italics: part.italics }));
  }
  return runs.length ? runs : [textRun("")];
}

function heading(level: number) {
  if (level <= 1) {
    return HeadingLevel.HEADING_1;
  }
  if (level === 2) {
    return HeadingLevel.HEADING_2;
  }
  return HeadingLevel.HEADING_3;
}

function listParagraphs(style: string, items: ListItem[], instance: number, depth = 0): Paragraph[] {
  const out: Paragraph[] = [];
  const level = Math.min(depth, 2);
  items.forEach((item) => {
    if (style === "checklist") {
      out.push(
        new Paragraph({
          spacing: { before: 20, after: 20, line: 360, lineRule: LineRuleType.AUTO },
          indent: { left: 420 * (depth + 1), hanging: 280 },
          children: [
            textRun(item.meta?.checked ? "☑ " : "☐ ", { color: item.meta?.checked ? INK : MUTED }),
            ...inlineRuns(String(item.content ?? "")),
          ],
        }),
      );
    } else {
      out.push(
        new Paragraph({
          spacing: { before: 20, after: 20, line: 360, lineRule: LineRuleType.AUTO },
          numbering: {
            reference: style === "ordered" ? "editor-ordered" : "editor-bullet",
            level,
            instance,
          },
          children: inlineRuns(String(item.content ?? "")),
        }),
      );
    }
    if (item.items?.length) {
      out.push(...listParagraphs(style, item.items, instance, depth + 1));
    }
  });
  return out;
}

const cellBorders = { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE };

function tableFromBlock(data: Record<string, unknown>): Table | null {
  const rows = (data.content as string[][] | undefined) ?? [];
  if (!rows.length) {
    return null;
  }
  const head = Boolean(data.withHeadings);
  const width = Math.max(...rows.map((row) => row.length), 1);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { ...cellBorders, insideHorizontal: HAIRLINE, insideVertical: HAIRLINE },
    rows: rows.map((row, rowIndex) => {
      const isHead = head && rowIndex === 0;
      return new TableRow({
        children: Array.from({ length: width }, (_, col) => {
          const html = String(row[col] ?? "");
          return new TableCell({
            borders: cellBorders,
            shading: isHead ? { type: ShadingType.CLEAR, fill: WASH } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            verticalAlign: VerticalAlignTable.CENTER,
            width: { size: Math.floor(100 / width), type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                spacing: { before: 20, after: 20, line: 360, lineRule: LineRuleType.AUTO },
                children: inlineRuns(html, { bold: isHead }),
              }),
            ],
          });
        }),
      });
    }),
  });
}

const quoteBar = { left: { style: BorderStyle.SINGLE, size: 18, color: INK, space: 10 } as IBorderOptions };

function cardLine(text: string, hint?: string): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: WASH },
    border: {
      top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 2 },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 2 },
      left: { style: BorderStyle.SINGLE, size: 16, color: LINE, space: 8 },
      right: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 },
    },
    spacing: { before: 100, after: 100, line: 360, lineRule: LineRuleType.AUTO },
    children: hint ? [textRun(`${hint}  `, { size: 20, color: MUTED }), textRun(text, { bold: true })] : [textRun(text, { bold: true })],
  });
}

function blocksToChildren(doc: EditorJsDocument): FileChild[] {
  const children: FileChild[] = [];
  let listInstance = 0;
  for (const block of doc.blocks ?? []) {
    const data = (block.data ?? {}) as Record<string, unknown>;
    const first = children.length === 0;
    switch (block.type) {
      case "header": {
        const level = Math.min(3, Math.max(1, Number(data.level) || 1));
        const look = HEADING[level - 1];
        children.push(
          new Paragraph({
            heading: heading(level),
            spacing: {
              before: first ? 0 : look.before,
              after: look.after,
              line: look.line,
              lineRule: LineRuleType.AUTO,
            },
            children: inlineRuns(String(data.text ?? ""), { size: look.size, bold: true }),
          }),
        );
        break;
      }
      case "paragraph":
        children.push(new Paragraph({ spacing: BODY_SPACING, children: inlineRuns(String(data.text ?? "")) }));
        break;
      case "list":
        children.push(
          ...listParagraphs(String(data.style ?? "unordered"), (data.items as ListItem[] | undefined) ?? [], listInstance),
        );
        listInstance += 1;
        break;
      case "quote": {
        children.push(
          new Paragraph({
            spacing: { before: 120, after: data.caption ? 20 : 120, line: 408, lineRule: LineRuleType.AUTO },
            border: quoteBar,
            children: inlineRuns(String(data.text ?? "")),
          }),
        );
        if (data.caption) {
          children.push(
            new Paragraph({
              spacing: { before: 0, after: 120 },
              border: quoteBar,
              children: [textRun(stripTags(String(data.caption)), { italics: true, color: MUTED, size: 18 })],
            }),
          );
        }
        break;
      }
      case "delimiter":
        children.push(
          new Paragraph({
            spacing: { before: 180, after: 180 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: LINE, space: 1 } },
            children: [textRun("")],
          }),
        );
        break;
      case "table": {
        const table = tableFromBlock(data);
        if (table) {
          children.push(table);
        }
        break;
      }
      case "pageLink": {
        const title = String(data.title ?? "").trim();
        children.push(title ? cardLine(title, t("common.subpage")) : cardLine(t("common.subpage")));
        break;
      }
      case "attachment":
        if (data.name) {
          children.push(cardLine(String(data.name)));
        }
        break;
      default:
        break;
    }
  }
  return children.length ? children : [new Paragraph({ spacing: BODY_SPACING, children: [textRun("")] })];
}

function fileName(title: string, ext: string): string {
  const safe = title.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 80) || t("document.untitled");
  return `${safe}.${ext}`;
}

type TauriInternals = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

function desktopInternals(): TauriInternals | null {
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return internals?.invoke ? internals : null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

/** 桌面端先选保存位置。取消返回 true（不再另存一份）；系统没有保存框时返回 false，改走浏览器下载。 */
async function saveDesktopFile(name: string, extension: string, bytes: Uint8Array): Promise<boolean> {
  const internals = desktopInternals();
  if (!internals) {
    return false;
  }
  let path: string | null;
  try {
    path = await internals.invoke<string | null>("pick_save_path", { suggestedName: name, extension });
  } catch {
    return false;
  }
  if (!path) {
    return true;
  }
  await internals.invoke("write_export_file", { path, data: bytesToBase64(bytes) });
  return true;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function numberingLevel(kind: "bullet" | "ordered", level: number) {
  return {
    level,
    format: kind === "bullet" ? LevelFormat.BULLET : LevelFormat.DECIMAL,
    text: kind === "bullet" ? "•" : `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: { indent: { left: 480 + level * 360, hanging: kind === "bullet" ? 240 : 300 } },
      run: { font: FONT, size: BODY, color: INK },
    },
  };
}

/** 导出 OOXML `.docx`。标题和链接都写成编辑器的墨色，避免 Word 主题蓝。 */
async function exportWord(title: string, doc: EditorJsDocument): Promise<void> {
  const document = new Document({
    creator: "Animal Island Editor",
    title,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY, color: INK },
          paragraph: { spacing: BODY_SPACING },
        },
        heading1: {
          run: { font: FONT, size: HEADING[0].size, bold: true, color: INK },
          paragraph: { spacing: { before: HEADING[0].before, after: HEADING[0].after, line: HEADING[0].line, lineRule: LineRuleType.AUTO } },
        },
        heading2: {
          run: { font: FONT, size: HEADING[1].size, bold: true, color: INK },
          paragraph: { spacing: { before: HEADING[1].before, after: HEADING[1].after, line: HEADING[1].line, lineRule: LineRuleType.AUTO } },
        },
        heading3: {
          run: { font: FONT, size: HEADING[2].size, bold: true, color: INK },
          paragraph: { spacing: { before: HEADING[2].before, after: HEADING[2].after, line: HEADING[2].line, lineRule: LineRuleType.AUTO } },
        },
        hyperlink: {
          run: { font: FONT, color: INK, underline: { type: UnderlineType.SINGLE, color: INK } },
        },
        listParagraph: {
          run: { font: FONT, size: BODY, color: INK },
          paragraph: { spacing: { before: 20, after: 20, line: 360, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    numbering: {
      config: [
        { reference: "editor-bullet", levels: [0, 1, 2].map((level) => numberingLevel("bullet", level)) },
        { reference: "editor-ordered", levels: [0, 1, 2].map((level) => numberingLevel("ordered", level)) },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1300, bottom: 1134, left: 1300 },
          },
        },
        children: blocksToChildren(doc),
      },
    ],
  });
  const blob = await Packer.toBlob(document);
  const name = fileName(title, "docx");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (await saveDesktopFile(name, "docx", bytes)) {
    return;
  }
  download(new Blob([bytes], { type: blob.type }), name);
}

async function exportPdf(title: string, doc: EditorJsDocument): Promise<void> {
  const bytes = await renderPdf(doc);
  const name = fileName(title, "pdf");
  if (await saveDesktopFile(name, "pdf", bytes)) {
    return;
  }
  download(new Blob([bytes], { type: "application/pdf" }), name);
}

export async function exportDocument(format: ExportFormat, title: string, doc: EditorJsDocument): Promise<void> {
  if (format === "word") {
    await exportWord(title, doc);
  } else {
    await exportPdf(title, doc);
  }
}
