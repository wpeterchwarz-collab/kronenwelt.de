// Admin-Seite: jede Krone/Farbe aus produktfotos.json (= Konfigurator) hat eine Foto-Kachel,
// steht in der Farbauswahl von „Mehr Fotos & Video“ und hat Preisfelder.
// admin.html liegt nur lokal (nicht auf GitHub) – ohne die Datei wird dieser Test übersprungen.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const ADMIN = path.join(ROOT, 'admin.html');
const fotos = require('../produktfotos.json');
const KRONEN = Object.keys(fotos).filter(k => !k.startsWith('_'));

test.skip(!fs.existsSync(ADMIN), 'admin.html liegt nicht im Projektordner');

async function openAdmin(page) {
  await page.addInitScript(() => { localStorage.setItem('mkw_admin_pw', 'test'); localStorage.setItem('mkw_github_token', 'test'); });
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  // GitHub-API: Dateien aus dem Projektordner ausliefern, Speichern nur abfangen
  await page.route(/api\.github\.com\/repos\/.*\/contents\//, route => {
    const datei = decodeURIComponent(route.request().url().split('/contents/')[1]);
    const pfad = path.join(ROOT, datei);
    if (route.request().method() !== 'GET') return route.fulfill({ json: {} });
    if (!fs.existsSync(pfad)) return route.fulfill({ status: 404, json: {} });
    route.fulfill({ json: { sha: 'x', content: fs.readFileSync(pfad).toString('base64') } });
  });
  await page.goto('/admin.html');
  await expect(page.locator('#adminScreen')).toBeVisible();
  await expect(page.locator('#priceGrid .price-variant').first()).toBeVisible();
}

test('Admin: jede Farbe aus dem Konfigurator hat eine Produktfoto-Kachel', async ({ page }) => {
  await openAdmin(page);
  const kacheln = await page.$$eval('#fotoGrid .foto-item code', e => e.map(x => x.textContent.trim()));
  for (const v of KRONEN) {
    for (const [farbe, id] of Object.entries(fotos[v])) {
      expect(kacheln, `${v} – ${farbe} (${id}) fehlt im Admin unter Produktfotos`).toContain(id);
    }
  }
});

test('Admin: jede Farbe ist bei „Mehr Fotos & Video“ wählbar', async ({ page }) => {
  await openAdmin(page);
  const bloecke = page.locator('#medienList .medien-variant');
  await expect(bloecke).toHaveCount(KRONEN.length);
  for (let i = 0; i < KRONEN.length; i++) {
    const v = KRONEN[i];
    await expect(bloecke.nth(i).locator('h3')).toHaveText(v);
    const optionen = await bloecke.nth(i).locator('select option').evaluateAll(o => o.map(x => x.value));
    expect(optionen.sort()).toEqual(Object.keys(fotos[v]).sort());   // _default = „Alle Farben“
  }
});

test('Admin: jede Krone hat Preisfelder', async ({ page }) => {
  await openAdmin(page);
  const titel = await page.$$eval('#priceGrid .price-variant h3', e => e.map(x => x.textContent.trim()));
  for (const v of KRONEN) expect(titel, `Preise für ${v} fehlen im Admin`).toContain(v);
});
