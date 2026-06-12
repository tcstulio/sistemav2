import { chromium, type Browser, type Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';

const log = createLogger('Screenshot');

const SCREENSHOTS_DIR = path.join(__dirname, '../../data/screenshots');

export interface ScreenshotResult {
    beforePath: string;
    afterPath: string;
}

async function ensureDir(): Promise<void> {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
}

async function capturePage(url: string, outputPath: string, options?: { darkMode?: boolean; width?: number; height?: number }): Promise<void> {
    let browser: Browser | undefined;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            viewport: { width: options?.width || 1440, height: options?.height || 900 },
            colorScheme: options?.darkMode ? 'dark' : 'light',
        });
        const page: Page = await context.newPage();

        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);

        await page.screenshot({
            path: outputPath,
            fullPage: false,
            type: 'png',
        });

        log.info(`Screenshot saved: ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(0)}KB)`);
    } catch (e: any) {
        log.error(`Failed to capture ${url}: ${e.message}`);
        throw e;
    } finally {
        await browser?.close();
    }
}

export const screenshotService = {
    async captureForTask(issueNumber: number, beforeUrl: string, afterUrl: string): Promise<ScreenshotResult> {
        await ensureDir();

        const beforePath = path.join(SCREENSHOTS_DIR, `${issueNumber}_before.png`);
        const afterPath = path.join(SCREENSHOTS_DIR, `${issueNumber}_after.png`);

        log.info(`Capturing screenshots for task #${issueNumber}`);
        log.info(`  BEFORE: ${beforeUrl}`);
        log.info(`  AFTER:  ${afterUrl}`);

        await capturePage(beforeUrl, beforePath);
        await capturePage(afterUrl, afterPath);

        return { beforePath, afterPath };
    },

    async captureSingle(url: string, label: string, options?: { darkMode?: boolean }): Promise<string> {
        await ensureDir();
        const outputPath = path.join(SCREENSHOTS_DIR, `${label}.png`);
        await capturePage(url, outputPath, options);
        return outputPath;
    },

    getScreenshotPath(issueNumber: number, type: 'before' | 'after'): string {
        return path.join(SCREENSHOTS_DIR, `${issueNumber}_${type}.png`);
    },

    screenshotsExist(issueNumber: number): boolean {
        const before = path.join(SCREENSHOTS_DIR, `${issueNumber}_before.png`);
        const after = path.join(SCREENSHOTS_DIR, `${issueNumber}_after.png`);
        return fs.existsSync(before) && fs.existsSync(after);
    },
};
