// Der ganze Weg einer Webshop-Bestellung: Warenkorb → PayPal → Google-Tabelle → Lager.
// PayPal und EmailJS sind nachgestellt; die Tabelle ist der echte Code aus apps-script/Code.gs.
const { test, expect } = require('@playwright/test');
const { openShop, katalog } = require('./helpers');
const { umgebung, paypalZahlung } = require('./schnittstelle-attrappe');

const sku = (name, farbe, groesse) => {
  const p = katalog.produkte.find(x => x.name === name);
  return ['KR', p.kuerzel, p.merkmale.farbe.find(f => f.wert === farbe).kuerzel, katalog.merkmale.groesse.werte.find(g => g.wert === groesse).kuerzel].join('-');
};

// tabelle = nachgestellte Google-Tabelle (echter Code) oder 'fehler' (nicht erreichbar) oder 'alt' (alte Version ohne Bestätigung)
async function bezahlen(page, { tabelle = null } = {}) {
  // PayPal-Knopf und EmailJS nachstellen, Bestellung an die Tabelle mitschneiden
  const gesendet = [];
  await page.route(/script\.google\.com/, async route => {
    const body = JSON.parse(route.request().postData());
    gesendet.push(body);
    if (tabelle === 'fehler') return route.abort();
    const antwort = tabelle === 'alt' ? { success: true, bestellnr: 'KW-ALT-001' } : tabelle ? tabelle.post(body) : {};
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(antwort) });
  });
  await page.evaluate(() => {
    CONFIG.PAYPAL_ID = 'TEST-CLIENT-ID-123';
    window.__emailjs = [];
    window.emailjs = { send: (dienst, vorlage, daten) => { window.__emailjs.push(vorlage); return Promise.resolve(); } };
    window.paypal = { Buttons: cfg => ({ render: () => { window.__paypal = cfg; return Promise.resolve(); } }) };
  });
  page.on('dialog', d => { throw new Error('Kein Browser-Dialog erwartet: ' + d.message()); });
  await page.click('#cartCheckoutBtn');
  await expect(page.locator('#paypalModal')).toBeVisible();
  await page.evaluate(() => window.__paypal.onApprove({}, { order: { capture: () => Promise.resolve({
    id: '8RU61172JS455403V', status: 'COMPLETED',
    payer: { name: { given_name: 'Kim', surname: 'Muster' }, email_address: 'k@example.de' },
    purchase_units: [{ shipping: { address: { address_line_1: 'Moorblick 4', postal_code: '24329', admin_area_2: 'Dannau', country_code: 'DE' } } }]
  }) } }));
  await expect.poll(() => gesendet.length).toBe(1);
  return gesendet[0];
}

async function eineKrone(page) {
  await openShop(page);
  await page.fill('#nIn', 'MILA');
  await page.click('.btn-add-cart');
}

test.describe('Nach der Zahlung', () => {
  test('Danke-Fenster mit Name, Mailadresse und Bestellnummer, Warenkorb leer, kein Browser-Dialog', async ({ page }) => {
    await eineKrone(page);
    const t = umgebung([], 'GEHEIM123');
    await bezahlen(page, { tabelle: t });
    const f = page.locator('#dankeFenster');
    await expect(f).toBeVisible();
    await expect(f.locator('#dankeTitel')).toHaveText('Danke für deine Bestellung, Kim!');
    await expect(f.locator('.danke-ok')).toHaveText('Bestellung abgeschlossen');
    await expect(f.locator('.logo-name')).toHaveText("Mila's Kronenwelt");          // Logo der Website
    await expect(f.locator('#dankeText')).toContainText('k@example.de');
    await expect(f.locator('.danke-pos')).toHaveCount(1);
    await expect(f.locator('.danke-pos em')).toHaveText('MILA');
    await expect(f.locator('#dankeSchritt1')).toHaveText('Sara fertigt deine Krone jetzt von Hand, mit „MILA“.');
    await expect(f.locator('#dankeSchritt3')).toHaveText(/^Voraussichtlich bei dir zwischen \w\w, \d\d\.\d\d\. und \w\w, \d\d\.\d\d\.$/);
    await expect(f.locator('#dankeHinweis')).toContainText('Fehler eingeschlichen');
    await expect(f.locator('#dankeSumme')).toContainText('€');
    await expect(f.locator('#dankeNrWert')).toHaveText(/^KW-\d{8}-\d{3}$/);
    await expect(f.locator('#dankeWa')).toHaveAttribute('href', /^https:\/\/wa\.me\/4917631242035/);
    await expect(f.locator('#dankeEmail')).toHaveAttribute('href', /subject=Bestellung%20KW-/);
    expect(await page.evaluate(() => cart.length)).toBe(0);
    await expect(page.locator('#cartPanel')).not.toBeInViewport();             // Warenkorb ist zu und leer
    await expect(page.locator('#dankeFenster .danke-box')).toBeInViewport({ ratio: 0.9 });
    await expect(f.locator('#dankeWa')).toHaveAttribute('href', /zu%20meiner%20Bestellung%20KW-/);
    await f.getByRole('button', { name: 'Zurück zum Shop' }).click();
    await expect(f).toBeHidden();
  });

  test('Tabelle schickt die Bestätigung: EmailJS nur noch an Sara', async ({ page }) => {
    await eineKrone(page);
    const t = umgebung([], 'GEHEIM123');
    const body = await bezahlen(page, { tabelle: t });
    expect(body.bestaetigung_per_schnittstelle).toBe(true);
    await expect(page.locator('#dankeNrWert')).toHaveText(/^KW-/);
    expect(t.mails).toHaveLength(1);
    expect(t.mails[0].to).toBe('k@example.de');
    expect(await page.evaluate(() => window.__emailjs)).toEqual(['template_wihnwzo']);
  });

  test('alte Apps-Script-Version: Kunde bekommt die Bestätigung wie früher über EmailJS', async ({ page }) => {
    await eineKrone(page);
    await bezahlen(page, { tabelle: 'alt' });
    await expect.poll(() => page.evaluate(() => window.__emailjs)).toEqual(['template_wihnwzo', 'template_kodm23r']);
    await expect(page.locator('#dankeNrWert')).toHaveText('KW-ALT-001');
  });

  test('Tabelle nicht erreichbar: Bestätigung über EmailJS, Bestellung wird nicht doppelt geschickt', async ({ page }) => {
    await eineKrone(page);
    await bezahlen(page, { tabelle: 'fehler' });
    await expect.poll(() => page.evaluate(() => window.__emailjs)).toEqual(['template_wihnwzo', 'template_kodm23r']);
    await expect(page.locator('#dankeFenster')).toBeVisible();
    await expect(page.locator('#dankeNr')).toBeHidden();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__emailjs.length)).toBe(2);
  });
});

test('Webshop-Bestellung schickt die Artikelnummern mit, die Tabelle bucht das Lager ab', async ({ page }) => {
  await openShop(page);
  // Krone 1: voreingestellte Krone mit Name
  await page.fill('#nIn', 'MILA');
  const erste = await page.evaluate(() => ({ v: document.querySelector('[data-v].on')?.dataset.v, c: document.querySelector('[data-c].on')?.dataset.c }));
  await page.click('.btn-add-cart');
  await page.click('#cartPanel .cart-close, #cartPanel [onclick*="closeCart"]');
  // Krone 2: andere Krone
  await page.click('[data-v="Glitzer"]');
  await page.click('#colorChips [data-c]');
  await page.click('.btn-add-cart');
  const korb = await page.evaluate(() => cart.map(i => [i.variant, i.color, i.size]));
  expect(korb).toHaveLength(2);

  const body = await bezahlen(page);
  const erwartet = korb.map(([v, c, g]) => sku(v, c, g.replace(/\s*\+.*$/, '')));
  expect(body.artikel).toBe(erwartet.join(', '));
  expect(body.variante).toBe(korb.map(k => k[0]).join(', '));

  expect(body.paypal_id).toBe('8RU61172JS455403V');

  // Was der Shop geschickt hat, geht durch die echte Schnittstelle; PayPal bestätigt den Betrag aus dem Warenkorb
  const bezahlt = parseFloat(body.preis.replace(',', '.'));
  const t = umgebung([], 'GEHEIM123', { paypal: { orders: { '8RU61172JS455403V': paypalZahlung(bezahlt) } } });
  const r = t.post(body);
  expect(r.success).toBe(true);
  expect(t.post({ aktion: 'bestellungen', schluessel: 'GEHEIM123' }).bestellungen[0].zahlungGeprueft).toBe(
    'OK: ' + bezahlt.toFixed(2).replace('.', ',') + ' € bei PayPal bezahlt');        // Shop-Preise = Katalog-Preise
  const l = t.post({ aktion: 'lager', schluessel: 'GEHEIM123' });
  for (const s of erwartet) expect(l.bestand[s]['Markt & Webshop']).toBe(-1);
  expect(l.bewegungen.every(b => b.grund === 'Verkauf' && b.nr === r.bestellnr)).toBe(true);
  expect(erste.v).toBeTruthy();
});

test('Zahlenkrone mit 6 Pets: Artikelnummer ohne Pets, Lager bucht die Krone ab', async ({ page }) => {
  await openShop(page);
  const zahl = katalog.produkte.find(p => (p.optionen || []).includes('zahlenpets'));
  await page.click('.mode-tab[data-mode="zahl"]');
  await page.click(`.chip[data-v="${zahl.name}"]`);
  await page.click('#petCount [data-p="6"]');
  for (const z of ['1', '2', '3', '4', '5', '6']) await page.click(`#petPad .pet-key >> text="${z}"`);
  await page.click('.btn-add-cart');
  await expect(page.locator('.cart-item-meta').first()).toContainText('+ 6 Pets');
  const [[v, c, g]] = await page.evaluate(() => cart.map(i => [i.variant, i.color, i.size]));
  const body = await bezahlen(page);
  expect(body.artikel).toBe(sku(v, c, g.replace(/\s*\+.*$/, '')));
  const t = umgebung([], 'GEHEIM123', { paypal: { orders: { '8RU61172JS455403V': paypalZahlung(parseFloat(body.preis.replace(',', '.'))) } } });
  t.post(body);
  expect(t.post({ aktion: 'lager', schluessel: 'GEHEIM123' }).bestand[body.artikel]).toEqual({ 'Markt & Webshop': -1 });
  expect(t.post({ aktion: 'bestellungen', schluessel: 'GEHEIM123' }).bestellungen[0].zahlungGeprueft).toMatch(/^OK/);  // Pets-Aufpreis stimmt
});

test('Liefertermin im Danke-Fenster zählt nur Werktage', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-10T18:00:00'));   // Dienstag
  await openShop(page);
  const t = await page.evaluate(() => [tagKurz(inWerktagen(5)), tagKurz(inWerktagen(6))]);
  expect(t).toEqual(['Di, 17.11.', 'Mi, 18.11.']);
  const fr = await page.evaluate(() => tagKurz(inWerktagen(1, new Date('2026-11-13T12:00:00'))));   // Freitag + 1 Werktag
  expect(fr).toBe('Mo, 16.11.');
});
