import { defineConfig } from "vite";

// The simulator host page and the sandbox proxy are served from the same build output but on
// two different origins (ports 8080 and 8081), as the MCP Apps double-iframe model requires.
export default defineConfig({
  root: "simulator",
  build: {
    outDir: "../dist/simulator",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: { index: "simulator/index.html", sandbox: "simulator/sandbox.html" },
    },
  },
});
