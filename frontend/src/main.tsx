import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Dark is the default theme (see index.css's comment) -- this app is used
// as a native-feeling local dashboard, not a marketing site with visitors
// arriving in light mode by default.
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
