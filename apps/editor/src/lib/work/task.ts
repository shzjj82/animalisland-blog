/**
 * 工作台只通过技能操作这台电脑和页面。
 * 有多种做法、或页面要人接着做时，先问用户，等回复后再继续。不在这里预制站点。
 */
export const WORK_SYSTEM = `你是 wiki-agent 的工作台，跑在用户这台电脑上。用户给你一个或多个任务时，先拆成步骤，再一步一步做。一次只推进当前步骤。
你不能读取网页里的内容。要判断画面是否符合预期，用 look 截一张图，对照你写的预期。不是每个动作都截图，只在这一步对错必须看画面时才截一次。
技能放在 skill 代码块里：
{"name":"ask","question":"要问用户的那句话"}
{"name":"open","target":"网址或本机路径"}
{"name":"look","expect":"这张图里应该看到什么"}
{"name":"read_file","path":"绝对路径"}
{"name":"shell","command":"一条命令"}
规则：
- 开头用一两句列出步骤，然后执行第一步。后面只做还没完成的下一步。
- 同一件事既能用本机应用做，也能用网页做，而用户没指定时，只输出 ask。得到答复前不要打开，也不要自己挑一个。
- 打开、输入、滚动这种动作做完，不要立刻截图。等到需要确认结果（页面是不是目标页、有没有登录、结果在不在）时，再输出一个 look，expect 写这一步应该看到的画面。
- 给你截图后：符合预期就做下一步；画面是登录或要人操作，就只输出 ask，等用户确认后再继续；不符合就说明差在哪，不要把没看到的内容写成已经完成。
- 同一次核对不要连截两次。同一技能、同一参数只调用一次。
- 全部步骤做完就停。用户要保存的文档放进 deliver 代码块，内容是完整 Markdown。`;

export function extractDeliverable(reply: string): { text: string; markdown: string } {
  const match = reply.match(/```deliver\s*([\s\S]*?)```/i);
  if (!match) {
    return { text: reply.trim(), markdown: "" };
  }
  return {
    markdown: match[1].trim(),
    text: reply.replace(match[0], "").trim(),
  };
}

/** 取出纯询问技能。这种代码块不再交给打开/命令执行。 */
export function takeQuestions(reply: string): { reply: string; questions: string[] } {
  const questions: string[] = [];
  const next = reply.replace(/```skill\s*([\s\S]*?)```/gi, (all, body: string) => {
    const found = questionsIn(String(body));
    if (!found) {
      return all;
    }
    questions.push(...found);
    return "";
  });
  return { reply: next, questions };
}

/** 取出「看画面」技能。一次回复里多张预期也只截一张。 */
export function takeLooks(reply: string): { reply: string; expects: string[] } {
  const expects: string[] = [];
  const next = reply.replace(/```skill\s*([\s\S]*?)```/gi, (all, body: string) => {
    const found = expectsIn(String(body));
    if (!found) {
      return all;
    }
    expects.push(...found);
    return "";
  });
  return { reply: next, expects };
}

function expectsIn(body: string): string[] | null {
  try {
    const parsed = JSON.parse(body.trim()) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (!list.length) {
      return null;
    }
    const expects: string[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as { name?: unknown; expect?: unknown };
      if (String(row.name ?? "") !== "look" || typeof row.expect !== "string" || !row.expect.trim()) {
        return null;
      }
      expects.push(row.expect.trim());
    }
    return expects;
  } catch {
    return null;
  }
}

function questionsIn(body: string): string[] | null {
  try {
    const parsed = JSON.parse(body.trim()) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (!list.length) {
      return null;
    }
    const questions: string[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as { name?: unknown; question?: unknown };
      if (String(row.name ?? "") !== "ask" || typeof row.question !== "string" || !row.question.trim()) {
        return null;
      }
      questions.push(row.question.trim());
    }
    return questions;
  } catch {
    return null;
  }
}
