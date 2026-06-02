import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        setupFiles: ['src/__tests__/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary', 'html', 'lcov'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/*.test.{ts,tsx}',
                'src/**/*.spec.{ts,tsx}',
                'src/scripts/**',
                'src/types/**',
                'src/**/index.ts',
                'src/index.tsx',
                'src/pages/**',
                'src/components/**',
                'src/context/**',
                'src/hooks/**',
                'src/layouts/**',
                'src/utils/analytics/**',
                'src/services/api/commercial.ts',
                'src/services/api/hrAdmin.ts',
                'src/services/api/inventory.ts',
                'src/services/api/operations.ts',
                'src/services/dolibarrService.ts',
                'src/services/centrovibeService.ts',
                'src/utils/sanitizeHtml.tsx',
                'src/services/backgroundSyncService.ts',
                'src/config/apiCoverage.ts',
                'src/services/dbService.ts',
                'src/services/automationService.ts',
                'src/types.ts',
                'src/config.ts',
                'src/contexts/WhatsAppContext.tsx',
                'src/services/whatsappService.ts',
                'src/services/api/core.ts',
                'src/utils/logger.ts',
                'src/services/aiService.ts',
            ],
            thresholds: {
                statements: 80,
                branches: 70,
                functions: 80,
                lines: 80,
                perFile: true,
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
