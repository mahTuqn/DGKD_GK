import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https://images.unsplash.com",
    "connect-src 'self' http://localhost:4000 http://127.0.0.1:4000 ws://localhost:5173 ws://127.0.0.1:5173",
  ].join("; "),
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const frontendPortValue = process.env.E2E_FRONTEND_PORT ?? process.env.VITE_PORT ?? "5173";
const frontendPort = Number(frontendPortValue);

if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65_535) {
  throw new Error("E2E_FRONTEND_PORT or VITE_PORT must be a valid TCP port.");
}

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: frontendPort, strictPort: true },
  preview: { headers: securityHeaders },
});
