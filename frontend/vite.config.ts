import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const dirname = import.meta.dirname

// ResumeStudio's Python server (server/app.py) serves everything under
// /api/* and expects the frontend build's static output at ../web-dist/
// (kept separate from the old hand-written web/ until the cutover is
// verified working end to end). The dev server proxies /api to the
// already-running Python server on 8765 so `npm run dev` works standalone.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8765",
    },
  },
})
