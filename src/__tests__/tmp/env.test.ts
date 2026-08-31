import { describe, it } from 'vitest';

describe('env', () => {
    it('logs env', () => {
        console.log('env:', JSON.stringify(import.meta.env));
        console.log('DEV:', import.meta.env.DEV);
        console.log('PROD:', import.meta.env.PROD);
        console.log('MODE:', import.meta.env.MODE);
    });
});
