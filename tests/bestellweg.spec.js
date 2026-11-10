// Der ganze Weg einer Webshop-Bestellung: Warenkorb → PayPal → Google-Tabelle → Lager.
// PayPal und EmailJS sind nachgestellt; die Tabelle ist der echte Code aus apps-script/Code.gs.
const { test, expect } = require('@playwright/test');
const { openShop, katalog } = require('./helpers');
const { umgebung, paypalZahlung } = require('./schnittstelle-attrappe');

const sku = (name, farbe, groesse) => {
  const p = katalog.produkte.find(x => x.name === name);
  return ['KR', p.kuerzel, p.merkmale.farbe.find(f => f.wert === farbe).kuerzel, katalog.merkmale.groesse.werte.find(g => g.wert === groesse).kuerzel].join('-');
};

async function bezahlen(page) {
  // PayPal-Knopf und Mailversand nachstellen, Bestellung an die Tabelle mitschneiden
  const gesendet = [];
  await page.route(/script\.google\.com/, async route => { gesendet.push(JSON.parse(route.request().postData())); await route.fulfill({ body: '{}' }); });
  await page.evaluate(() => {
    CONFIG.PAYPAL_ID = 'TEST-CLIENT-ID-123';
    window.emailjs = { send: () => Promise.resolve() };
    window.paypal = { Buttons: cfg => ({ render: () => { window.__paypal = cfg; return Promise.resolve(); } }) };
  });
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
