// Admin-Seite: liest Kronen, Farben, Preise und Hauptfotos aus katalog.json (wie die Website)
// und speichert Preise zurück in katalog.json.
// admin.html liegt nur lokal (nicht auf GitHub) – ohne die Datei wird dieser Test übersprungen.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { katalog, fotos } = require('./helpers');

const ROOT  = path.join(__dirname, '..');
const ADMIN = path.join(ROOT, 'admin.html');
const KRONEN = katalog.produkte.map(p => p.name);

test.skip(!fs.existsSync(ADMIN), 'admin.html liegt nicht im Projektordner');

async function openAdmin(page, gespeichert = []) {
  await page.addInitScript(() => { localStorage.setItem('mkw_admin_pw', 'test'); localStorage.setItem('mkw_github_token', 'test'); });
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  // GitHub-API: Dateien aus dem Projektordner ausliefern, Speichern nur abfangen
  await page.route(/api\.github\.com\/repos\/.*\/contents\//, route => {
    const datei = decodeURIComponent(route.request().url().split('/contents/')[1]);
    const pfad = path.join(ROOT, datei);
    if (route.request().method() !== 'GET') {
      const body = JSON.parse(route.request().postData());
      gespeichert.push({ datei, inhalt: Buffer.from(body.content, 'base64').toString('utf8') });
      return route.fulfill({ json: {} });
    }
    if (!fs.existsSync(pfad)) return route.fulfill({ status: 404, json: {} });
    route.fulfill({ json: { sha: 'x', content: fs.readFileSync(pfad).toString('base64') } });
  });
  await page.goto('/admin.html');
  await expect(page.locator('#adminScreen')).toBeVisible();
  await expect(page.locator('#priceGrid .price-variant').first()).toBeVisible();
}

test('Admin: jedes Produkt aus dem Katalog hat eine Karte unter „Fotos & Video“ mit allen Farben', async ({ page }) => {
  await openAdmin(page);
  const karten = page.locator('#medienList .fv-krone');
  await expect(karten).toHaveCount(KRONEN.length);
  for (let i = 0; i < KRONEN.length; i++) {
    const v = KRONEN[i];
    await expect(karten.nth(i).locator('.fv-sum-name')).toHaveText(v);
    const optionen = await karten.nth(i).locator('select option').evaluateAll(o => o.map(x => x.value));
    expect(optionen.sort()).toEqual(Object.keys(fotos[v]).sort());   // _default = „Alle Farben“
  }
});

test('Admin: Hauptfoto zeigt den festen Namen aus dem Katalog', async ({ page }) => {
  await openAdmin(page);
  await page.click('.tab:has-text("Fotos & Video")');
  const karte = page.locator('#medienList .fv-krone').filter({ has: page.locator('.fv-sum-name', { hasText: /^Glitzer$/ }) });
  await karte.locator('summary').click();
  await expect(karte.locator('.fv-warn code')).toHaveText(fotos['Glitzer']._default);
  await karte.locator('select').selectOption('Türkis');
  await expect(karte.locator('.fv-warn code')).toHaveText(fotos['Glitzer']['Türkis']);
});

test('Admin: jedes Produkt hat Preisfelder mit den Größen aus dem Katalog', async ({ page }) => {
  await openAdmin(page);
  const bloecke = page.locator('#priceGrid .price-variant');
  for (const p of katalog.produkte) {
    const b = bloecke.filter({ has: page.locator('h3', { hasText: new RegExp('^' + p.name.replace(/[&]/g, '\\$&') + '$') }) });
    await expect(b, p.name).toHaveCount(1);
    await expect(b.locator('.price-row label')).toHaveText(p.merkmale.groesse.map(g => g.wert));
  }
});

test('Admin: Preise speichern ändert in katalog.json nur die Preise', async ({ page }) => {
  const gespeichert = [];
  await openAdmin(page, gespeichert);
  await page.fill('#price_Party_Gross', '16.5');
  await page.fill('#price_Zahlenpets_Aufpreis_6_Pets', '4');
  await page.evaluate(() => savePreise());
  await expect.poll(() => gespeichert.length).toBe(1);
  expect(gespeichert[0].datei).toBe('katalog.json');
  const neu = JSON.parse(gespeichert[0].inhalt);
  const erwartet = JSON.parse(JSON.stringify(katalog));
  erwartet.produkte.find(p => p.name === 'Party').merkmale.groesse.find(g => g.wert === 'Gross').preis = 16.5;
  erwartet.optionen.zahlenpets.werte.find(o => o.wert === 6).aufpreis = 4;
  expect(neu).toEqual(erwartet);
});
