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

async function openAdmin(page, gespeichert = [], { seite = '#produkte/preise', fehlendeFotos = [] } = {}) {
  await page.addInitScript(() => { localStorage.setItem('mkw_admin_pw', 'test'); localStorage.setItem('mkw_github_token', 'test'); });
  await page.route(/^https?:\/\/(?!localhost)/, route => {
    const u = route.request().url();
    // Cloudinary-Vorschaubilder: vorhanden, außer den absichtlich fehlenden
    if (u.includes('res.cloudinary.com')) {
      if (fehlendeFotos.some(id => u.includes('/' + id + '.'))) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
    }
    if (u.includes('/commits?')) return route.fulfill({ json: [
      { commit: { message: 'Admin: Preise aktualisiert', author: { date: new Date().toISOString() } } }] });
    return route.abort();
  });
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
  await page.goto('/admin.html' + seite);
  await expect(page.locator('#adminScreen')).toBeVisible();
  await expect(page.locator('#statusText')).toHaveText(/Daten geladen/);
}

test('Admin: jedes Produkt aus dem Katalog hat eine Karte unter „Fotos & Video“ mit allen Farben', async ({ page }) => {
  await openAdmin(page, [], { seite: '#produkte/medien' });
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
  await page.click('.subnav-item[data-seite="medien"]');
  const karte = page.locator('#medienList .fv-krone').filter({ has: page.locator('.fv-sum-name', { hasText: /^Glitzer$/ }) });
  await karte.locator('summary').click();
  await expect(karte.locator('.medien-tile.haupt')).toHaveAttribute('data-id', fotos['Glitzer']._default);
  await karte.locator('select').selectOption('Türkis');
  await expect(karte.locator('.medien-tile.haupt')).toHaveAttribute('data-id', fotos['Glitzer']['Türkis']);
  await expect(karte.locator('.fv-teilt')).toHaveCount(0);
  await karte.locator('select').selectOption('Rosa');                 // Rosa und Pink teilen sich ein Foto
  await expect(karte.locator('.fv-teilt')).toContainText('Pink');
});

test('Admin: jedes Produkt hat Preisfelder mit den Größen aus dem Katalog', async ({ page }) => {
  await openAdmin(page);
  const bloecke = page.locator('#priceGrid .price-variant');
  for (const p of katalog.produkte) {
    const b = bloecke.filter({ has: page.locator('h3', { hasText: new RegExp('^' + p.name.replace(/[&]/g, '\\$&') + '$') }) });
    await expect(b, p.name).toHaveCount(1);
    await expect(b.locator('.price-row label, .zahl-tab label')).toHaveText(p.merkmale.groesse.map(g => g.wert));
  }
});

test('Admin: Zahlenkronen zeigen die Endpreise für 3, 6 und 9 Pets', async ({ page }) => {
  await openAdmin(page);
  const auf = Object.fromEntries(katalog.optionen.zahlenpets.werte.map(o => [o.wert, o.aufpreis]));
  for (const p of katalog.produkte.filter(p => (p.optionen || []).includes('zahlenpets'))) {
    const b = page.locator('#priceGrid .price-variant.zahl').filter({ has: page.locator('h3', { hasText: p.name }) });
    for (const g of p.merkmale.groesse) {
      for (const n of [6, 9]) {
        const erwartet = (g.preis + auf[n]).toFixed(2).replace('.', ',') + ' €';
        await expect(b.locator(`.endpreis[data-g="${g.wert}"][data-p="${n}"]`)).toHaveText(erwartet);
      }
    }
  }
  // Aufpreis ändern → Endpreise rechnen sofort mit
  await page.fill('#price_Zahlenpets_Aufpreis_6_Pets', '5');
  const klassik = katalog.produkte.find(p => p.name === 'Zahlenkrone Klassik');
  const gross = klassik.merkmale.groesse.find(g => g.wert === 'Gross').preis;
  await expect(page.locator('#priceGrid .price-variant.zahl').first().locator('.endpreis[data-g="Gross"][data-p="6"]'))
    .toHaveText((gross + 5).toFixed(2).replace('.', ',') + ' €');
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

test.describe('Admin: Navigation und Start', () => {
  test('ohne Adresse öffnet die Startseite, die Navigation zeigt alle Bereiche', async ({ page }) => {
    await openAdmin(page, [], { seite: '' });
    await expect(page.locator('#tab-start')).toBeVisible();
    await expect(page.locator('.nav-item')).toHaveText(['Start', 'Produkte', 'Galerie', 'Einstellungen']);
    await expect(page.locator('.nav-item.active')).toHaveText('Start');
  });

  test('Navigation liegt am Laptop links und am Handy unten', async ({ page }, info) => {
    await openAdmin(page, [], { seite: '' });
    const box = await page.locator('#hauptNav').boundingBox();
    const vp = page.viewportSize();
    if (info.project.name === 'handy') expect(box.y + box.height).toBeGreaterThanOrEqual(vp.height - 1);
    else { expect(box.x).toBe(0); expect(box.width).toBeLessThan(260); }
  });

  test('Produkte hat Unterreiter, Adresse und Zurück-Taste funktionieren', async ({ page }) => {
    await openAdmin(page, [], { seite: '' });
    await page.click('.nav-item[data-nav="produkte"]');
    await expect(page).toHaveURL(/#produkte\/preise$/);
    await expect(page.locator('#priceGrid')).toBeVisible();
    await page.click('.subnav-item[data-seite="medien"]');
    await expect(page).toHaveURL(/#produkte\/medien$/);
    await expect(page.locator('#medienList')).toBeVisible();
    await page.click('.nav-item[data-nav="galerie"]');
    await expect(page.locator('#subNav')).toBeHidden();
    await page.click('.nav-item[data-nav="produkte"]');               // merkt sich die letzte Unterseite
    await expect(page.locator('.subnav-item.active')).toHaveText('Fotos & Video');
    await page.goBack();
    await expect(page.locator('.nav-item.active')).toHaveText('Galerie');
  });

  test('Start zeigt Zahlen aus Katalog und medien.json', async ({ page }) => {
    await openAdmin(page, [], { seite: '' });
    const medien = require('../medien.json');
    const fotos = Object.values(medien).reduce((n, k) => n + Object.values(k).reduce((m, e) => m + ((e && e.bilder) || []).length, 0), 0);
    const artikel = katalog.produkte.reduce((n, p) => n + p.merkmale.farbe.length * p.merkmale.groesse.length, 0);
    const zahl = t => page.locator('#startZahlen .zahl').filter({ hasText: t }).locator('b');
    await expect(zahl('Produkte')).toHaveText(String(katalog.produkte.length));
    await expect(zahl('Artikel')).toHaveText(String(artikel));
    await expect(zahl('weitere Fotos')).toHaveText(String(fotos));
    await expect(page.locator('#startVerlauf')).toContainText('Preise aktualisiert');
  });

  test('Start meldet ein fehlendes Hauptfoto und springt zur richtigen Farbe', async ({ page }) => {
    await openAdmin(page, [], { seite: '', fehlendeFotos: [fotos['Glitzer']['Türkis']] });
    const punkt = page.locator('.todo').filter({ hasText: 'Hauptfoto fehlt: Glitzer – Türkis' });
    await expect(punkt).toBeVisible();
    await punkt.click();
    await expect(page).toHaveURL(/#produkte\/medien$/);
    const karte = page.locator('#medienList .fv-krone[open]');
    await expect(karte.locator('.fv-sum-name')).toHaveText('Glitzer');
    await expect(karte.locator('select')).toHaveValue('Türkis');
  });
});
