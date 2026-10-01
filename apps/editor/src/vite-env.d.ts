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

declare module "pdfmake/build/pdfmake" {
  const pdfMake: {
    createPdf: (...args: unknown[]) => { getBuffer: (callback: (buffer: Uint8Array) => void) => void };
  };
  export default pdfMake;
}
