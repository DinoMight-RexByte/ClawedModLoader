import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { recordRendererError } from "./lib/errorDiagnostics";
import "./styles/global.css";

window.addEventListener("error", (event) => {
  recordRendererError("windowError", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  recordRendererError("unhandledRejection", event.reason);
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("CMM root element is missing.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
