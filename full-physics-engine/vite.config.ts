import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    // Rapier's separate, lazy-loaded compat chunk contains the WASM binary.
    chunkSizeWarningLimit: 1800,
  },
});
