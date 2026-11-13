// Tests für die erzeugten Unterseiten (scripts/seiten.js) und die erzeugten Teile der Startseite
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { blockExternal } = require('./helpers');

const wurzel = path.join(__dirname, '..');
const lesen = d => fs.readFileSync(path.join(wurzel, d), 'utf8');
const katalog = JSON.parse(lesen('katalog.json'));
const seiten = JSON.parse(lesen('seiten.json')).seiten;
const euro = n => n.toFixed(2).replace('.', ',') + ' €';
const abPreis = p => Math.min(...p.merkmale.groesse.map(g => g.preis));
const zahlenkronen = katalog.produkte.filter(p => (p.konfigurator || {}).typ === 'zahl');

test('erzeugte Seiten sind aktuell (node scripts/seiten.js wurde ausgeführt)', () => {
  // wirft einen Fehler, wenn index.html, sitemap.xml oder eine Unterseite nicht zum Katalog passt
  execFileSync('node', [path.join(wurzel, 'scripts', 'seiten.js'), '--pruefen']);
});

test('sitemap.xml enthält Startseite und alle Unterseiten', () => {
  const sm = lesen('sitemap.xml');
  expect(sm).toContain('<loc>https://kronenwelt.de/</loc>');
  for (const s of seiten) expect(sm).toContain(`<loc>https://kronenwelt.de/${s.datei}</loc>`);
});

test.describe('Startseite', () => {
  test('zeigt für jedes Produkt im Katalog eine Karte mit dem richtigen ab-Preis – schon ohne JavaScript', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await blockExternal(page);
    await page.goto('/index.html');
    await expect(page.locator('.prod-card')).toHaveCount(katalog.produkte.length);
    for (const p of katalog.produkte) {
      const karte = page.locator(`.prod-card[data-variant="${p.name}"]`);
      await expect(karte).toHaveCount(1);
      await expect(karte.locator('.prod-price')).toHaveText('ab ' + euro(abPreis(p)));
    }
    await ctx.close();
  });

  test('hat genau eine Hauptüberschrift mit Suchbegriff und Namen', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/index.html');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText('Geburtstagskronen für Hunde');
    await expect(page.locator('h1')).toContainText('Kronenwelt');
  });

  test('verlinkt jede Unterseite', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/index.html');
    for (const s of seiten) {
      await expect(page.locator(`.mehr-seiten a[href="${s.datei}"]`)).toHaveCount(1);
      await expect(page.locator(`footer a[href="${s.datei}"]`)).toHaveCount(1);
    }
  });
});

for (const s of seiten) {
  test.describe(s.datei, () => {
    test('lädt ohne Fehler, ohne seitliches Scrollen und mit allen eigenen Dateien', async ({ page }) => {
      const fehler = [], fehlend = [];
      page.on('pageerror', e => fehler.push(String(e)));
      page.on('response', r => { if (r.url().startsWith('http://localhost') && r.status() >= 400) fehlend.push(r.url()); });
      await blockExternal(page);
      await page.goto('/' + s.datei);
      await page.waitForTimeout(300);
      expect(fehler).toEqual([]);
      expect(fehlend).toEqual([]);
      const breite = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(breite).toBeLessThanOrEqual(0);
    });

    test('hat Titel, Beschreibung, Canonical und genau eine H1', async ({ page }) => {
      await blockExternal(page);
      await page.goto('/' + s.datei);
      await expect(page).toHaveTitle(s.titel);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', s.beschreibung);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://kronenwelt.de/' + s.datei);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toContainText(s.h1);
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);   // darf nicht von Google ausgeschlossen sein
    });

    test('Produktdaten für Google (JSON-LD) sind gültig und passen zum Katalog', async ({ page }) => {
      await blockExternal(page);
      await page.goto('/' + s.datei);
      const daten = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
      const produkte = daten['@graph'].filter(x => x['@type'] === 'Product');
      expect(produkte.length).toBeGreaterThan(0);
      for (const pr of produkte) {
        expect(pr.offers.priceCurrency).toBe('EUR');
        expect(Number(pr.offers.lowPrice)).toBeGreaterThan(0);
        expect(pr.image).toMatch(/^https:\/\/res\.cloudinary\.com\//);
      }
    });

    test('alle internen Links führen zu vorhandenen Seiten', async ({ page, request }) => {
      await blockExternal(page);
      await page.goto('/' + s.datei);
      const hrefs = await page.locator('a[href]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute('href')))]);
      for (const h of hrefs.filter(h => !/^(https?:|mailto:|#)/.test(h))) {
        expect((await request.get(new URL(h, 'http://localhost:4173/' + s.datei).href)).ok(), h).toBeTruthy();
      }
    });
  });
}

test.describe('zahlenkrone-hund.html', () => {
  test('zeigt alle Zahlenkronen mit Preis aus dem Katalog', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/zahlenkrone-hund.html');
    await expect(page.locator('.prod-card')).toHaveCount(zahlenkronen.length);
    for (const p of zahlenkronen) {
      await expect(page.locator(`.prod-card[data-variant="${p.name}"] .prod-price`)).toHaveText('ab ' + euro(abPreis(p)));
    }
  });

  test('zeigt die Zahlenpad-Pakete mit Aufpreis aus dem Katalog', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/zahlenkrone-hund.html');
    for (const o of katalog.optionen.zahlenpets.werte) {
      const karte = page.locator('#zahlenpads .szinfo-card', { hasText: `${o.wert} Zahlenpads` });
      await expect(karte).toContainText(o.aufpreis ? '+ ' + euro(o.aufpreis) : 'im Preis enthalten');
    }
  });

  test('Klick auf eine Karte öffnet den Shop mit vorgewählter Zahlenkrone', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/zahlenkrone-hund.html');
    await page.locator('.prod-card[data-variant="Zahlenkrone Leo"]').click();
    await expect(page).toHaveURL(/\?krone=Zahlenkrone%20Leo#bestellen$/);
    await expect(page.locator('.chip.on[data-v="Zahlenkrone Leo"]')).toHaveCount(1);
  });
});
