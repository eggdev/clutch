import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The API in development. `tools/dev.ts` sets `DEV_API_URL` to the API's
 * portless URL. The proxy connects to 127.0.0.1 and sends the API's host
 * name, so portless routes it without a DNS lookup.
 */
const api = new URL(process.env.DEV_API_URL ?? 'http://localhost:4000');

/**
 * The web app. React Compiler runs through Babel. In development, Vite sends
 * the sync socket to the API, so the browser has one origin. Start it with
 * `mise exec -- bun run dev`, which gives it a portless URL and port.
 */
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: { tsconfigPaths: true },
  server: {
    proxy: {
      '/sync': {
        target: `ws://127.0.0.1:${api.port || '80'}`,
        ws: true,
        headers: { host: api.host },
      },
    },
  },
  build: { manifest: true },
});
