import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeExternal = [
  "electron",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
];

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: "src/main/index.ts",
      formats: ["cjs"],
      fileName: () => "index.cjs"
    },
    minify: false,
    outDir: "dist/main",
    rollupOptions: {
      external: nodeExternal
    },
    sourcemap: true,
    target: "node20"
  }
});
