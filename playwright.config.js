// Playwright-Konfiguration: startet einen lokalen Webserver und testet den Shop
// in Desktop- und Handy-Größe. Externe Dienste (PayPal, Cloudinary, EmailJS, Google) werden blockiert.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'handy',   use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false } },
  ],
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
