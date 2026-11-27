import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `host` and `allowedHosts` are for the sandbox preview proxy, which reaches the dev server
  // under a hostname other than localhost.
  server: { port: 5173, host: "0.0.0.0", allowedHosts: true },
  preview: { port: 4173, host: "0.0.0.0", allowedHosts: true },
});
