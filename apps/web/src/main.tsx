import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/m-plus-rounded-1c/400.css";
import "@fontsource/m-plus-rounded-1c/700.css";
import "animal-island-ui/style";
import App from "./App";
import "./index.css";
import "./index.less";

// 加粗字重按需补（不挡首屏）
void import("@fontsource/m-plus-rounded-1c/800.css");
void import("@fontsource/m-plus-rounded-1c/900.css");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
