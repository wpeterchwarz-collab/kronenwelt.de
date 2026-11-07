// Tests für den Konfigurator, die Preise und den Warenkorb von kronenwelt.de
const { test, expect } = require('@playwright/test');
const { openShop, blockExternal, preise, euro } = require('./helpers');

const NAMENSKRONEN = ['Party', 'Einfarbig', 'Glitzer', 'Edel & Wild'];
const ZAHLENKRONEN = ['Zahlenkrone Klassik', 'Zahlenkrone Leo', 'Zahlenkrone Glitzer', 'Zahlenkrone Konfetti'];
const AUFPREIS = preise['Zahlenpets Aufpreis'];

test.describe('Seite', () => {
  test('lädt ohne JavaScript-Fehler', async ({ page }) => {
    const errors = [];
    await openShop(page, { errors });
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  for (const seite of ['index.html', 'agb.html', 'datenschutz.html', 'impressum.html', 'widerruf.html']) {
    test(`${seite}: kein seitliches Scrollen`, async ({ page }) => {
      await blockExternal(page);
      await page.goto('/' + seite);
      const breite = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(breite).toBeLessThanOrEqual(0);
    });

    test(`${seite}: hat ein Kronen-Favicon`, async ({ page, request }) => {
      await blockExternal(page);
      await page.goto('/' + seite);
      for (const href of ['favicon.ico', 'favicon-32.png', 'favicon-192.png', 'apple-touch-icon.png']) {
        await expect(page.locator(`link[href="${href}"]`)).toHaveCount(1);
        expect((await request.get('/' + href)).ok()).toBeTruthy();
      }
    });
  }

  test('alle Links zu Rechtstexten funktionieren', async ({ page, request }) => {
    await blockExternal(page);
    await page.goto('/index.html');
    for (const href of ['impressum.html', 'datenschutz.html', 'agb.html', 'widerruf.html']) {
      await expect(page.locator(`footer a[href="${href}"]`)).toHaveCount(1);
      expect((await request.get('/' + href)).ok()).toBeTruthy();
    }
  });

  test('"ab"-Preise auf den Produktkarten passen zur Preisliste', async ({ page }) => {
    await openShop(page);
    for (const v of [...NAMENSKRONEN, ...ZAHLENKRONEN]) {
      const min = Math.min(...Object.values(preise[v]));
      await expect(page.locator(`.prod-card[data-variant="${v}"] .prod-price`)).toHaveText('ab ' + euro(min));
    }
  });
});

test.describe('Namenskronen', () => {
  for (const v of NAMENSKRONEN) {
    test(`${v}: Preis je Grösse stimmt`, async ({ page }) => {
      await openShop(page);
      await page.click(`.chip[data-v="${v}"]`);
      for (const [groesse, preis] of Object.entries(preise[v])) {
        await page.click(`.szcard[data-s="${groesse}"]`);
        await expect(page.locator('#totP')).toHaveText(euro(preis));
      }
    });
  }

  test('ohne Namen kein Warenkorb, mit Namen schon', async ({ page }) => {
    await openShop(page);
    let meldung = '';
    page.on('dialog', d => { meldung = d.message(); d.dismiss(); });
    await page.click('.btn-add-cart');
    expect(meldung).toContain('Personalisierung');
    await page.fill('#nIn', 'mila');
    await expect(page.locator('#nIn')).toHaveValue('MILA');
    await page.click('.btn-add-cart');
    await expect(page.locator('#cartPanel')).toHaveClass(/open/);
    await expect(page.locator('.cart-item')).toHaveCount(1);
    await expect(page.locator('.cart-item-personalisierung')).toHaveText('MILA');
  });

  test('Farbmuster: Schwarz ist schwarz, Leo hat Flecken', async ({ page }) => {
    await openShop(page);
    await page.click('.chip[data-v="Edel & Wild"]');
    const bg = sel => page.locator(`#colorChips [data-c="${sel}"] .swatch`).evaluate(e => getComputedStyle(e).backgroundImage + '|' + getComputedStyle(e).backgroundColor);
    expect(await bg('Schwarz')).toContain('rgb(34, 32, 44)');
    for (const leo of ['Leo Braun', 'Leo Weiss', 'Leopard']) expect(await bg(leo)).toContain('radial-gradient');
  });

  test('Einfarbig: genau die angebotenen Farben (kein Mint, kein Petrol)', async ({ page }) => {
    await openShop(page);
    await page.click('.chip[data-v="Einfarbig"]');
    const farben = await page.$$eval('#colorChips [data-c]', e => e.map(x => x.dataset.c));
    expect(farben).toEqual(['Berry', 'Blau', 'Grün', 'Orange']);
  });

  test('Leo-Muster ohne Namensaufdruck', async ({ page }) => {
    await openShop(page);
    await page.click('.chip[data-v="Edel & Wild"]');
    await page.click('#colorChips [data-c="Leo Braun"]');
    await expect(page.locator('#nIn')).toBeDisabled();
    await page.click('.btn-add-cart');
    await expect(page.locator('.cart-item')).toHaveCount(1);
  });
});

test.describe('Zahlenkronen', () => {
  test('Umschalter zeigt nur die passenden Varianten', async ({ page }) => {
    await openShop(page);
    await page.click('.mode-tab[data-mode="zahl"]');
    await expect(page.locator('.mode-tab[data-mode="zahl"]')).toHaveAttribute('aria-checked', 'true');
    for (const v of ZAHLENKRONEN) await expect(page.locator(`.chip[data-v="${v}"]`)).toBeVisible();
    for (const v of NAMENSKRONEN) await expect(page.locator(`.chip[data-v="${v}"]`)).toBeHidden();
    await expect(page.locator('#nIn')).toBeHidden();
    await page.click('.mode-tab[data-mode="name"]');
    await expect(page.locator('#nIn')).toBeVisible();
  });

  for (const v of ZAHLENKRONEN) {
    test(`${v}: Preis je Grösse und Anzahl Pets stimmt`, async ({ page }) => {
      await openShop(page);
      await page.click('.mode-tab[data-mode="zahl"]');
      await page.click(`.chip[data-v="${v}"]`);
      const groessen = Object.keys(preise[v]);
      // Nicht angebotene Grössen sind ausgeblendet
      for (const g of ['Gross', 'Klein', 'Mini', 'Extra Mini']) {
        const karte = page.locator(`.szcard[data-s="${g}"]`);
        groessen.includes(g) ? await expect(karte).toBeVisible() : await expect(karte).toBeHidden();
      }
      for (const g of groessen) {
        await page.click(`.szcard[data-s="${g}"]`);
        for (const pets of [3, 6, 9]) {
          await page.click(`#petCount [data-p="${pets}"]`);
          const erwartet = preise[v][g] + (pets === 3 ? 0 : AUFPREIS[pets + ' Pets']);
          await expect(page.locator('#totP')).toHaveText(euro(erwartet));
        }
      }
    });

    test(`${v}: jede Farboption hat ein eigenes Foto`, async ({ page }) => {
      await openShop(page);
      await page.click('.mode-tab[data-mode="zahl"]');
      await page.click(`.chip[data-v="${v}"]`);
      const fotos = await page.evaluate(variant =>
        VARIANTEN[variant].farben.map(f => PRODUCT_IMAGES[variant][f.label]), v);
      expect(fotos.every(Boolean)).toBeTruthy();
      expect(new Set(fotos).size).toBe(fotos.length);
    });
  }

  test('Überschrift und Farben in Schritt 2 je Zahlenkrone', async ({ page }) => {
    await openShop(page);
    await page.click('.mode-tab[data-mode="zahl"]');
    const erwartet = {
      'Zahlenkrone Klassik':  ['Hauptfarbe wählen', ['Rosa', 'Mint', 'Weiss/bunte Punkte']],
      'Zahlenkrone Leo':      ['Farbe der Zahlenpets wählen', ['Gold / Zahlen schwarz', 'Schwarz / Zahlen gold']],
      'Zahlenkrone Glitzer':  ['Schriftfarbe wählen', ['Zahlen schwarz', 'Zahlen weiss']],
      'Zahlenkrone Konfetti': ['Farbe der Zahlenpads wählen', ['Zahlenpads Mint', 'Zahlenpads Rosa']],
    };
    for (const [v, [titel, farben]] of Object.entries(erwartet)) {
      await page.click(`.chip[data-v="${v}"]`);
      await expect(page.locator('#cLbl')).toHaveText(titel);
      expect(await page.$$eval('#colorChips [data-c]', e => e.map(x => x.dataset.c))).toEqual(farben);
    }
    await page.click('.mode-tab[data-mode="name"]');
    await expect(page.locator('#cLbl')).toHaveText('Stil & Farbe wählen');
  });

  test('Zahlen wählen, entfernen und in den Warenkorb legen', async ({ page }) => {
    await openShop(page);
    let meldung = '';
    page.on('dialog', d => { meldung = d.message(); d.dismiss(); });
    await page.click('.mode-tab[data-mode="zahl"]');
    await page.click('.chip[data-v="Zahlenkrone Leo"]');
    await page.click('.btn-add-cart');
    expect(meldung).toContain('3 Zahl');                       // ohne Zahlen geht nichts

    await page.click('#petPad .pet-key >> text="1"');
    await page.click('#petPad .pet-key >> text="1"');          // doppelte Zahl erlaubt
    await page.fill('#petOther', '25');
    await page.press('#petOther', 'Enter');
    await expect(page.locator('#petStatus')).toContainText('Alle 3');
    await expect(page.locator('#petPad .pet-key').first()).toBeDisabled();

    await page.click('.pet-slot:not(.empty) >> nth=1');       // mittleres Pet leeren
    await expect(page.locator('.pet-slot:not(.empty)')).toHaveCount(2);
    await page.click('#petPad .pet-key >> text="7"');

    await page.click('.btn-add-cart');
    await expect(page.locator('.cart-item')).toHaveCount(1);
    await expect(page.locator('.cart-item-personalisierung')).toHaveText('Zahlen 1, 25, 7');
    await expect(page.locator('.cart-item-meta').first()).toContainText('+ 3 Pets');
  });

  test('gewählte Zahlen haben die Padfarbe der gewählten Option', async ({ page }) => {
    await openShop(page);
    await page.click('.mode-tab[data-mode="zahl"]');
    await page.click('.chip[data-v="Zahlenkrone Leo"]');
    await page.click('#petPad .pet-key >> text="5"');
    await page.click('#colorChips [data-c="Schwarz / Zahlen gold"]');
    const farbe = await page.locator('.pet-slot:not(.empty)').evaluate(e => getComputedStyle(e).backgroundColor);
    expect(farbe).toBe('rgb(34, 32, 44)');                     // schwarzes Pad
  });

  test('Ziernaht nur bei Klassik', async ({ page }) => {
    await openShop(page);
    await page.click('.mode-tab[data-mode="zahl"]');
    await page.click('#petPad .pet-key >> text="1"');
    await page.click('.chip[data-v="Zahlenkrone Klassik"]');
    await expect(page.locator('.pet-slot:not(.empty)')).toHaveClass(/naht/);
    await page.click('.chip[data-v="Zahlenkrone Konfetti"]');
    await expect(page.locator('.pet-slot:not(.empty)')).not.toHaveClass(/naht/);
  });
});

test.describe('Warenkorb-Sicherheit', () => {
  test('manipulierter Preis im Browser wird korrigiert', async ({ page }) => {
    await openShop(page);
    await page.evaluate(() => sessionStorage.setItem('mkw_cart',
      JSON.stringify([{ variant: 'Glitzer', color: 'Gold', size: 'Gross', name: 'MILA', price: 0.01 }])));
    await page.reload();
    await page.evaluate(() => openCart());
    await expect(page.locator('#cartTotal')).toHaveText(euro(preise['Glitzer']['Gross']));
  });

  test('unbekannte Artikel werden aus dem Warenkorb entfernt', async ({ page }) => {
    await openShop(page);
    await page.evaluate(() => sessionStorage.setItem('mkw_cart',
      JSON.stringify([{ variant: 'Gibt es nicht', color: 'x', size: 'Gross', price: 1 },
                      { variant: 'Zahlenkrone Leo', color: 'x', size: 'Gross + 4 Pets', zahlen: '1', price: 1 }])));
    await page.reload();
    await page.evaluate(() => openCart());
    await expect(page.locator('.cart-item')).toHaveCount(0);
  });

  test('eingeschleuster HTML-Code wird nicht ausgeführt', async ({ page }) => {
    await openShop(page);
    await page.evaluate(() => sessionStorage.setItem('mkw_cart',
      JSON.stringify([{ variant: 'Party', color: '<img src=x onerror="window.__xss=1">', size: 'Gross', name: 'X', price: 15 }])));
    await page.reload();
    await page.evaluate(() => openCart());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => !!window.__xss)).toBe(false);
    await expect(page.locator('.cart-item-meta').first()).toContainText('<img');
  });
});

test.describe('Rechtliches', () => {
  test('Cookie-Hinweis beim ersten Besuch, danach nicht mehr – ohne PayPal-Schalter', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/index.html');
    await expect(page.locator('#ckBanner')).toHaveClass(/show/);
    await expect(page.locator('#ckBanner input[type="checkbox"]')).toHaveCount(0);
    await page.click('#ckViewMain .ck-btn-primary');
    await expect(page.locator('#ckBanner')).not.toHaveClass(/show/);
    await page.reload();
    await expect(page.locator('#ckFab')).toHaveClass(/show/);
    await expect(page.locator('#ckBanner')).not.toHaveClass(/show/);
  });

  test('Kasse öffnet direkt mit Pflichtangaben und Bestell-Hinweis', async ({ page }) => {
    await openShop(page);
    await page.fill('#nIn', 'MILA');
    await page.click('.btn-add-cart');
    await expect(page.locator('#cartPanel')).toHaveClass(/open/);
    await page.click('#cartCheckoutBtn');
    await expect(page.locator('#paypalModal')).toBeVisible();
    await expect(page.locator('#ckBanner')).not.toHaveClass(/show/);       // keine Extra-Abfrage
    const legal = page.locator('#ppLegal');
    await expect(legal).toContainText('zahlungspflichtig');
    await expect(legal).toContainText('Lieferzeit');
    await expect(legal).toContainText('Widerrufsrecht ausgeschlossen');     // personalisierte Krone
    await expect(legal.locator('a[href="agb.html"]')).toHaveCount(1);
    await expect(legal.locator('a[href="widerruf.html"]')).toHaveCount(1);
  });

  test('Zahlenkrone: kein Hinweis auf Widerrufsausschluss', async ({ page }) => {
    await openShop(page);
    await page.click('.mode-tab[data-mode="zahl"]');
    for (const n of ['1', '2', '3']) await page.click(`#petPad .pet-key >> text="${n}"`);
    await page.click('.btn-add-cart');
    await page.click('#cartCheckoutBtn');
    await expect(page.locator('#ppLegal')).not.toContainText('ausgeschlossen');
  });

  test('Hersteller und Sicherheitshinweise beim Angebot', async ({ page }) => {
    await openShop(page);
    await page.click('.safety-info summary');
    await expect(page.locator('.safety-info')).toContainText('Sternenstaubhandmade');
    await expect(page.locator('.safety-info')).toContainText('verschluckt');
  });

  test('Impressum enthält Pflichtangaben', async ({ page }) => {
    await blockExternal(page);
    await page.goto('/impressum.html');
    for (const t of ['Sara Schwarz', 'Vogesenweg 8', '75045 Walzbachtal', 'm.kronenwelt@gmail.com', '+49 176', '§ 19 UStG'])
      await expect(page.locator('.content-wrap')).toContainText(t);
  });
});

test.describe('Preisliste', () => {
  test('Katalog: jede Krone hat vollständige Preise', async () => {
    for (const v of [...NAMENSKRONEN, ...ZAHLENKRONEN]) {
      expect(preise[v], v).toBeTruthy();
      for (const p of Object.values(preise[v])) expect(p).toBeGreaterThan(0);
    }
    expect(AUFPREIS['6 Pets']).toBeGreaterThanOrEqual(0);
    expect(AUFPREIS['9 Pets']).toBeGreaterThanOrEqual(AUFPREIS['6 Pets']);
  });
});
