import type { SiteAbout } from "@myblog/shared";
import { docsRequest } from "./docs-client.js";

export async function getAbout(): Promise<SiteAbout> {
  const data = await docsRequest<{ about: SiteAbout }>("GET", "/docs/site");
  return data.about;
}

export async function saveAbout(input: SiteAbout): Promise<SiteAbout> {
  const data = await docsRequest<{ about: SiteAbout }>("PUT", "/docs/site", { body: input });
  return data.about;
}

/** about 页权威源在 Nest；工作区保存后网关会自己镜像，这里不必再写 */
export function syncSiteFromAboutPage(_page: {
  title: string;
  body: unknown;
  props: Record<string, unknown>;
}): void {}
