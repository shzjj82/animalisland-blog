import { appLocale } from "@/i18n";

/** 斜杠菜单与块工具文案。英文是原文，中文环境才套这套译文。 */
export function editorI18n() {
  if (appLocale() !== "zh") {
    return undefined;
  }
  return {
    messages: {
      ui: {
        blockTunes: {
          toggler: {
            "Click to tune": "点击调整",
            "or drag to move": "或拖拽移动",
          },
        },
        inlineToolbar: {
          converter: {
            "Convert to": "转换为",
          },
        },
        toolbar: {
          toolbox: {
            Add: "添加",
          },
        },
        popover: {
          Filter: "筛选…",
          "Nothing found": "没有找到",
          "Convert to": "转换为",
        },
      },
      toolNames: {
        Text: "正文",
        Heading: "标题",
        "Heading 1": "一级标题 · H1",
        "Heading 2": "二级标题 · H2",
        "Heading 3": "三级标题 · H3",
        List: "列表",
        "Unordered List": "无序列表 · ul",
        "Ordered List": "有序列表 · ol",
        Checklist: "待办 · todo",
        Quote: "引用",
        Table: "表格",
        Delimiter: "分隔线",
        Link: "链接",
        Bold: "粗体",
        AI: "AI",
        Italic: "斜体",
        "AI Chat · ai": "智能 AI 聊天 · ai",
        "Subpage · page": "子页面 · page",
        "File · file": "文件 · file",
      },
      tools: {
        header: {
          "Heading 1": "一级标题 · H1",
          "Heading 2": "二级标题 · H2",
          "Heading 3": "三级标题 · H3",
        },
        list: {
          Ordered: "有序列表",
          Unordered: "无序列表",
          Checklist: "待办",
          "Unordered List": "无序列表 · ul",
          "Ordered List": "有序列表 · ol",
        },
        link: {
          "Add a link": "添加链接",
        },
        stub: {
          "The block can not be displayed correctly.": "该内容块无法正确显示。",
        },
        table: {
          "Add column to left": "在左侧添加列",
          "Add column to right": "在右侧添加列",
          "Delete column": "删除列",
          "Add row above": "在上方添加行",
          "Add row below": "在下方添加行",
          "Delete row": "删除行",
          Heading: "表头",
          "With headings": "带表头",
          "Without headings": "不带表头",
          Collapse: "取消撑满",
          Stretch: "撑满宽度",
        },
      },
      blockTunes: {
        delete: {
          Delete: "删除",
          "Click to delete": "点击删除",
        },
        moveUp: {
          "Move up": "上移",
        },
        moveDown: {
          "Move down": "下移",
        },
      },
    },
  };
}
