import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FormaProvider } from "@kurotch-homelab/forma-react";
import "@kurotch-homelab/forma-react/styles.css";
import "./app.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FormaProvider locale="ja" theme="system" density="comfortable" motion="system" className="app-shell">
      <App />
    </FormaProvider>
  </StrictMode>,
);
