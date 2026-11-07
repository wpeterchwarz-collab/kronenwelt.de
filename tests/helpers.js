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
  await page.click('#ckViewMain .ck-btn-primary');         // Cookie-Hinweis: "Verstanden"
  await expect(page.locator('#colorChips [data-c]').first()).toBeVisible();
}

// Preise je Krone und Größe aus katalog.json – gleiche Form wie früher preise.json:
// { 'Party': { 'Gross': 15, … }, …, 'Zahlenpets Aufpreis': { '6 Pets': 3, '9 Pets': 6 } }
const katalog = require('../katalog.json');
const preise = {};
for (const p of katalog.produkte) {
  preise[p.name] = {};
  for (const g of p.merkmale.groesse) preise[p.name][g.wert] = g.preis;
}
preise['Zahlenpets Aufpreis'] = {};
for (const o of katalog.optionen.zahlenpets.werte) if (o.wert !== 3) preise['Zahlenpets Aufpreis'][o.wert + ' Pets'] = o.aufpreis;

// Hauptfotos je Krone und Farbe – gleiche Form wie früher produktfotos.json
const fotos = {};
for (const p of katalog.produkte) {
  fotos[p.name] = { _default: p.hauptfoto };
  for (const f of p.merkmale.farbe) fotos[p.name][f.wert] = f.foto;
}
const euro = v => v.toFixed(2).replace('.', ',') + ' €';

module.exports = { blockExternal, openShop, katalog, preise, fotos, euro };
