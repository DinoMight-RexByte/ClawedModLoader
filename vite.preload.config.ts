import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: "src/preload/index.ts",
      formats: ["cjs"],
      fileName: () => "index.cjs"
    },
    minify: false,
    outDir: "dist/preload",
    rollupOptions: {
      external: ["electron"]
    },
    sourcemap: true,
    target: "chrome120"
  }
});
