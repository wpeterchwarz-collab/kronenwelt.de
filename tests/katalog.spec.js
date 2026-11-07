// Produktkatalog (katalog.json): die eine Quelle für Konfigurator, Preise, Hauptfotos,
// Admin und Google-Produktdatei. Diese Tests prüfen, dass der Katalog in sich stimmig ist
// und dass die Website wirklich aus ihm gebaut wird.
const { test, expect } = require('@playwright/test');
const { openShop, katalog, fotos, euro } = require('./helpers');

const KRONEN = katalog.produkte.map(p => p.name);
const GROESSEN = katalog.merkmale.groesse.werte;

// Artikelnummer = Gruppenkürzel-Produktkürzel-Kürzel je Merkmal (siehe _info in katalog.json)
function artikelnummern() {
  const liste = [];
  for (const p of katalog.produkte) {
    const gruppe = katalog.gruppen.find(g => g.id === p.gruppe);
    for (const f of p.merkmale.farbe) {
      for (const g of p.merkmale.groesse) {
        const gk = GROESSEN.find(x => x.wert === g.wert).kuerzel;
        liste.push([gruppe.kuerzel, p.kuerzel, f.kuerzel, gk].join('-'));
      }
    }
  }
  return liste;
}

test.describe('Katalog: Aufbau', () => {
  test('jedes Produkt gehört zu einer Gruppe und nutzt nur deren Merkmale', async () => {
    for (const p of katalog.produkte) {
      const gruppe = katalog.gruppen.find(g => g.id === p.gruppe);
      expect(gruppe, `${p.name}: Gruppe "${p.gruppe}" fehlt`).toBeTruthy();
      for (const m of Object.keys(p.merkmale)) {
        expect(gruppe.merkmale, `${p.name}: Merkmal "${m}" ist in der Gruppe nicht erlaubt`).toContain(m);
        expect(katalog.merkmale[m], `Merkmal "${m}" ist nicht definiert`).toBeTruthy();
      }
    }
  });

  test('Produkt-IDs, Kürzel und Namen sind eindeutig', async () => {
    for (const feld of ['id', 'kuerzel', 'name']) {
      const werte = katalog.produkte.map(p => p[feld]);
      expect(new Set(werte).size, `doppelte Produkt-${feld}`).toBe(werte.length);
    }
    for (const p of katalog.produkte) {
      const kz = p.merkmale.farbe.map(f => f.kuerzel);
      expect(new Set(kz).size, `${p.name}: doppeltes Farb-Kürzel`).toBe(kz.length);
      for (const k of [p.kuerzel, ...kz]) expect(k, `${p.name}: Kürzel nur A–Z und 0–9`).toMatch(/^[A-Z0-9]+$/);
    }
  });

  test('Artikelnummern sind eindeutig (feste Kennung für Lager und Bestellungen)', async () => {
    const nr = artikelnummern();
    expect(nr.length).toBeGreaterThan(0);
    expect(nr.filter((x, i) => nr.indexOf(x) !== i)).toEqual([]);
    expect(nr).toContain('KR-PARTY-ROSA-GR');
  });

  test('jede Größe ist definiert und hat einen Preis', async () => {
    for (const p of katalog.produkte) {
      for (const g of p.merkmale.groesse) {
        expect(GROESSEN.some(x => x.wert === g.wert), `${p.name}: Größe "${g.wert}" unbekannt`).toBeTruthy();
        expect(g.preis, `${p.name} ${g.wert}: Preis`).toBeGreaterThan(0);
      }
    }
  });

  test('jedes Produkt und jede Farbe hat ein Hauptfoto, Texte für Google sind da', async () => {
    for (const p of katalog.produkte) {
      expect(p.hauptfoto, `${p.name}: Hauptfoto (Kollektion)`).toBeTruthy();
      for (const f of p.merkmale.farbe) expect(f.foto, `${p.name} – ${f.wert}: Hauptfoto`).toBeTruthy();
      expect(p.texte && p.texte.googleTitel, `${p.name}: Google-Titel`).toBeTruthy();
      expect(p.texte && p.texte.googleText, `${p.name}: Google-Text`).toBeTruthy();
    }
  });

  test('verwendete Optionen sind definiert', async () => {
    for (const p of katalog.produkte) {
      for (const o of p.optionen || []) expect(katalog.optionen[o], `${p.name}: Option "${o}"`).toBeTruthy();
    }
  });
});

test.describe('Katalog ⇔ Website', () => {
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

  test('Konfigurator bietet genau die Kronen und Farben aus dem Katalog an', async ({ page }) => {
    const auswahl = await konfiguratorAuswahl(page);
    expect(Object.keys(auswahl).sort()).toEqual([...KRONEN].sort());
    for (const p of katalog.produkte) {
      expect(auswahl[p.name], p.name).toEqual(p.merkmale.farbe.map(f => f.wert));
    }
  });

  test('Produktkarten zeigen das Hauptfoto (Kollektion) aus dem Katalog', async ({ page }) => {
    await openShop(page);
    const karten = await page.$$eval('.prod-card[data-variant]', cs => cs.map(c => ({
      v: c.dataset.variant, src: (c.querySelector('.prod-img img') || {}).getAttribute('src') || ''
    })));
    expect(karten.map(k => k.v).sort()).toEqual([...KRONEN].sort());
    for (const k of karten) {
      expect(k.src, `Produktkarte "${k.v}"`).toMatch(new RegExp('/' + fotos[k.v]._default + '\\.jpg$'));
    }
  });

  test('Konfigurator zeigt das Foto der gewählten Farbe aus dem Katalog', async ({ page }) => {
    const geladen = [];
    page.on('request', r => { if (r.url().includes('res.cloudinary.com')) geladen.push(r.url()); });
    await openShop(page);
    await page.click('.chip[data-v="Glitzer"]');
    await page.click('#colorChips [data-c="Türkis"]');
    await expect.poll(() => geladen.some(u => u.includes('/glitzer-tuerkis.jpg'))).toBe(true);
  });

  test('eine Preisänderung im Katalog kommt im Shop an', async ({ page }) => {
    const geaendert = JSON.parse(JSON.stringify(katalog));
    const party = geaendert.produkte.find(p => p.name === 'Party');
    party.merkmale.groesse.find(g => g.wert === 'Gross').preis = 99;
    await page.route('**/katalog.json', r => r.fulfill({ json: geaendert }));
    await openShop(page);
    await page.click('.chip[data-v="Party"]');
    await page.click('.szcard[data-s="Gross"]');
    await expect(page.locator('#totP')).toHaveText(euro(99));
  });

  test('eine neue Farbe im Katalog erscheint im Konfigurator', async ({ page }) => {
    const geaendert = JSON.parse(JSON.stringify(katalog));
    geaendert.produkte.find(p => p.name === 'Einfarbig').merkmale.farbe.push({
      wert: 'Testfarbe', kuerzel: 'TEST', foto: 'uni-mint',
      anzeige: { bg: '#eeeeee', sc: '#555555', dot: '#777777', css: '' }
    });
    await page.route('**/katalog.json', r => r.fulfill({ json: geaendert }));
    await openShop(page);
    await page.click('.chip[data-v="Einfarbig"]');
    await expect(page.locator('#colorChips [data-c="Testfarbe"]')).toBeVisible();
  });

  test('ohne katalog.json läuft der Shop mit dem eingebauten Notfall-Stand weiter', async ({ page }) => {
    const errors = [];
    await page.route('**/katalog.json', r => r.fulfill({ status: 404, body: '' }));
    await openShop(page, { errors });
    await page.click('.chip[data-v="Party"]');
    await page.click('.szcard[data-s="Gross"]');
    await expect(page.locator('#totP')).toHaveText(/\d+,\d{2} €/);
    expect(errors).toEqual([]);
  });
});
