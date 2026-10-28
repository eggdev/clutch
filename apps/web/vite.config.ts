import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The web app. React Compiler runs through Babel. In development, Vite sends
 * the sync socket to the API on port 4000, so the browser has one origin.
 */
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: { tsconfigPaths: true },
  server: {
    port: 5173,
    proxy: { '/sync': { target: 'ws://localhost:4000', ws: true } },
  },
  build: { manifest: true },
});
