import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { noDiscovery: process.env.NODE_ENV === "test" },
  build: {
    outDir: "dist",
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
});
