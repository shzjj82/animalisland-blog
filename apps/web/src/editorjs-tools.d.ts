declare module "@editorjs/header";
declare module "@editorjs/list";
declare module "@editorjs/image";
declare module "@editorjs/code";
declare module "@editorjs/quote";
declare module "@editorjs/delimiter";
declare module "@editorjs/embed";
declare module "editorjs-drag-drop" {
  import type EditorJS from "@editorjs/editorjs";
  export default class DragDrop {
    constructor(editor: EditorJS, borderStyle?: string);
  }
}
