/**
 * 内容层：后台 Notion 编辑器 ↔ 前台博客渲染
 *
 * - editor/NotionEditor：工作区里写块（侧栏树 + / 命令 + 页面链接）
 * - render/BlogContent：公开站只读展示，样式走 blog 的 .block-* / Post.less
 * - 存储：posts.body = EditorJsDocument JSON（单一事实来源）
 */

export { NotionEditor, type NotionEditorProps } from "@/content/editor/NotionEditor";
export {
  saveEditor,
  insertEditorBlocksAt,
  removeEditorBlocksRange,
  markEditorPreviewBlocks,
} from "@/content/editor/persist";
export { BlogContent, type BlogContentProps } from "@/content/render/BlogContent";
