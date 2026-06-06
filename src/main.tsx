import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Desactiva el menú contextual nativo del webview (clic derecho), salvo en
// campos editables, para conservar copiar/pegar en inputs y textareas.
document.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  const editable =
    t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
  if (!editable) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
