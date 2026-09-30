/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "mammoth/mammoth.browser.js" {
  const mammoth: typeof import("mammoth");
  export default mammoth;
}
