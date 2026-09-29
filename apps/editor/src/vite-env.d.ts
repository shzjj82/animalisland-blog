/// <reference types="vite/client" />

declare module "mammoth/mammoth.browser.js" {
  const mammoth: typeof import("mammoth");
  export default mammoth;
}
