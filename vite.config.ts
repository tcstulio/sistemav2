import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function getGitHash(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'dev'; }
}

function versionPlugin(): Plugin {
  const version = process.env.npm_package_version || '0.0.0';
  const hash = getGitHash();
  const virtualModuleId = 'virtual:app-version';
  const resolvedVirtualModuleId = '\0' + virtualModuleId;

  return {
    name: 'app-version',
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `export const APP_VERSION = ${JSON.stringify(version)}; export const GIT_HASH = ${JSON.stringify(hash)};`;
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3003,
      host: '0.0.0.0',
      allowedHosts: ['.trycloudflare.com', '.coolgroove.com.br', 'localhost'],
      hmr: false,
      watch: {
        ignored: ['**/.wwebjs_auth/**', '**/.wwebjs_cache/**', '**/backend/**']
      },
      proxy: {
        '/api': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/socket.io': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
          ws: true
        },
      },
    },
    plugins: [react(), versionPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-query': ['@tanstack/react-query'],
            'vendor-recharts': ['recharts'],
            'vendor-ui': ['lucide-react', 'sonner'],
            'vendor-data': ['date-fns', 'react-markdown'],
            'vendor-realtime': ['socket.io-client'],
            'vendor-virtualization': ['react-window', 'react-virtualized-auto-sizer'],
          }
        }
      }
    }
  };
});
