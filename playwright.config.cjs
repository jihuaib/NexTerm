const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './e2e',
    timeout: 45_000,
    expect: { timeout: 8_000 },
    fullyParallel: false,
    workers: 1,
    reporter: process.env.CI ? [['line']] : [['list']],
    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    }
});
