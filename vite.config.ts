import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const isDevelopment = process.env.NODE_ENV === "development";

// MCP Apps resources are served as one self-contained HTML document, so everything is inlined.
export default defineConfig({
  root: "ui",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    sourcemap: isDevelopment ? "inline" : undefined,
    minify: !isDevelopment,
    cssMinify: !isDevelopment,
    rollupOptions: { input: "ui/board.html" },
  },
});
