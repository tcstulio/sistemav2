import fs from 'fs';
import path from 'path';

/**
 * Atomic file write: writes to a temp file first, then renames.
 * This prevents data corruption if the process crashes mid-write.
 */
export function atomicWriteSync(filePath: string, data: unknown): void {
    const dir = path.dirname(filePath);
    if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
}
