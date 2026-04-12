import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
        setupFiles: ['src/__tests__/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary', 'html', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/*.test.ts',
                'src/scripts/**',
                'src/types/**',
                'src/**/index.ts',
                'src/server.ts',
                'src/routes/**',
                'src/services/legacy/**',
                'src/services/scrapers/**',
            ],
            thresholds: {
                statements: 80,
                branches: 70,
                functions: 80,
                lines: 80,
            },
            perFile: true,
            thresholdMultiFile: 100,
        },
    },
});
