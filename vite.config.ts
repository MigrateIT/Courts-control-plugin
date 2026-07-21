import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const certificatePath = process.env.COURT_PLUGIN_HTTPS_CERT;
const keyPath = process.env.COURT_PLUGIN_HTTPS_KEY;

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    https:
      certificatePath && keyPath
        ? {
            cert: readFileSync(certificatePath),
            key: readFileSync(keyPath),
          }
        : undefined,
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: resolve(
        fileURLToPath(new URL(".", import.meta.url)),
        "index.html",
      ),
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
