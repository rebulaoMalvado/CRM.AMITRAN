import { defineConfig } from "vitest/config";

// Testes do backend (pasta /server): rodam em Node puro, sem navegador simulado.
export default defineConfig({
  // O backend não usa CSS: evita carregar o postcss/tailwind do site.
  css: { postcss: {} },
  test: {
    environment: "node",
    globals: true,
    include: ["server/**/*.{test,spec}.ts"],
  },
});
