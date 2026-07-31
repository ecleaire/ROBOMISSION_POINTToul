import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/ROBOMISSION_POINTToul/",
  build: {
    target: "es2020",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        elementary: resolve(__dirname, "elementary/index.html"),
      },
    },
  },
});
