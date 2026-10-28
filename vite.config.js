import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import net from 'node:net';

// Automatically start the backend API server on port 3000 during `vite` dev if not already running
function autoStartBackendPlugin() {
  let backendProc = null;
  return {
    name: 'auto-start-backend',
    configureServer() {
      const probe = new net.Socket();
      probe.setTimeout(500);
      probe.once('connect', () => {
        probe.destroy();
      });
      probe.once('error', () => {
        probe.destroy();
        if (!backendProc) {
          backendProc = spawn(process.execPath, ['--experimental-sqlite', 'server/server.js'], {
            stdio: 'inherit',
            cwd: process.cwd()
          });
          backendProc.on('exit', () => {
            backendProc = null;
          });
        }
      });
      probe.connect(3000, '127.0.0.1');
    }
  };
}

export default defineConfig({
  plugins: [react(), autoStartBackendPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
