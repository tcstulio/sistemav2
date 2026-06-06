import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3003,
      host: '0.0.0.0',
      allowedHosts: ['.trycloudflare.com', 'localhost'],
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
    // Gemini API key is only used on backend (/api/ai) - never expose in frontend bundle
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
