import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
  host: true,
  // Requests to /api/* go to FastAPI inside the container: the browser only
  // talks to Vite (port 5173), so no CORS setup and no second port to forward.
  proxy: { "/api": "http://localhost:8000" },
},
})