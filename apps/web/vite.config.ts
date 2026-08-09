import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5180,
    strictPort: true,
    allowedHosts: [".loca.lt", ".lhr.life", ".localhost.run", ".trycloudflare.com", ".tunnelmole.net"],
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  }
});
