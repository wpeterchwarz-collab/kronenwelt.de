// Konfigurator ⇔ Admin: Jede Krone und jede Farbe, die man im Konfigurator wählen kann,
// muss in produktfotos.json stehen. Aus dieser Datei baut die Admin-Seite ihre Foto-Kacheln
// (Produktfotos) und die Farbauswahl (Mehr Fotos & Video) – fehlt hier etwas, kann Sara es nicht pflegen.
const { test, expect } = require('@playwright/test');
const { openShop } = require('./helpers');

const fotos  = require('../produktfotos.json');
const preise = require('../preise.json');
const KRONEN = Object.keys(fotos).filter(k => !k.startsWith('_'));

// Alle Kronen und Farben so auslesen, wie ein Kunde sie im Konfigurator sieht
async function konfiguratorAuswahl(page) {
  await openShop(page);
  const auswahl = {};
  for (const mode of ['name', 'zahl']) {
    await page.click(`.mode-tab[data-mode="${mode}"]`);
    const kronen = await page.$$eval(`.chip[data-v][data-mode="${mode}"]`, e => e.map(x => x.dataset.v));
    for (const v of kronen) {
      await page.click(`.chip[data-v="${v}"]`);
      auswahl[v] = await page.$$eval('#colorChips [data-c]', e => e.map(x => x.dataset.c));
    }
  }
  return auswahl;
}

test('jede Krone und Farbe aus dem Konfigurator ist im Admin pflegbar (produktfotos.json)', async ({ page }) => {
  const auswahl = await konfiguratorAuswahl(page);
  expect(Object.keys(auswahl).length).toBeGreaterThan(0);
  for (const [v, farben] of Object.entries(auswahl)) {
    expect(fotos[v], `Krone "${v}" fehlt in produktfotos.json`).toBeTruthy();
    expect(fotos[v]._default, `"${v}" braucht ein _default-Foto`).toBeTruthy();
    for (const f of farben) {
      expect(fotos[v][f], `Farbe "${f}" bei "${v}" fehlt in produktfotos.json → im Admin nicht pflegbar`).toBeTruthy();
    }
    // keine Altlasten: Farben, die es im Konfigurator nicht (mehr) gibt
    const extra = Object.keys(fotos[v]).filter(f => f !== '_default' && !farben.includes(f));
    expect(extra, `"${v}": Farben in produktfotos.json, die der Konfigurator nicht anbietet`).toEqual([]);
  }
  const ohneKonfigurator = KRONEN.filter(v => !auswahl[v]);
  expect(ohneKonfigurator, 'Kronen in produktfotos.json, die der Konfigurator nicht anbietet').toEqual([]);
});

test('jede Krone hat Preise (Admin-Tab Preise)', async () => {
  for (const v of KRONEN) expect(preise[v], `Preise für "${v}" fehlen in preise.json`).toBeTruthy();
});

test('Produktkarten zeigen das _default-Foto aus produktfotos.json (Admin: Kollektion)', async ({ page }) => {
  await openShop(page);
  const karten = await page.$$eval('.prod-card[data-variant]', cs => cs.map(c => ({
    v: c.dataset.variant, src: (c.querySelector('.prod-img img') || {}).getAttribute('src') || ''
  })));
  expect(karten.map(k => k.v).sort()).toEqual([...KRONEN].sort());
  for (const k of karten) {
    expect(k.src, `Produktkarte "${k.v}"`).toMatch(new RegExp('/' + fotos[k.v]._default + '\\.jpg$'));
  }
});

test('Konfigurator zeigt das Foto der gewählten Farbe aus produktfotos.json', async ({ page }) => {
  const geladen = [];
  page.on('request', r => { if (r.url().includes('res.cloudinary.com')) geladen.push(r.url()); });
  await openShop(page);
  await page.click('.chip[data-v="Glitzer"]');
  await page.click('#colorChips [data-c="Türkis"]');
  await expect.poll(() => geladen.some(u => u.includes('/glitzer-tuerkis.jpg'))).toBe(true);
});
