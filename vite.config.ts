import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

function getGitHash(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'dev'; }
}

function versionPlugin(): PluginOption {
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
  const sentryDsn = env.VITE_SENTRY_DSN || '';
  const sentryOrg = env.SENTRY_ORG || process.env.SENTRY_ORG || '';
  const sentryProject = env.SENTRY_PROJECT || process.env.SENTRY_PROJECT || '';
  const sentryAuthToken = env.SENTRY_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN || '';
  const isProdBuild = mode === 'production';

  const plugins: PluginOption[] = [react(), versionPlugin()];

  // Sentry source-map upload em build de produção.
  // Só ativamos quando VITE_SENTRY_DSN estiver definido (DSN válido = projeto
  // configurado para monitorar este app). Sem DSN, o upload é pulado — o build
  // continua gerando source maps locais (hidden) mas nada é enviado.
  if (isProdBuild && sentryDsn) {
    plugins.push(
      sentryVitePlugin({
        org: sentryOrg || undefined,
        project: sentryProject || undefined,
        authToken: sentryAuthToken || undefined,
        release: {
          name: env.VITE_APP_VERSION || process.env.npm_package_version || '1.0.0',
        },
        sourcemaps: {
          // Faz upload apenas dos arquivos gerados pelo build (não inclui node_modules).
          assets: ['./dist/**/*'],
        },
        // Se o upload falhar (CLI ausente, sem rede, etc), avisa mas não derruba o build.
        errorHandler: (err) => {
          // eslint-disable-next-line no-console
          console.warn('[sentry-vite-plugin] source-map upload failed:', err?.message || err);
        },
      }),
    );
  }

  return {
    server: {
      port: 3003,
      host: '0.0.0.0',
      allowedHosts: true, // Permitir acessos pela rede local (celular, etc)
      hmr: false,
      watch: {
        ignored: ['**/.wwebjs_auth/**', '**/.wwebjs_cache/**', '**/backend/**']
      },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3004', // Evita problema de IPv6 (::1) no Node 17+ vs 0.0.0.0 do backend
          changeOrigin: true,
          secure: false,
        },
        '/socket.io': {
          target: 'http://127.0.0.1:3004',
          changeOrigin: true,
          secure: false,
          ws: true
        },
      },
    },
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    },
    build: {
      // 'hidden' gera .map files no dist sem referenciá-los nos JS finais
      // (evita expor o source map no browser, mas mantém o arquivo para upload).
      sourcemap: isProdBuild ? 'hidden' : true,
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
