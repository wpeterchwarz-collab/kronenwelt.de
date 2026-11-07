// Admin-Seite: liest Kronen, Farben, Preise und Hauptfotos aus katalog.json (wie die Website)
// und speichert Preise zurück in katalog.json.
// admin.html liegt nur lokal (nicht auf GitHub) – ohne die Datei wird dieser Test übersprungen.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { katalog, fotos } = require('./helpers');
const { umgebung } = require('./schnittstelle-attrappe');

const ROOT  = path.join(__dirname, '..');
const ADMIN = path.join(ROOT, 'admin.html');
const KRONEN = katalog.produkte.map(p => p.name);

test.skip(!fs.existsSync(ADMIN), 'admin.html liegt nicht im Projektordner');

// Bestellungen in der nachgestellten Tabelle (Anzeige-Werte, Preis als Zahl)
const BESTELLUNGEN = [
  ['08.04.2026', '21:49', 'KW-20260408-000', 'Party', 'Rosa mit Punkten', 'Gross', 'TEST', 0.01, 'PayPal', 'Peter Schwarz', 'p@example.de', 'Weg 8, 75045 Walzbachtal, DE'],
  ['', '', '', '', '', '', '', 0.01, '', '', '', ''],
  ['01.10.2026', '12:12', 'KW-20261001-003', 'Einfarbig, Glitzer', 'Grün, Blau', 'Extra Mini, Gross', 'FRIDOLIN | ohne Namen', 29, 'PayPal', 'Kim Muster', 'k@example.de', 'Moorblick 4, 24329 Dannau, DE']
];

// api: true → Admin-Schlüssel ist eingetragen, die Schnittstelle (echter Apps-Script-Code) antwortet
// lager: Zeilen für das Blatt „Lagerbewegungen“ (ohne Kopf), z. B. [['01.11.2026', '', 'KR-…', '', 'Werkstatt', 2, 'Genäht', '', '']]
async function openAdmin(page, gespeichert = [], { seite = '#produkte/preise', fehlendeFotos = [], api = false, apiSchluessel = 'GEHEIM123', lager = null } = {}) {
  await page.addInitScript(() => { localStorage.setItem('mkw_admin_pw', 'test'); localStorage.setItem('mkw_github_token', 'test'); });
  const blaetter = lager ? { Lagerbewegungen: [['Datum', 'Uhrzeit', 'Artikelnr.', 'Artikel', 'Kiste', 'Menge', 'Grund', 'Bestellnr.', 'Notiz'], ...lager] } : {};
  const tabelle = umgebung(BESTELLUNGEN, 'GEHEIM123', { blaetter });
  await page.route(/^https?:\/\/(?!localhost)/, route => {
    const u = route.request().url();
    if (u.includes('script.google.com')) {
      return route.fulfill({ json: tabelle.post(JSON.parse(route.request().postData())) });
    }
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
  if (api) {
    // Schlüssel so speichern, wie die Admin-Seite es tut (verschlüsselt mit dem Admin-Passwort)
    await page.goto('/admin.html#einstellungen');
    await expect(page.locator('#adminScreen')).toBeVisible();
    const enc = await page.evaluate(k => encryptToken(k, 'test'), apiSchluessel);
    await page.addInitScript(e => localStorage.setItem('mkw_api_schluessel_enc', e), enc);
  }
  await page.goto('/admin.html' + seite);
  if (api) await page.reload();
  await expect(page.locator('#adminScreen')).toBeVisible();
  await expect(page.locator('#statusText')).toHaveText(/Daten geladen/);
  return tabelle;
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
    await expect(page.locator('.nav-item')).toHaveText(['Start', 'Bestellungen', 'Lager', 'Produkte', 'Galerie', 'Einstellungen']);
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

test.describe('Admin: Bestellungen', () => {
  test('ohne Admin-Schlüssel: Hinweis zum Einrichten statt Bestellungen', async ({ page }) => {
    await openAdmin(page, [], { seite: '' });
    await expect(page.locator('#startBestellungen')).toContainText('Noch nicht verbunden');
    await page.click('.nav-item[data-nav="bestellungen"]');
    await expect(page.locator('#bestInhalt')).toContainText('Bestellungen verbinden');
    await page.click('#bestInhalt button:has-text("Zu den Einstellungen")');
    await expect(page.locator('#karteSchnittstelle')).toBeVisible();
  });

  test('Liste: neueste zuerst, Summenzeile übersprungen, zwei Kronen als zwei Positionen', async ({ page }) => {
    await openAdmin(page, [], { seite: '#bestellungen', api: true });
    const karten = page.locator('#bestListe .best');
    await expect(karten).toHaveCount(2);
    await expect(karten.nth(0).locator('.best-kunde')).toHaveText(/^Kim Muster/);
    await expect(karten.nth(0).locator('.best-betrag')).toContainText('29,00 €');
    await expect(karten.nth(0).locator('.best-betrag small')).toHaveText('2 Kronen');
    await karten.nth(0).locator('summary').first().click();
    await expect(karten.nth(0).locator('.best-artikel li')).toHaveText([
      'Einfarbig · Grün · Extra Mini · „FRIDOLIN“', 'Glitzer · Blau · Gross · ohne Namen']);
    await expect(karten.nth(0).locator('a[href^="mailto:k@example.de"]')).toBeVisible();
    await expect(page.locator('#bestSumme')).toContainText('2 Bestellungen');
  });

  test('Suche findet Name, Ort und Krone', async ({ page }) => {
    await openAdmin(page, [], { seite: '#bestellungen', api: true });
    await expect(page.locator('#bestListe .best')).toHaveCount(2);
    await page.fill('#bestSuche', 'dannau');
    await expect(page.locator('#bestListe .best')).toHaveCount(1);
    await page.fill('#bestSuche', 'party');
    await expect(page.locator('#bestListe .best .best-kunde')).toHaveText(/^Peter Schwarz/);
    await page.fill('#bestSuche', 'gibtsnicht');
    await expect(page.locator('#bestListe')).toContainText('Keine Bestellung passt');
  });

  test('Startseite zeigt die neuesten Bestellungen, ein Tipp öffnet die Bestellung', async ({ page }) => {
    await openAdmin(page, [], { seite: '', api: true });
    const zeilen = page.locator('#startBestellungen .start-best');
    await expect(zeilen).toHaveCount(2);
    await expect(zeilen.first()).toContainText('Kim Muster');
    await zeilen.first().click();
    await expect(page.locator('.best[data-nr="KW-20261001-003"]')).toHaveAttribute('open', '');
  });

  test('falscher Schlüssel: verständliche Meldung, keine Daten', async ({ page }) => {
    await openAdmin(page, [], { seite: '#bestellungen', api: true, apiSchluessel: 'FALSCH' });
    await expect(page.locator('#bestInhalt')).toContainText('Der Admin-Schlüssel stimmt nicht');
    await expect(page.locator('#bestListe .best')).toHaveCount(0);
  });

  test('Einstellungen: Schlüssel eintragen, Verbindung wird getestet und verschlüsselt gespeichert', async ({ page }) => {
    await openAdmin(page, [], { seite: '#einstellungen' });
    await page.fill('#settingsApiSchluessel', 'GEHEIM123');
    await page.click('#karteSchnittstelle button:has-text("Speichern")');
    await expect(page.locator('#schnittstelleStatus')).toContainText('Verbunden mit „Kronenwelt Bestellungen“');
    const gespeichert = await page.evaluate(() => localStorage.getItem('mkw_api_schluessel_enc'));
    expect(gespeichert).toBeTruthy();
    expect(gespeichert).not.toContain('GEHEIM123');
    await page.click('.nav-item[data-nav="bestellungen"]');
    await expect(page.locator('#bestListe .best')).toHaveCount(2);
  });
});

test.describe('Admin: Bestellungen bearbeiten', () => {
  const karte = (page, nr) => page.locator(`.best[data-nr="${nr}"]`);

  test('Filter: offen ist voreingestellt, Zähler stimmen', async ({ page }) => {
    await openAdmin(page, [], { seite: '#bestellungen', api: true });
    await expect(page.locator('#bestFilterLeiste button.active')).toContainText('Offen');
    await expect(page.locator('#bestFilterLeiste [data-filter="offen"] span')).toHaveText('2');
    await expect(page.locator('#bestFilterLeiste [data-filter="erledigt"] span')).toHaveText('0');
  });

  test('In Arbeit nehmen ändert den Status in der Tabelle', async ({ page }) => {
    const tabelle = await openAdmin(page, [], { seite: '#bestellungen', api: true });
    await karte(page, 'KW-20261001-003').locator('summary').first().click();
    await karte(page, 'KW-20261001-003').locator('button:has-text("In Arbeit nehmen")').click();
    await expect(karte(page, 'KW-20261001-003').locator('.status')).toHaveText('In Arbeit');
    const zeile = tabelle.daten.find(z => z[2] === 'KW-20261001-003');
    expect(zeile[tabelle.daten[0].indexOf('Status')]).toBe('In Arbeit');
  });

  test('Versenden mit DHL-Nummer schickt die Versandmail und verschiebt nach „Erledigt“', async ({ page }) => {
    const tabelle = await openAdmin(page, [], { seite: '#bestellungen', api: true });
    const k = karte(page, 'KW-20261001-003');
    await k.locator('summary').first().click();
    await k.locator('button:has-text("Jetzt versenden")').click();          // neue Bestellung: direkt versenden
    await k.locator('input[id^="sn-"]').fill('0034 0434 1234 5678 90');
    await expect(k.locator('input[id^="mail-"]')).toBeChecked();             // Webshop: Mail ist vorausgewählt
    await k.locator('button:has-text("Als versendet markieren")').click();
    await expect(page.locator('#statusText')).toContainText('Versandmail an k@example.de');
    expect(tabelle.mails).toHaveLength(1);
    expect(tabelle.mails[0].htmlBody).toContain('piececode=003404341234567890');
    await expect(page.locator('#bestFilterLeiste [data-filter="erledigt"] span')).toHaveText('1');
    await expect(k).toHaveCount(0);                                            // nicht mehr unter „Offen“
    await page.click('#bestFilterLeiste [data-filter="erledigt"]');
    await expect(k.locator('.status')).toHaveText('Versendet');
    await expect(k.locator('a[href*="piececode=003404341234567890"]')).toBeVisible();
  });

  test('Versenden ohne Mail: Haken abwählen, es geht keine Mail raus', async ({ page }) => {
    const tabelle = await openAdmin(page, [], { seite: '#bestellungen', api: true });
    const k = karte(page, 'KW-20261001-003');
    await k.locator('summary').first().click();
    await k.locator('button:has-text("Jetzt versenden")').click();          // neue Bestellung: direkt versenden
    await k.locator('input[id^="sn-"]').fill('123456789012');
    await k.locator('input[id^="mail-"]').uncheck();
    await k.locator('button:has-text("Als versendet markieren")').click();
    await expect(page.locator('#statusText')).toHaveText(/Als versendet markiert/);
    expect(tabelle.mails).toHaveLength(0);
  });

  test('falsche Sendungsnummer wird vor dem Senden abgefangen', async ({ page }) => {
    const tabelle = await openAdmin(page, [], { seite: '#bestellungen', api: true });
    const k = karte(page, 'KW-20261001-003');
    await k.locator('summary').first().click();
    await k.locator('button:has-text("Jetzt versenden")').click();          // neue Bestellung: direkt versenden
    await k.locator('input[id^="sn-"]').fill('12-34');
    await k.locator('button:has-text("Als versendet markieren")').click();
    await expect(page.locator('#statusText')).toContainText('Sendungsnummer');
    expect(tabelle.mails).toHaveLength(0);
    await expect(k.locator('.status')).toHaveText('Neu');
  });

  test('Markt-Verkauf von Hand anlegen: zwei Kronen, Preise aus der Preisliste, Status Übergeben', async ({ page }) => {
    const tabelle = await openAdmin(page, [], { seite: '#bestellungen', api: true });
    await page.click('#btnNeueBestellung');
    await page.selectOption('#bfKanal', 'Markt');
    await expect(page.locator('#bfStatus')).toHaveValue('Übergeben');
    await expect(page.locator('#bfZahlung')).toHaveValue('Bar');
    const pos = page.locator('.bf-pos');
    await pos.nth(0).locator('select').nth(0).selectOption('Glitzer');
    await pos.nth(0).locator('select').nth(1).selectOption('Gold');
    await pos.nth(0).locator('select').nth(2).selectOption('Klein');
    await pos.nth(0).locator('input[type=text]').fill('BELLA');
    await page.click('button:has-text("+ weitere Krone")');
    await pos.nth(1).locator('select').nth(0).selectOption('Zahlenkrone Leo');
    await pos.nth(1).locator('select').nth(2).selectOption('Mini');
    await pos.nth(1).locator('select').nth(3).selectOption('6');
    const p = (v, g) => katalog.produkte.find(x => x.name === v).merkmale.groesse.find(x => x.wert === g).preis;
    const auf6 = katalog.optionen.zahlenpets.werte.find(o => o.wert === 6).aufpreis;
    const summe = p('Glitzer', 'Klein') + p('Zahlenkrone Leo', 'Mini') + auf6;
    await expect(page.locator('#bfSumme')).toHaveText(summe.toFixed(2).replace('.', ',') + ' €');
    await page.fill('#bfNotiz', 'Weihnachtsmarkt');
    await page.click('#bfSpeichern');
    await expect(page.locator('#statusText')).toHaveText(/Bestellung KW-\d{8}-\d{3} gespeichert/);
    const z = tabelle.daten.at(-1), sp = n => tabelle.daten[0].indexOf(n);
    expect(z[sp('Kanal')]).toBe('Markt');
    expect(z[sp('Status')]).toBe('Übergeben');
    expect(z[sp('Variante')]).toBe('Glitzer, Zahlenkrone Leo');
    expect(z[sp('Grösse')]).toBe('Klein, Mini + 6 Pets');
    expect(z[sp('Personalisierung')]).toBe('BELLA | ohne Namen');
    expect(z[sp('Preis (€)')]).toBe(summe);
    await expect(page.locator('#bestFormular')).toBeEmpty();
    await expect(page.locator('#bestListe .best').first().locator('.best-kanal')).toHaveText('Markt');
  });

  test('Etsy-Bestellung ohne Kundenname wird nicht gespeichert', async ({ page }) => {
    const tabelle = await openAdmin(page, [], { seite: '#bestellungen', api: true });
    const vorher = tabelle.daten.length;
    await page.click('#btnNeueBestellung');
    await page.click('#bfSpeichern');
    await expect(page.locator('#statusText')).toContainText('Kundennamen');
    expect(tabelle.daten.length).toBe(vorher);
  });

  test('Übersicht: gruppiert nach Neu / In Arbeit, Name zum Nähen und Alter schon in der Liste', async ({ page }) => {
    await openAdmin(page, [], { seite: '#bestellungen', api: true });
    await expect(page.locator('.best-gruppe')).toHaveText([/Neu\s+2/]);
    const k = karte(page, 'KW-20261001-003');
    await expect(k.locator('.best-pos em')).toHaveText('„FRIDOLIN“');
    await expect(k.locator('.best-alter')).toHaveClass(/warn/);               // seit Oktober offen
    await expect(k.locator('.best-kanal')).toHaveText('Webshop');
    await k.locator('summary').first().click();
    await expect(k.locator('.schritte li')).toHaveText(['Bestellt', 'In Arbeit', 'Versendet']);
    await expect(k.locator('.schritte li.jetzt')).toHaveText('In Arbeit');
    await expect(k.locator('input[id^="sn-"]')).toHaveCount(0);               // Versand erst auf Wunsch
    await k.locator('button:has-text("In Arbeit nehmen")').click();
    await expect(page.locator('.best-gruppe')).toHaveText([/Neu\s+1/, /In Arbeit\s+1/]);
    await expect(k.locator('.schritte li.jetzt')).toHaveText('Versendet');
    await expect(k.locator('input[id^="sn-"]')).toBeVisible();                // jetzt ist Versenden dran
    await expect(k.locator('.best-mehr')).not.toHaveAttribute('open', '');     // Status von Hand ist versteckt
  });

  test('Adresse kopieren legt Name und Adresse zeilenweise in die Zwischenablage', async ({ page, context, browserName }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAdmin(page, [], { seite: '#bestellungen', api: true });
    const k = karte(page, 'KW-20261001-003');
    await k.locator('summary').first().click();
    await k.locator('.kopier-knopf').click();
    await expect(page.locator('#statusText')).toHaveText(/Adresse kopiert/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Kim Muster\nMoorblick 4\n24329 Dannau\nDE');
  });

  test('Startseite meldet neue Bestellungen unter „Zu tun“', async ({ page }) => {
    await openAdmin(page, [], { seite: '', api: true });
    const punkt = page.locator('.todo').filter({ hasText: '2 neue Bestellungen' });
    await expect(punkt).toBeVisible();
    await punkt.click();
    await expect(page).toHaveURL(/#bestellungen$/);
    await expect(page.locator('#bestFilterLeiste button.active')).toContainText('Offen');
  });
});

/* ---------------- Lager ---------------- */
const P0 = katalog.produkte[0];
const SKU = (p, f, g) => ['KR', p.kuerzel, p.merkmale.farbe.find(x => x.wert === f).kuerzel, katalog.merkmale.groesse.werte.find(x => x.wert === g).kuerzel].join('-');
const PARTY = katalog.produkte.find(p => p.name === 'Party');
const PARTY_ROSA_GR = SKU(PARTY, PARTY.merkmale.farbe[0].wert, 'Gross');
const partyPreis = PARTY.merkmale.groesse.find(g => g.wert === 'Gross').preis;
const lagerStand = t => t.post({ aktion: 'lager', schluessel: 'GEHEIM123' });
const zelle = (page, sku) => page.locator(`input[data-sku="${sku}"]`);

test.describe('Admin: Lager', () => {
  test('leeres Lager: Anleitung, alle Kisten, jedes Produkt mit Farben × Größen', async ({ page }) => {
    await openAdmin(page, [], { seite: '#lager', api: true });
    await expect(page.locator('#lagerInhalt')).toContainText('So funktioniert das Lager');
    await expect(page.locator('#lagerKisten button')).toHaveText([/^\s*Alle Kisten/, /^\s*Markt & Webshop/, /^\s*Etsy/, /^\s*Amazon/, /^\s*Werkstatt/]);
    await expect(page.locator('.lg-produkt')).toHaveCount(katalog.produkte.length);
    const karte = page.locator('.lg-produkt').first();
    await karte.locator('summary').click();
    await expect(karte.locator('tbody tr')).toHaveCount(P0.merkmale.farbe.length);
    await expect(karte.locator('thead th')).toHaveText(['Farbe', ...P0.merkmale.groesse.map(g => g.wert)]);
  });

  test('Zählen: nur Änderungen werden als Inventur gebucht, Bestand und Lagerwert stimmen', async ({ page }) => {
    const t = await openAdmin(page, [], { seite: '#lager', api: true });
    await page.click('.lg-modus [data-modus="zaehlen"]');
    // ohne gewählte Kiste wird nichts gezählt, sondern nach der Kiste gefragt
    await expect(page.locator('#kisteBanner')).toContainText('Welche Kiste?');
    await expect(page.locator('#lagerListe input')).toHaveCount(0);
    await page.click('#lagerKisten [data-kiste="Etsy"]');
    await expect(page.locator('#kisteBanner')).toHaveText(/Du arbeitest in der Kiste\s+Etsy/);
    await expect(page.locator('#lagerKisten .active')).toHaveAttribute('data-kiste', 'Etsy');
    await expect(page.locator('#lagerLeiste')).toContainText('Zählen in Etsy · noch nichts geändert');
    await zelle(page, PARTY_ROSA_GR).fill('3');
    await expect(page.locator('#lagerLeiste')).toContainText('Zählen in Etsy · 1 Änderung');
    await page.click('#lgSpeichern');
    await expect(page.locator('#statusText')).toHaveText(/Zählung gespeichert.*1 Korrektur/);
    expect(lagerStand(t).bestand).toEqual({ [PARTY_ROSA_GR]: { Etsy: 3 } });
    await page.click('.lg-modus [data-modus="bestand"]');
    await expect(page.locator('.lg-wert')).toContainText('3 Kronen');
    await expect(page.locator('.lg-wert')).toContainText((3 * partyPreis).toFixed(2).replace('.', ',') + ' €');
    await expect(page.locator('#lagerBewegungen li').first()).toContainText('Inventur · Etsy');
  });

  test('Mindestbestand → Nähliste: erst aus der Werkstatt nachfüllen, dann nähen', async ({ page }) => {
    const t = await openAdmin(page, [], { seite: '#lager', api: true,
      lager: [['01.11.2026', '10:00', PARTY_ROSA_GR, '', 'Werkstatt', 1, 'Genäht', '', '']] });
    await page.click('.lg-modus [data-modus="mindest"]');
    await page.click('#lagerKisten [data-kiste="Markt & Webshop"]');
    await expect(page.locator('#lagerKisten .active')).toHaveText(/Markt & Webshop/);
    await zelle(page, PARTY_ROSA_GR).fill('2');
    await page.click('#lgSpeichern');
    await expect(page.locator('#statusText')).toHaveText(/Mindestbestand gespeichert/);
    await page.click('.lg-modus [data-modus="bestand"]');
    const zeile = page.locator(`.naeh-zeile[data-sku="${PARTY_ROSA_GR}"][data-kiste="Markt & Webshop"]`);
    await expect(zeile).toContainText('0 da, 2 sollen · fehlt 2');
    await zeile.getByRole('button', { name: '1 aus Werkstatt' }).click();
    await expect(page.locator('#statusText')).toHaveText(/nach Markt & Webshop ✓/);
    await expect(zeile).toContainText('1 da, 2 sollen · fehlt 1');
    await expect(zeile.getByRole('button', { name: /aus Werkstatt/ })).toHaveCount(0);
    await zeile.getByRole('button', { name: '+1 genäht' }).click();
    await expect(page.locator('#naehliste')).toHaveCount(0);
    expect(lagerStand(t).bestand[PARTY_ROSA_GR]).toEqual({ Werkstatt: 0, 'Markt & Webshop': 2 });
  });

  test('Mindestbestand für alle Artikel einer Kiste auf einmal', async ({ page }) => {
    const t = await openAdmin(page, [], { seite: '#lager', api: true });
    await page.click('.lg-modus [data-modus="mindest"]');
    await page.click('#lagerKisten [data-kiste="Etsy"]');
    await page.click('.lg-alle button');
    const anzahl = katalog.produkte.reduce((n, p) => n + p.merkmale.farbe.length * p.merkmale.groesse.length, 0);
    await expect(page.locator('#lagerLeiste')).toContainText('Mindestbestand in Etsy · ' + anzahl + ' Änderungen');
    await page.click('#lgSpeichern');
    await expect(page.locator('#statusText')).toHaveText(/Mindestbestand gespeichert/);
    expect(Object.keys(lagerStand(t).mindest)).toHaveLength(anzahl);
  });

  test('+ Buchung: Umlagern bucht aus der einen Kiste ab und in die andere ein', async ({ page }) => {
    const t = await openAdmin(page, [], { seite: '#lager', api: true,
      lager: [['01.11.2026', '10:00', PARTY_ROSA_GR, '', 'Werkstatt', 4, 'Genäht', '', '']] });
    await page.click('#btnBuchung');
    await page.selectOption('#lbArt', 'Umlagerung');
    await page.selectOption('#lbKiste', 'Werkstatt');
    await page.selectOption('#lbNach', 'Etsy');
    const pos = page.locator('#lagerBuchung .bf-pos').first();
    await pos.locator('select').nth(0).selectOption('Party');
    await pos.locator('select').nth(1).selectOption(PARTY.merkmale.farbe[0].wert);
    await pos.locator('select').nth(2).selectOption('Gross');
    await expect(pos).toContainText('Werkstatt: 4 da');
    await pos.locator('input').fill('3');
    await pos.locator('input').blur();
    await page.click('#lbSpeichern');
    await expect(page.locator('#statusText')).toHaveText(/3 Kronen umgelagert/);
    await expect(page.locator('#lagerBuchung')).toBeEmpty();
    expect(lagerStand(t).bestand[PARTY_ROSA_GR]).toEqual({ Werkstatt: 1, Etsy: 3 });
  });

  test('Etsy-Verkauf von Hand bucht aus der Etsy-Kiste ab; fehlt die Krone, steht sie auf der Nähliste', async ({ page }) => {
    const t = await openAdmin(page, [], { seite: '#bestellungen', api: true });
    await page.click('#btnNeueBestellung');
    await expect(page.locator('#bfKiste')).toHaveValue('Etsy');
    await page.selectOption('#bfKanal', 'Markt');
    await expect(page.locator('#bfKiste')).toHaveValue('Markt & Webshop');
    await page.selectOption('#bfKanal', 'Etsy');
    await page.fill('#bfKunde', 'Etsy Kundin');
    await page.click('#bfSpeichern');
    await expect(page.locator('#statusText')).toHaveText(/Bestellung KW-\d{8}-\d{3} gespeichert/);
    const sku = SKU(P0, P0.merkmale.farbe[0].wert, P0.merkmale.groesse[0].wert);
    expect(lagerStand(t).bestand).toEqual({ [sku]: { Etsy: -1 } });
    await expect(page.locator('.best[open] .best-details')).toContainText('Lager: aus Kiste Etsy');
    await page.click('.nav-item[data-nav="lager"]');
    await expect(page.locator(`.naeh-zeile[data-sku="${sku}"]`)).toContainText('1 verkauft, nicht auf Lager');
    await page.click('.nav-item[data-nav="start"]');
    await expect(page.locator('#startTodo')).toContainText('Nähliste: 1 Krone nähen');
    await expect(page.locator('#startZahlen')).toContainText('auf Lager');
  });

  test('„nicht vom Lager“ bucht nichts ab', async ({ page }) => {
    const t = await openAdmin(page, [], { seite: '#bestellungen', api: true });
    await page.click('#btnNeueBestellung');
    await page.selectOption('#bfKiste', '');
    await page.fill('#bfKunde', 'Auftrag');
    await page.click('#bfSpeichern');
    await expect(page.locator('#statusText')).toHaveText(/gespeichert/);
    expect(lagerStand(t).bewegungen).toEqual([]);
  });

  test('am Handy passt die Lagertabelle ohne seitliches Scrollen', async ({ page }) => {
    await openAdmin(page, [], { seite: '#lager', api: true });
    await page.click('.lg-modus [data-modus="zaehlen"]');
    await page.click('#lagerKisten [data-kiste="Amazon"]');
    await expect(page.locator('.lg-produkt[open]').first()).toBeVisible();
    const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(breit).toBeLessThanOrEqual(0);
    const rahmen = await page.locator('.lg-tabelle-rahmen').evaluateAll(l => l.map(r => r.scrollWidth - r.clientWidth));
    expect(Math.max(...rahmen)).toBeLessThanOrEqual(1);
  });
});

test.describe('Admin: Lager – Kisten', () => {
  test('Kiste wechseln mit ungespeicherten Eingaben fragt nach; „Alle Kisten“ führt zurück zum Bestand', async ({ page }) => {
    await openAdmin(page, [], { seite: '#lager', api: true });
    await page.click('#lagerKisten [data-kiste="Werkstatt"]');
    await page.click('.lg-modus [data-modus="zaehlen"]');
    await zelle(page, PARTY_ROSA_GR).fill('2');
    page.once('dialog', d => { expect(d.message()).toContain('Werkstatt'); d.dismiss(); });
    await page.click('#lagerKisten [data-kiste="Etsy"]');
    await expect(page.locator('#kisteBanner')).toContainText('Werkstatt');           // bleibt in der Werkstatt
    page.once('dialog', d => d.accept());
    await page.click('#lagerKisten .kiste-kachel.alle');
    await expect(page.locator('#kisteBanner')).toContainText('Alle Kisten');
    await expect(page.locator('.lg-modus .active')).toHaveText('Bestand');
    await expect(page.locator('#lagerLeiste')).toBeEmpty();
  });

  test('der Kisten-Balken bleibt beim Scrollen im Zählmodus sichtbar', async ({ page }) => {
    await openAdmin(page, [], { seite: '#lager', api: true });
    await page.click('#lagerKisten [data-kiste="Etsy"]');
    await page.click('.lg-modus [data-modus="zaehlen"]');
    await page.locator('.lg-produkt').last().scrollIntoViewIfNeeded();
    await expect(page.locator('#kisteBanner')).toBeInViewport();
    await expect(page.locator('.lg-leiste')).toBeInViewport();
    const nav = await page.locator('#hauptNav').boundingBox(), leiste = await page.locator('.lg-leiste').boundingBox();
    if (nav.y > 100) expect(leiste.y + leiste.height).toBeLessThanOrEqual(nav.y + 1);   // Handy: nicht hinter der Navigation
  });
});
