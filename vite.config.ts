import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3003,
      host: '0.0.0.0',
      allowedHosts: true,
      // PROTÓTIPO: HMR desligado — o app é servido via túnel (host diferente),
      // e o HMR apontando pro domínio de produção quebrava no navegador.
      hmr: false,
      watch: {
        ignored: ['**/.wwebjs_auth/**', '**/.wwebjs_cache/**', '**/backend/**']
      },
      proxy: {
        '/api/ui-config': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/dashboard': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/dolibarr': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/whatsapp': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/auth': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/admin': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/ai': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/scheduler': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/webhook': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/inter': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/itau': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/banking': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/email': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/documents': {
          target: 'http://localhost:3004',
          changeOrigin: true,
          secure: false,
        },
        '/api/approvals': {
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
        /* 
        '/api': {
          target: 'https://sistema.coolgroove.com.br',
          changeOrigin: true,
          secure: false,
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              proxyReq.setHeader('Origin', 'https://sistema.coolgroove.com.br');
              proxyReq.setHeader('Referer', 'https://sistema.coolgroove.com.br/');
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
              proxyReq.setHeader('Accept-Language', 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7');

              // Bypass WAF challenge
              let cookies = req.headers.cookie || '';
              if (!cookies.includes('humans_21909=1')) {
                cookies = cookies ? `${cookies}; humans_21909=1` : 'humans_21909=1';
              }
              proxyReq.setHeader('Cookie', cookies);

              // Remove headers that reveal it's a proxy
              proxyReq.removeHeader('x-forwarded-for');
              proxyReq.removeHeader('x-forwarded-host');
              proxyReq.removeHeader('x-forwarded-proto');
            });
          },
        },
        */
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
