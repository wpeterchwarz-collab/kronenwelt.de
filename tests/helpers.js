const { expect } = require('@playwright/test');

// Externe Dienste blockieren, damit Tests schnell und unabhängig laufen
async function blockExternal(page) {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
}

// Shop öffnen, Cookie-Banner schließen, warten bis der Konfigurator bereit ist
async function openShop(page, { errors } = {}) {
  if (errors) {
    page.on('pageerror', e => errors.push(e.message));
  }
  await blockExternal(page);
  await page.goto('/index.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.click('.ck-btn-secondary >> nth=0');          // "Nur notwendige"
  await expect(page.locator('#colorChips [data-c]').first()).toBeVisible();
}

const preise = require('../preise.json');
const euro = v => v.toFixed(2).replace('.', ',') + ' €';

module.exports = { blockExternal, openShop, preise, euro };
