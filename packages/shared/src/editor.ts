export type EditorJsBlock = {
  id?: string;
  type: string;
  data: Record<string, unknown>;
};

export type EditorJsDocument = {
  time?: number;
  version?: string;
  blocks: EditorJsBlock[];
};

export const emptyEditorDocument = (): EditorJsDocument => ({
  time: Date.now(),
  version: "2.30.7",
  blocks: [],
});

/** 新建文章默认：一个空的一级标题块（打开编辑器时焦点在标题，而不是正文段落） */
export const starterArticleDocument = (): EditorJsDocument => ({
  time: Date.now(),
  version: "2.30.7",
  blocks: [
    {
      type: "header",
      data: { text: "", level: 1 },
    },
  ],
});

export function isEditorJsDocument(value: unknown): value is EditorJsDocument {
  return Boolean(value && typeof value === "object" && Array.isArray((value as EditorJsDocument).blocks));
}

export function editorDocumentFromPlainText(text: string): EditorJsDocument {
  const trimmed = text.trim();
  return {
    time: Date.now(),
    version: "2.30.7",
    blocks: trimmed
      ? [
          {
            type: "paragraph",
            data: { text: trimmed },
          },
        ]
      : [],
  };
}

export function normalizeEditorDocument(value: unknown): EditorJsDocument {
  if (isEditorJsDocument(value)) {
    return {
      time: typeof (value as EditorJsDocument).time === "number" ? value.time : Date.now(),
      version: typeof value.version === "string" ? value.version : "2.30.7",
      blocks: value.blocks,
    };
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isEditorJsDocument(parsed)) {
        return normalizeEditorDocument(parsed);
      }
    } catch {
      /* plain text */
    }
    return editorDocumentFromPlainText(value);
  }
  return emptyEditorDocument();
}
