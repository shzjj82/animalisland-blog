/**
 * 站点关于页门面：按 CONTENT_BACKEND 选择本地 SQLite 或远程 docs API。
 */
import type { SiteAbout } from "@myblog/shared";
import { loadSite } from "./content-backend.js";

export async function getAbout(): Promise<SiteAbout> {
  return (await loadSite()).getAbout();
}

export async function saveAbout(input: SiteAbout): Promise<SiteAbout> {
  return (await loadSite()).saveAbout(input);
}

export async function syncSiteFromAboutPage(page: {
  title: string;
  body: unknown;
  props: Record<string, unknown>;
}): Promise<void> {
  (await loadSite()).syncSiteFromAboutPage(page);
}
