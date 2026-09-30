import type { FileKind } from "@/lib/document/fileKinds";

type Props = {
  type: FileKind;
  size?: number;
};

const COLORS: Record<FileKind, string> = { pdf: "#E5252A", word: "#185ABD", excel: "#107C41", code: "#4B5563", video: "#7C3AED" };

const FONT = "ui-sans-serif,system-ui,sans-serif";

/** 描边写成内联 style：Editor.js 全局有 `.codex-editor path { stroke: currentColor }`，会盖掉 stroke 属性 */
function stroke(color: string, width: number): string {
  return `style="stroke:${color};stroke-width:${width}"`;
}

function badge(type: FileKind): string {
  const color = COLORS[type];
  switch (type) {
    case "pdf":
      return `<rect x="2" y="11" width="15" height="8" rx="1.5" fill="${color}"/><text x="9.5" y="17.2" text-anchor="middle" font-size="6" font-weight="800" fill="#fff" font-family="${FONT}">PDF</text>`;
    case "word":
      return `<rect x="2" y="11" width="11" height="8" rx="1.5" fill="${color}"/><path d="m4 13 1.2 4.5L6.5 14l1.3 3.5L9 13" fill="none" ${stroke("#fff", 1.2)} stroke-linecap="round" stroke-linejoin="round"/>`;
    case "excel":
      return `<rect x="2" y="11" width="11" height="8" rx="1.5" fill="${color}"/><path d="m5 13 3 4m0-4-3 4" fill="none" ${stroke("#fff", 1.3)} stroke-linecap="round"/>`;
    case "code":
      return `<rect x="2" y="11" width="13" height="8" rx="1.5" fill="${color}"/><path d="M6.2 13 4.5 15l1.7 2m4.6-4 1.7 2-1.7 2" fill="none" ${stroke("#fff", 1.2)} stroke-linecap="round" stroke-linejoin="round"/>`;
    case "video":
      return `<rect x="2" y="11" width="13" height="8" rx="1.5" fill="${color}"/><path d="M7.2 13.2v3.6l3.4-1.8z" fill="#fff"/>`;
  }
}

/** 给 Editor.js 等非 React 场景用的同款图标 */
export function fileTypeSvg(type: FileKind, size = 16): string {
  const color = COLORS[type];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M6 2h8.5L20 7.5V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" fill="#fff" ${stroke(color, 1.5)}/><path d="M14.5 2v4.5a1 1 0 0 0 1 1H20" fill="none" ${stroke(color, 1.5)} stroke-linejoin="round"/>${badge(type)}</svg>`;
}

export function FileTypeIcon({ type, size = 16 }: Props) {
  return <span className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: fileTypeSvg(type, size) }} />;
}
