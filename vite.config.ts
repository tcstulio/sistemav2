import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function getGitHash(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'dev'; }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.0'),
      __GIT_HASH__: JSON.stringify(getGitHash()),
    },
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
    plugins: [react()],
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
