// Playwright-Konfiguration: startet einen lokalen Webserver und testet den Shop
// in Desktop- und Handy-Größe. Externe Dienste (PayPal, Cloudinary, EmailJS, Google) werden blockiert.
const { defineConfig, devices } = require('@playwright/test');

const OHNE_BROWSER = /schnittstelle\.spec\.js$/;

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  // Die Schnittstellen-Tests brauchen keinen Browser (echter Code.gs in Node) → nur einmal laufen lassen,
  // nicht doppelt in Desktop- und Handy-Größe.
  projects: [
    { name: 'desktop', testIgnore: OHNE_BROWSER, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'handy',   testIgnore: OHNE_BROWSER, use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false } },
    { name: 'ohne-browser', testMatch: OHNE_BROWSER },
  ],
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
