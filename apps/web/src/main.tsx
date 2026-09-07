import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/m-plus-rounded-1c/400.css";
import "@fontsource/m-plus-rounded-1c/700.css";
import "@fontsource/m-plus-rounded-1c/800.css";
import "@fontsource/m-plus-rounded-1c/900.css";
import "animal-island-ui/style";
import "highlight.js/styles/atom-one-dark.css";
import App from "./App";
import "./index.css";
import "./index.less";


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
