import { build } from "esbuild";
await build({
  entryPoints: ["src/portable.jsx"],
  bundle: true,
  minify: true,
  outfile: "generated/viewer.js",
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "text" },
});
