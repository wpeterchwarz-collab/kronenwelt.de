// Kronenwelt-Schnittstelle (apps-script/Code.gs): läuft in Google Apps Script.
// Hier wird sie mit nachgestellter Tabelle und nachgestellten Google-Diensten geprüft.
const { test, expect } = require('@playwright/test');
const { umgebung, KOPF, paypalZahlung } = require('./schnittstelle-attrappe');

const S = 'GEHEIM123';
const BESTELLUNG = ['08.04.2026', '21:49', 'KW-20260408-000', 'Party', 'Rosa mit Punkten', 'Gross', 'TEST', 0.01, 'PayPal',
  'Peter Schwarz', 'p@example.de', 'Weg 8, 75045 Walzbachtal, DE'];
const SUMMENZEILE = ['', '', '', '', '', '', '', 0.01, '', '', '', ''];
const ZWEI_KRONEN = ['01.10.2026', '12:12', 'KW-20261001-003', 'Einfarbig, Glitzer', 'Grün, Blau', 'Extra Mini, Gross',
  'FRIDOLIN | ohne Namen', 29, 'PayPal', 'Kim Muster', 'k@example.de', 'Moorblick 4, 24329 Dannau, DE'];
const spalte = (daten, name) => daten[0].indexOf(name);

test.describe('Schnittstelle: Zugang', () => {
  test('ohne oder mit falschem Schlüssel gibt es keine Daten', async () => {
    const { post } = umgebung([BESTELLUNG]);
    for (const schluessel of [undefined, 'FALSCH', 'GEHEIM12']) {
      expect(post({ aktion: 'bestellungen', schluessel })).toEqual({ ok: false, fehler: 'nicht_erlaubt' });
      expect(post({ aktion: 'status', schluessel, nr: 'KW-20260408-000', status: 'Storniert' }).ok).toBe(false);
    }
  });

  test('ohne eingerichteten Schlüssel ist alles gesperrt', async () => {
    const { post } = umgebung([BESTELLUNG], null);
    expect(post({ aktion: 'ping', schluessel: '' }).ok).toBe(false);
    expect(post({ aktion: 'ping', schluessel: 'null' }).ok).toBe(false);
  });

  test('ping meldet Version und Tabelle, unbekannte Aktion wird abgelehnt', async () => {
    const { post } = umgebung([]);
    expect(post({ aktion: 'ping', schluessel: S })).toMatchObject({ ok: true, version: '1.7', tabelle: 'Kronenwelt Bestellungen' });
    expect(post({ aktion: 'loeschen', schluessel: S })).toEqual({ ok: false, fehler: 'unbekannte_aktion' });
  });
});

test.describe('Schnittstelle: Lesen', () => {
  test('neueste zuerst, Summenzeile übersprungen, alte Zeilen ohne Status gelten als Neu/Webshop', async () => {
    const { post } = umgebung([BESTELLUNG, SUMMENZEILE, ZWEI_KRONEN]);
    const r = post({ aktion: 'bestellungen', schluessel: S });
    expect(r.bestellungen.map(b => b.nr)).toEqual(['KW-20261001-003', 'KW-20260408-000']);
    expect(r.bestellungen[0]).toMatchObject({ zeile: 4, kunde: 'Kim Muster', preis: 29, status: 'Neu', kanal: 'Webshop', sendungsnummer: '' });
    expect(r.bestellungen[1].preis).toBe(0.01);
  });
});

test.describe('Schnittstelle: Shop-Bestellung', () => {
  test('wird gespeichert wie bisher, dazu Status Neu und Kanal Webshop in neuen Spalten rechts', async () => {
    const { post, daten } = umgebung([BESTELLUNG]);
    const r = post({ variante: 'Glitzer', farbe: 'Blau', groesse: 'Gross', hundename: 'LUNA', preis: '17,00',
      kunde_name: 'A B', kunde_email: 'a@b.de', lieferadresse: 'X 1' });
    expect(r.success).toBe(true);
    expect(daten[0].slice(0, 12)).toEqual(KOPF);                                  // alte Spalten unverändert
    expect(daten[0].slice(12)).toEqual(['Status', 'Kanal', 'Sendungsnummer', 'Versendet am', 'Notiz', 'Artikelnr.', 'Kiste', 'PayPal-ID', 'Zahlung geprüft', 'Seriennummern', 'Rechnungsnr.', 'Plattform-Nr.']);
    const z = daten.at(-1);
    expect(z.slice(3, 9)).toEqual(['Glitzer', 'Blau', 'Gross', 'LUNA', 17, 'PayPal']);
    expect(z[spalte(daten, 'Status')]).toBe('Neu');
    expect(z[spalte(daten, 'Kanal')]).toBe('Webshop');
    expect(r.bestellnr).toBe('KW-20261107-002');
  });

  test('Bestellnummer wird nie doppelt vergeben', async () => {
    const { post } = umgebung([BESTELLUNG, ['07.11.2026', '', 'KW-20261107-003', 'Party', '', '', '', 1, '', '', '', '']]);
    expect(post({ variante: 'Party', preis: '15' }).bestellnr).toBe('KW-20261107-004');
  });
});

test.describe('Schnittstelle: Status und Versand', () => {
  test('Status setzen, auch wenn sich die Zeile verschoben hat', async () => {
    const { post, daten } = umgebung([BESTELLUNG, SUMMENZEILE, ZWEI_KRONEN]);
    const r = post({ aktion: 'status', schluessel: S, nr: 'KW-20261001-003', zeile: 2, status: 'In Arbeit' });
    expect(r).toMatchObject({ ok: true, bestellung: { nr: 'KW-20261001-003', status: 'In Arbeit' } });
    expect(daten[3][spalte(daten, 'Status')]).toBe('In Arbeit');
    expect(post({ aktion: 'status', schluessel: S, nr: 'KW-20261001-003', status: 'Gelöscht' }).fehler).toBe('ungueltiger_status');
    expect(post({ aktion: 'status', schluessel: S, nr: 'KW-GIBTS-NICHT', status: 'Neu' }).fehler).toBe('bestellung_nicht_gefunden');
  });

  test('Versenden mit Mail: Sendungsnummer, Datum, Status und eine Mail mit DHL-Link', async () => {
    const { post, daten, mails } = umgebung([BESTELLUNG, SUMMENZEILE, ZWEI_KRONEN]);
    const r = post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', zeile: 4, sendungsnummer: '0034 0434 1234 5678 90', mail: true });
    expect(r).toMatchObject({ ok: true, mail: true, bestellung: { status: 'Versendet', sendungsnummer: '003404341234567890', versendetAm: '07.11.2026' } });
    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(m).toMatchObject({ to: 'k@example.de', name: "Mila's Kronenwelt", replyTo: 'm.kronenwelt@gmail.com' });
    expect(m.subject).toContain('KW-20261001-003');
    expect(m.body).toContain('Hallo Kim,');
    expect(m.body).toContain('Einfarbig, Grün, Extra Mini „FRIDOLIN“');
    expect(m.body).toContain('Glitzer, Blau, Gross');
    expect(m.htmlBody).toContain('piececode=003404341234567890');
    expect(daten[3][spalte(daten, 'Notiz')]).toBe('Versandmail 07.11.2026');
  });

  test('Versenden ohne Mail und ohne Sendungsnummer (z. B. Brief) geht auch', async () => {
    const { post, mails } = umgebung([ZWEI_KRONEN]);
    const r = post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false });
    expect(r).toMatchObject({ ok: true, mail: false, bestellung: { status: 'Versendet', sendungsnummer: '' } });
    expect(mails).toHaveLength(0);
  });

  test('ungültige Sendungsnummer oder fehlende E-Mail werden abgelehnt, nichts wird verschickt', async () => {
    const { post, mails } = umgebung([ZWEI_KRONEN, ['01.11.2026', '', 'KW-OHNE-MAIL', 'Party', 'Rosa', 'Gross', '', 15, 'Bar', 'Markt', '', '']]);
    expect(post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '12<script>', mail: true }).fehler).toBe('ungueltige_sendungsnummer');
    expect(post({ aktion: 'versenden', schluessel: S, nr: 'KW-OHNE-MAIL', sendungsnummer: '123456789012', mail: true }).fehler).toBe('keine_email');
    expect(mails).toHaveLength(0);
  });
});

test.describe('Schnittstelle: Bestellung von Hand', () => {
  test('Markt-Verkauf mit zwei Kronen wird im selben Format gespeichert', async () => {
    const { post, daten } = umgebung([BESTELLUNG]);
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Markt', datum: '06.11.2026', status: 'Übergeben', zahlung: 'Bar',
      positionen: [{ variante: 'Party', farbe: 'Konfetti', groesse: 'Klein', pers: '' }, { variante: 'Glitzer', farbe: 'Gold', groesse: 'Mini', pers: 'BELLA' }],
      preis: 29, kunde: 'Marktkundin', notiz: 'Weihnachtsmarkt Bretten' });
    expect(r).toMatchObject({ ok: true, bestellung: { datum: '06.11.2026', kanal: 'Markt', status: 'Übergeben', preis: 29,
      variante: 'Party, Glitzer', farbe: 'Konfetti, Gold', groesse: 'Klein, Mini', personalisierung: 'ohne Namen | BELLA' } });
    expect(daten.at(-1)[spalte(daten, 'Notiz')]).toBe('Weihnachtsmarkt Bretten');
    const alle = post({ aktion: 'bestellungen', schluessel: S }).bestellungen;
    expect(alle[0].nr).toBe(r.bestellung.nr);
  });

  test('ohne Krone, ohne Kanal oder mit ungültigem Preis wird nichts angelegt', async () => {
    const { post, daten } = umgebung([BESTELLUNG]);
    const vorher = daten.length;
    expect(post({ aktion: 'anlegen', schluessel: S, kanal: 'Etsy', positionen: [], preis: 15 }).fehler).toBe('ungueltige_positionen');
    expect(post({ aktion: 'anlegen', schluessel: S, kanal: '', positionen: [{ variante: 'Party' }], preis: 15 }).fehler).toBe('kein_kanal');
    expect(post({ aktion: 'anlegen', schluessel: S, kanal: 'Etsy', positionen: [{ variante: 'Party' }], preis: 'abc' }).fehler).toBe('ungueltiger_preis');
    expect(daten.length).toBe(vorher);
  });
});

/* ---------------- Lager ---------------- */
const S_PARTY = 'KR-PARTY-ROSA-GR', S_GLITZER = 'KR-GLITZER-GOLD-MI';
const lager = post => post({ aktion: 'lager', schluessel: S });
const bestand = (post, sku, kiste) => ((lager(post).bestand[sku] || {})[kiste] || 0);

test.describe('Schnittstelle: Lager', () => {
  test('leeres Lager: Blätter entstehen beim ersten Zugriff, Kisten kommen mit', async () => {
    const { post, blatt } = umgebung([BESTELLUNG]);
    const r = lager(post);
    expect(r).toMatchObject({ ok: true, kisten: ['Markt & Webshop', 'Etsy', 'Amazon', 'Werkstatt'], werkstatt: 'Werkstatt', bestand: {}, mindest: {}, bewegungen: [] });
    expect(r.kanalKiste).toMatchObject({ Webshop: 'Markt & Webshop', Markt: 'Markt & Webshop', Etsy: 'Etsy' });
    expect(blatt('Lagerbewegungen')[0]).toEqual(['Datum', 'Uhrzeit', 'Artikelnr.', 'Artikel', 'Kiste', 'Menge', 'Grund', 'Bestellnr.', 'Notiz']);
    expect(lager(post).bewegungen).toEqual([]);                     // Lesen allein bucht nichts
  });

  test('genäht, umgelagert, ausgebucht: Bestand ist die Summe der Bewegungen', async () => {
    const { post, blatt } = umgebung([]);
    let r = post({ aktion: 'buchen', schluessel: S, buchungen: [
      { sku: S_PARTY, kiste: 'Werkstatt', menge: 5, grund: 'Genäht', artikel: 'Party · Rosa · Gross' },
      { sku: S_GLITZER, kiste: 'Etsy', menge: 2, grund: 'Genäht' }] });
    expect(r).toMatchObject({ ok: true, gebucht: 2 });
    post({ aktion: 'buchen', schluessel: S, buchungen: [
      { sku: S_PARTY, kiste: 'Werkstatt', menge: -3, grund: 'Umlagerung' },
      { sku: S_PARTY, kiste: 'Markt & Webshop', menge: 3, grund: 'Umlagerung' },
      { sku: S_GLITZER, kiste: 'Etsy', menge: -1, grund: 'Ausgebucht', notiz: 'Geschenk' }] });
    r = lager(post);
    expect(r.bestand).toEqual({ [S_PARTY]: { Werkstatt: 2, 'Markt & Webshop': 3 }, [S_GLITZER]: { Etsy: 1 } });
    expect(r.bewegungen[0]).toMatchObject({ sku: S_GLITZER, menge: -1, grund: 'Ausgebucht', notiz: 'Geschenk', datum: '07.11.2026' });
    expect(blatt('Lagerbewegungen')).toHaveLength(6);
  });

  test('ungültige Buchungen werden ganz abgelehnt, auch Verkauf/Storno von Hand', async () => {
    const { post } = umgebung([]);
    const falsch = [
      { sku: 'party rosa', kiste: 'Etsy', menge: 1, grund: 'Genäht' },
      { sku: S_PARTY, kiste: 'Keller', menge: 1, grund: 'Genäht' },
      { sku: S_PARTY, kiste: 'Etsy', menge: 1.5, grund: 'Genäht' },
      { sku: S_PARTY, kiste: 'Etsy', menge: 0, grund: 'Genäht' },
      { sku: S_PARTY, kiste: 'Etsy', menge: -1, grund: 'Verkauf' }];
    for (const b of falsch) {
      expect(post({ aktion: 'buchen', schluessel: S, buchungen: [{ sku: S_GLITZER, kiste: 'Etsy', menge: 1, grund: 'Genäht' }, b] }).fehler).toBe('ungueltige_buchung');
    }
    expect(lager(post).bewegungen).toEqual([]);
    expect(post({ aktion: 'buchen', schluessel: 'FALSCH', buchungen: [{ sku: S_PARTY, kiste: 'Etsy', menge: 1, grund: 'Genäht' }] }).fehler).toBe('nicht_erlaubt');
  });

  test('Inventur bucht nur den Unterschied zur Zählung', async () => {
    const { post } = umgebung([]);
    post({ aktion: 'buchen', schluessel: S, buchungen: [{ sku: S_PARTY, kiste: 'Etsy', menge: 4, grund: 'Genäht' }] });
    const r = post({ aktion: 'inventur', schluessel: S, kiste: 'Etsy', zaehlung: { [S_PARTY]: 3, [S_GLITZER]: 2, 'KR-UNI-BLAU-KL': 0 } });
    expect(r).toMatchObject({ ok: true, korrigiert: 2 });
    expect(r.bestand[S_PARTY].Etsy).toBe(3);
    expect(r.bestand[S_GLITZER].Etsy).toBe(2);
    expect(r.bewegungen.filter(b => b.grund === 'Inventur').map(b => b.menge).sort()).toEqual([-1, 2]);
    expect(post({ aktion: 'inventur', schluessel: S, kiste: 'Etsy', zaehlung: { [S_PARTY]: 3 } }).korrigiert).toBe(0);
    expect(post({ aktion: 'inventur', schluessel: S, kiste: 'Etsy', zaehlung: { [S_PARTY]: -1 } }).fehler).toBe('ungueltige_zaehlung');
    expect(post({ aktion: 'inventur', schluessel: S, kiste: 'Dachboden', zaehlung: { [S_PARTY]: 1 } }).fehler).toBe('ungueltige_kiste');
  });

  test('Mindestbestand je Kiste setzen, ändern und mit 0 entfernen', async () => {
    const { post } = umgebung([]);
    post({ aktion: 'mindest', schluessel: S, kiste: 'Markt & Webshop', werte: { [S_PARTY]: 2, [S_GLITZER]: 1 } });
    post({ aktion: 'mindest', schluessel: S, kiste: 'Etsy', werte: { [S_PARTY]: 1 } });
    let r = post({ aktion: 'mindest', schluessel: S, kiste: 'Markt & Webshop', werte: { [S_PARTY]: 3, [S_GLITZER]: 0 } });
    expect(r.mindest).toEqual({ [S_PARTY]: { 'Markt & Webshop': 3, Etsy: 1 } });
  });
});

test.describe('Schnittstelle: Verkäufe buchen das Lager ab', () => {
  test('Shop-Bestellung mit Artikelnummern bucht je Krone 1 aus „Markt & Webshop“ ab', async () => {
    const { post, daten } = umgebung([]);
    const r = post({ variante: 'Party, Glitzer', farbe: 'Rosa mit Punkten, Gold', groesse: 'Gross, Mini', hundename: 'MILA | ohne Namen',
      preis: '32,00', artikel: S_PARTY + ', ' + S_GLITZER });
    expect(daten.at(-1)[spalte(daten, 'Artikelnr.')]).toBe(S_PARTY + ', ' + S_GLITZER);
    expect(daten.at(-1)[spalte(daten, 'Kiste')]).toBe('Markt & Webshop');
    const l = lager(post);
    expect(l.bestand).toEqual({ [S_PARTY]: { 'Markt & Webshop': -1 }, [S_GLITZER]: { 'Markt & Webshop': -1 } });
    expect(l.bewegungen.map(b => [b.grund, b.nr, b.artikel])).toContainEqual(['Verkauf', r.bestellnr, 'Party, Rosa mit Punkten, Gross']);
  });

  test('alte Shop-Seite ohne Artikelnummern: Bestellung wie bisher, Lager bleibt unberührt', async () => {
    const { post } = umgebung([]);
    expect(post({ variante: 'Party', farbe: 'Rosa', groesse: 'Gross', preis: '15' }).success).toBe(true);
    expect(lager(post).bewegungen).toEqual([]);
  });

  test('Storno bucht zurück, Rücknahme des Stornos bucht wieder ab, nie doppelt', async () => {
    const { post } = umgebung([]);
    const nr = post({ variante: 'Party', farbe: 'Rosa', groesse: 'Gross', preis: '15', artikel: S_PARTY }).bestellnr;
    expect(bestand(post, S_PARTY, 'Markt & Webshop')).toBe(-1);
    post({ aktion: 'status', schluessel: S, nr, status: 'In Arbeit' });
    post({ aktion: 'status', schluessel: S, nr, status: 'Versendet' });
    expect(bestand(post, S_PARTY, 'Markt & Webshop')).toBe(-1);            // Statuswechsel bucht nicht erneut
    post({ aktion: 'status', schluessel: S, nr, status: 'Storniert' });
    expect(bestand(post, S_PARTY, 'Markt & Webshop')).toBe(0);
    expect(lager(post).bewegungen[0]).toMatchObject({ grund: 'Storno', menge: 1, nr });
    post({ aktion: 'status', schluessel: S, nr, status: 'Neu' });
    expect(bestand(post, S_PARTY, 'Markt & Webshop')).toBe(-1);
  });

  test('Bestellung von Hand: Kiste des Kanals, eigene Kiste oder „nicht vom Lager“', async () => {
    const { post, daten } = umgebung([]);
    const pos = [{ variante: 'Party', farbe: 'Rosa', groesse: 'Gross', sku: S_PARTY }];
    post({ aktion: 'anlegen', schluessel: S, kanal: 'Etsy', positionen: pos, preis: 15, kunde: 'A' });
    expect(bestand(post, S_PARTY, 'Etsy')).toBe(-1);
    post({ aktion: 'anlegen', schluessel: S, kanal: 'Markt', kiste: 'Werkstatt', positionen: pos, preis: 15 });
    expect(bestand(post, S_PARTY, 'Werkstatt')).toBe(-1);
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Amazon', kiste: '', positionen: pos, preis: 15, kunde: 'B' });
    expect(r.bestellung).toMatchObject({ kiste: 'nicht vom Lager', artikel: S_PARTY });
    expect(lager(post).bestand[S_PARTY].Amazon).toBeUndefined();
    const ohne = post({ aktion: 'anlegen', schluessel: S, kanal: 'Etsy', positionen: [{ variante: 'Party', sku: 'quatsch<' }], preis: 15, kunde: 'C' });
    expect(ohne.bestellung.artikel).toBe('');
    expect(daten.length).toBe(5);
  });

  test('Fehler im Lager verhindern keine Bestellung', async () => {
    const { post, daten } = umgebung([], 'GEHEIM123', { kaputt: ['Lagerbewegungen'] });
    expect(post({ variante: 'Party', preis: '15', artikel: S_PARTY }).success).toBe(true);
    expect(daten).toHaveLength(2);
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Etsy', positionen: [{ variante: 'Party', sku: S_PARTY }], preis: 15, kunde: 'A' });
    expect(r).toMatchObject({ ok: true, lagerFehler: true });
    expect(daten).toHaveLength(3);
    expect(post({ aktion: 'buchen', schluessel: S, buchungen: [{ sku: S_PARTY, kiste: 'Etsy', menge: 1, grund: 'Genäht' }] }).ok).toBe(false);
  });
});

test.describe('Schnittstelle: Lager – Grenzfälle', () => {
  test('ungültiger Mindestbestand wird abgelehnt, nichts wird gespeichert', async () => {
    const { post } = umgebung([]);
    for (const n of [-1, 1.5, 'viel', 1000]) {
      expect(post({ aktion: 'mindest', schluessel: S, kiste: 'Etsy', werte: { [S_PARTY]: 2, [S_GLITZER]: n } }).fehler).toBe('ungueltiger_mindestbestand');
    }
    expect(post({ aktion: 'mindest', schluessel: S, kiste: 'Etsy', werte: { 'kaputt<': 1 } }).fehler).toBe('ungueltiger_mindestbestand');
    expect(lager(post).mindest).toEqual({});
  });

  test('zu viele Buchungen auf einmal werden abgelehnt', async () => {
    const { post } = umgebung([]);
    const viele = Array.from({ length: 301 }, () => ({ sku: S_PARTY, kiste: 'Etsy', menge: 1, grund: 'Genäht' }));
    expect(post({ aktion: 'buchen', schluessel: S, buchungen: viele }).fehler).toBe('ungueltige_buchung');
    expect(post({ aktion: 'buchen', schluessel: S, buchungen: [] }).fehler).toBe('ungueltige_buchung');
    expect(lager(post).bewegungen).toEqual([]);
  });

  test('Kanal ohne eigene Kiste (Sonstiges) bucht nichts ab, außer eine Kiste wird gewählt', async () => {
    const { post } = umgebung([]);
    const pos = [{ variante: 'Party', sku: S_PARTY }];
    expect(post({ aktion: 'anlegen', schluessel: S, kanal: 'Sonstiges', positionen: pos, preis: 15, kunde: 'A' }).bestellung.kiste).toBe('nicht vom Lager');
    expect(lager(post).bewegungen).toEqual([]);
    post({ aktion: 'anlegen', schluessel: S, kanal: 'Sonstiges', kiste: 'Werkstatt', positionen: pos, preis: 15, kunde: 'B' });
    expect(bestand(post, S_PARTY, 'Werkstatt')).toBe(-1);
  });

  test('alte Bestellungen ohne Artikelnummern: Status ändern oder stornieren bucht nichts', async () => {
    const { post } = umgebung([ZWEI_KRONEN]);
    post({ aktion: 'status', schluessel: S, nr: 'KW-20261001-003', status: 'Storniert' });
    post({ aktion: 'status', schluessel: S, nr: 'KW-20261001-003', status: 'Neu' });
    expect(lager(post).bewegungen).toEqual([]);
  });

  test('Bezeichnung und Notiz landen lesbar im Blatt „Lagerbewegungen“', async () => {
    const { post, blatt } = umgebung([]);
    post({ aktion: 'inventur', schluessel: S, kiste: 'Etsy', zaehlung: { [S_PARTY]: 2 }, artikel: { [S_PARTY]: 'Party · Rosa · Gross' }, notiz: 'Jahresinventur' });
    const kopf = blatt('Lagerbewegungen')[0], z = blatt('Lagerbewegungen')[1];
    const w = n => z[kopf.indexOf(n)];
    expect([w('Artikelnr.'), w('Artikel'), w('Kiste'), w('Menge'), w('Grund'), w('Notiz'), w('Datum')])
      .toEqual([S_PARTY, 'Party · Rosa · Gross', 'Etsy', 2, 'Inventur', 'Jahresinventur', '07.11.2026']);
  });
});

/* ---------------- Zahlung prüfen (PayPal) ---------------- */
const katalogJson = require('../katalog.json');
const preisVon = (name, groesse) => katalogJson.produkte.find(p => p.name === name).merkmale.groesse.find(g => g.wert === groesse).preis;
const PARTY_ROSA = katalogJson.produkte.find(p => p.name === 'Party').merkmale.farbe[0].wert;
const GLITZER_F = katalogJson.produkte.find(p => p.name === 'Glitzer').merkmale.farbe[0].wert;
const ZAHL = katalogJson.produkte.find(p => (p.optionen || []).includes('zahlenpets'));
const AUFPREIS6 = katalogJson.optionen.zahlenpets.werte.find(w => w.wert === 6).aufpreis;
const zwei = { variante: 'Party, Glitzer', farbe: PARTY_ROSA + ', ' + GLITZER_F, groesse: 'Gross, Mini', hundename: 'MILA | ohne Namen',
  kunde_name: 'Kim', kunde_email: 'k@example.de', lieferadresse: 'X 1' };
const summeZwei = preisVon('Party', 'Gross') + preisVon('Glitzer', 'Mini');
const geprueft = daten => daten.at(-1)[spalte(daten, 'Zahlung geprüft')];

test.describe('Schnittstelle: Zahlung prüfen', () => {
  test('echte Zahlung mit passendem Betrag: OK, PayPal-Nummer steht in der Tabelle', async () => {
    const { post, daten, abrufe } = umgebung([], S, { paypal: { orders: { '5O190127TN364715T': paypalZahlung(summeZwei) } } });
    const r = post({ ...zwei, preis: String(summeZwei).replace('.', ','), paypal_id: '5O190127TN364715T' });
    expect(r.success).toBe(true);
    expect(geprueft(daten)).toBe('OK: ' + summeZwei.toFixed(2).replace('.', ',') + ' € bei PayPal bezahlt');
    expect(daten.at(-1)[spalte(daten, 'PayPal-ID')]).toBe('5O190127TN364715T');
    const tok = abrufe.find(a => /oauth2\/token/.test(a.url));
    expect(tok.opt.headers.Authorization).toBe('Basic ' + Buffer.from('CID:GEHEIM').toString('base64'));
    expect(abrufe.some(a => a.url === 'https://api-m.paypal.com/v2/checkout/orders/5O190127TN364715T')).toBe(true);   // Live
  });

  test('Preis im Browser manipuliert: 1 Cent bezahlt → PRÜFEN, Bestellung ist trotzdem gespeichert', async () => {
    const { post, daten } = umgebung([], S, { paypal: { orders: { ABCDEFGHIJ12: paypalZahlung(0.01) } } });
    expect(post({ ...zwei, preis: '0,01', paypal_id: 'ABCDEFGHIJ12' }).success).toBe(true);
    expect(geprueft(daten)).toBe('PRÜFEN: bezahlt 0,01 €, laut Preisliste ' + summeZwei.toFixed(2).replace('.', ',') + ' €');
    expect(daten).toHaveLength(2);
  });

  test('gemeldeter Preis passt nicht zum bezahlten Betrag → PRÜFEN', async () => {
    const { post, daten } = umgebung([], S, { paypal: { orders: { ABCDEFGHIJ12: paypalZahlung(summeZwei + 10) } } });
    post({ ...zwei, preis: String(summeZwei), paypal_id: 'ABCDEFGHIJ12' });
    expect(geprueft(daten)).toMatch(/^PRÜFEN: bezahlt .*, gemeldet /);
  });

  test('ohne Zahlung bestellt (direkt an die Schnittstelle geschickt) → PRÜFEN', async () => {
    const { post, daten } = umgebung([], S, { paypal: { orders: {} } });
    post({ ...zwei, preis: '1' });
    expect(geprueft(daten)).toBe('PRÜFEN: ohne PayPal-Zahlungsnummer gemeldet');
    post({ ...zwei, preis: '1', paypal_id: 'GIBTESNICHT123' });
    expect(geprueft(daten)).toBe('PRÜFEN: Zahlung bei PayPal nicht gefunden');
    post({ ...zwei, preis: '1', paypal_id: '<script>' });
    expect(geprueft(daten)).toBe('PRÜFEN: ungültige PayPal-Zahlungsnummer');
  });

  test('Zahlung nicht abgeschlossen oder in anderer Währung → PRÜFEN', async () => {
    const { post, daten } = umgebung([], S, { paypal: { orders: {
      OFFEN1234567: paypalZahlung(summeZwei, { status: 'APPROVED', capture: 'PENDING' }),
      USD123456789: paypalZahlung(summeZwei, { waehrung: 'USD' }) } } });
    post({ ...zwei, preis: String(summeZwei), paypal_id: 'OFFEN1234567' });
    expect(geprueft(daten)).toBe('PRÜFEN: Zahlung nicht abgeschlossen (PENDING)');
    post({ ...zwei, preis: String(summeZwei), paypal_id: 'USD123456789' });
    expect(geprueft(daten)).toBe('PRÜFEN: Zahlung nicht in Euro (USD)');
  });

  test('dieselbe Zahlung ein zweites Mal gemeldet → PRÜFEN mit Verweis auf die erste Bestellung', async () => {
    const { post, daten } = umgebung([], S, { paypal: { orders: { ABCDEFGHIJ12: paypalZahlung(summeZwei) } } });
    const erste = post({ ...zwei, preis: String(summeZwei), paypal_id: 'ABCDEFGHIJ12' }).bestellnr;
    expect(geprueft(daten)).toMatch(/^OK/);
    post({ ...zwei, preis: String(summeZwei), paypal_id: 'ABCDEFGHIJ12' });
    expect(geprueft(daten)).toBe('PRÜFEN: diese PayPal-Zahlung gehört schon zu ' + erste);
  });

  test('Zahlenkrone mit 6 Pets: Aufpreis wird mitgerechnet; unbekannte Krone → PRÜFEN', async () => {
    const soll = preisVon(ZAHL.name, 'Gross') + AUFPREIS6;
    const { post, daten } = umgebung([], S, { paypal: { orders: { ZAHL12345678: paypalZahlung(soll), FALSCH123456: paypalZahlung(5) } } });
    post({ variante: ZAHL.name, farbe: ZAHL.merkmale.farbe[0].wert, groesse: 'Gross + 6 Pets', preis: String(soll), paypal_id: 'ZAHL12345678' });
    expect(geprueft(daten)).toMatch(/^OK/);
    post({ variante: 'Fantasiekrone', farbe: 'Lila', groesse: 'Gross', preis: '5', paypal_id: 'FALSCH123456' });
    expect(geprueft(daten)).toBe('PRÜFEN: bezahlt 5,00 €, Artikel nicht im Katalog: Fantasiekrone Lila Gross');
  });

  test('ohne PayPal-Zugang oder mit falschem Zugang: NICHT GEPRÜFT, Bestellung gespeichert', async () => {
    let u = umgebung([], S);
    expect(u.post({ ...zwei, preis: '1', paypal_id: 'ABCDEFGHIJ12' }).success).toBe(true);
    expect(geprueft(u.daten)).toBe('NICHT GEPRÜFT: PayPal-Zugang fehlt (Skript-Eigenschaften)');
    u = umgebung([], S, { paypal: { falsch: true } });
    expect(u.post({ ...zwei, preis: '1', paypal_id: 'ABCDEFGHIJ12' }).success).toBe(true);
    expect(geprueft(u.daten)).toBe('NICHT GEPRÜFT: PayPal-Anmeldung fehlgeschlagen (401), Zugangsdaten prüfen');
  });

  test('Sandbox zum Ausprobieren über die Skript-Eigenschaft PAYPAL_MODUS', async () => {
    const { post, abrufe } = umgebung([], S, { paypal: { orders: {} }, eigenschaften: { PAYPAL_MODUS: 'sandbox' } });
    post({ ...zwei, preis: '1', paypal_id: 'ABCDEFGHIJ12' });
    expect(abrufe.filter(a => /paypal/.test(a.url)).every(a => a.url.startsWith('https://api-m.sandbox.paypal.com/'))).toBe(true);
  });

  test('ping meldet, ob der PayPal-Zugang eingerichtet ist', async () => {
    expect(umgebung([], S).post({ aktion: 'ping', schluessel: S }).paypal).toBe('fehlt');
    expect(umgebung([], S, { paypal: { orders: {} } }).post({ aktion: 'ping', schluessel: S }).paypal).toBe('eingerichtet');
  });

  test('Admin prüft nach: nach dem Eintragen des Zugangs wird aus NICHT GEPRÜFT ein OK', async () => {
    const u = umgebung([], S, { eigenschaften: {} });
    const nr = u.post({ ...zwei, preis: String(summeZwei), paypal_id: 'ABCDEFGHIJ12' }).bestellnr;
    expect(geprueft(u.daten)).toMatch(/^NICHT GEPRÜFT/);
    // Zugang nachträglich eintragen: neue Umgebung mit denselben Tabellenzeilen
    const v = umgebung(u.daten.slice(1), S, { kopf: u.daten[0], paypal: { orders: { ABCDEFGHIJ12: paypalZahlung(summeZwei) } } });
    const r = v.post({ aktion: 'zahlung', schluessel: S, nr });
    expect(r).toMatchObject({ ok: true, bestellung: { nr, paypalId: 'ABCDEFGHIJ12', zahlungGeprueft: expect.stringMatching(/^OK/) } });
    expect(v.post({ aktion: 'zahlung', schluessel: 'FALSCH', nr }).fehler).toBe('nicht_erlaubt');
  });

  test('alte Bestellungen ohne die neuen Spalten werden weiter gelesen', async () => {
    const { post } = umgebung([BESTELLUNG], S);
    expect(post({ aktion: 'bestellungen', schluessel: S }).bestellungen[0]).toMatchObject({ paypalId: '', zahlungGeprueft: '' });
  });
});

/* ---------------- Mails an Kunden ---------------- */
test.describe('Schnittstelle: Bestellbestätigung und Versandmail', () => {
  const bestellung = { variante: 'Party, Glitzer', farbe: PARTY_ROSA + ', ' + GLITZER_F, groesse: 'Extra Mini, Mini', hundename: 'MILA | ohne Namen',
    preis: String(preisVon('Party', 'Extra Mini') + preisVon('Glitzer', 'Mini')), kunde_name: 'Peter Schwarz', kunde_email: 'p@example.de',
    lieferadresse: '8 Vogesenweg, 75045 WALZBACHTAL, DE', bestaetigung_per_schnittstelle: true };

  test('Shop bittet darum: Bestätigung mit Bestellnummer, jeder Krone mit Preis, Adresse und Hilfe', async () => {
    const { post, mails } = umgebung([], S);
    const r = post(bestellung);
    expect(r).toMatchObject({ success: true, bestaetigung: true });
    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(m).toMatchObject({ to: 'p@example.de', name: "Mila's Kronenwelt", replyTo: 'm.kronenwelt@gmail.com' });
    expect(m.subject).toBe('Danke für deine Bestellung ' + r.bestellnr + ' 👑');
    for (const t of [r.bestellnr, 'Hallo Peter,', 'Party', 'Extra Mini', '„MILA“', 'Glitzer', euroLaut(preisVon('Party', 'Extra Mini')),
      euroLaut(preisVon('Glitzer', 'Mini')), 'kostenlos', '8 Vogesenweg<br>75045 WALZBACHTAL<br>Deutschland', 'https://wa.me/4917631242035',
      'Gemäß § 19 UStG', '/agb.html', '/widerruf.html', 'vom Widerrufsrecht ausgeschlossen', '5–6 Werktage']) expect(m.htmlBody).toContain(t);
    expect(m.body).toContain('Bestellnummer: ' + r.bestellnr);
    expect(m.body).toContain('- Party, ' + PARTY_ROSA + ', Extra Mini „MILA“');
    expect(m.body).toContain('Peter Schwarz\n8 Vogesenweg\n75045 WALZBACHTAL\nDeutschland');
    for (const x of [m.body, m.htmlBody]) { expect(x).not.toMatch(/[─━]{3,}/); expect(x).not.toContain('freuen uns werden'); expect(x).not.toContain('EmailJS'); }
    expect(m.htmlBody).toContain('max-width:560px');                     // passt aufs Handy
  });

  test('ohne Bitte des Shops (alte Shop-Seite) schickt die Tabelle keine Bestätigung', async () => {
    const { post, mails } = umgebung([], S);
    const { bestaetigung_per_schnittstelle, ...alt } = bestellung;
    expect(post(alt)).toMatchObject({ success: true, bestaetigung: false });
    expect(mails).toHaveLength(0);
  });

  test('ungültige Mailadresse: keine Bestätigung, Bestellung trotzdem gespeichert', async () => {
    const { post, mails, daten } = umgebung([], S);
    expect(post({ ...bestellung, kunde_email: 'kaputt' })).toMatchObject({ success: true, bestaetigung: false });
    expect(mails).toHaveLength(0);
    expect(daten).toHaveLength(2);
  });

  test('unbekannte Krone: Bestätigung kommt trotzdem, nur ohne Einzelpreise', async () => {
    const { post, mails } = umgebung([], S);
    post({ ...bestellung, variante: 'Fantasiekrone', farbe: 'Lila', groesse: 'Gross', hundename: 'BOB', preis: '9' });
    expect(mails).toHaveLength(1);
    expect(mails[0].htmlBody).toContain('Fantasiekrone');
    expect(mails[0].htmlBody).toContain('9,00 €');                       // Gesamt steht da
  });

  test('Versandmail im neuen Layout: Sendungsnummer, Knopf, Kronen, Adresse in Zeilen, Instagram', async () => {
    const { post, mails } = umgebung([ZWEI_KRONEN], S);
    post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '00340434123456789012', mail: true });
    const m = mails[0];
    for (const t of ['Deine Kronen sind unterwegs!', 'SENDUNG VERFOLGEN', 'piececode=00340434123456789012', '00340434123456789012',
      'Einfarbig', '„FRIDOLIN“', 'Moorblick 4<br>24329 Dannau<br>Deutschland', '@kronenwelt', 'https://wa.me/4917631242035']) expect(m.htmlBody).toContain(t);
    expect(m.body).toContain('Kim Muster\nMoorblick 4\n24329 Dannau\nDeutschland');
    expect(m.body).not.toMatch(/[─━]{3,}/);
  });
});
const euroLaut = n => n.toFixed(2).replace('.', ',') + ' €';

test.describe('Schnittstelle: Stornomail', () => {
  test('Storno mit Mail: Saras Text im Layout, Bestellung darunter, Notiz in der Tabelle', async () => {
    const { post, mails, daten } = umgebung([ZWEI_KRONEN], S);
    const r = post({ aktion: 'status', schluessel: S, nr: 'KW-20261001-003', status: 'Storniert', mail: true, nachricht: 'Hallo Kim,\n\nleider <b>nicht</b> möglich.\n\nLiebe Grüße\nSara' });
    expect(r).toMatchObject({ ok: true, mail: true, bestellung: { status: 'Storniert' } });
    const m = mails[0];
    expect(m.subject).toBe('Deine Bestellung KW-20261001-003 wurde storniert');
    expect(m.htmlBody).toContain('leider &lt;b&gt;nicht&lt;/b&gt; möglich.');            // Text wird nicht als HTML ausgeführt
    expect(m.htmlBody).toContain('Liebe Grüße<br>Sara');
    expect(m.htmlBody).toContain('29,00 €');
    expect(m.htmlBody).toContain('„FRIDOLIN“');
    expect(m.body).toMatch(/^Hallo Kim,\n\nleider <b>nicht<\/b> möglich\./);
    expect(daten[1][spalte(daten, 'Notiz')]).toBe('Stornomail 07.11.2026');
  });

  test('ohne Mail-Wunsch keine Mail; Mail-Wunsch ohne Adresse oder Text: nichts wird geändert', async () => {
    const ohne = ['01.11.2026', '', 'KW-OHNE-MAIL', 'Party', 'Rosa', 'Gross', '', 15, 'Bar', 'Markt', '', ''];
    const { post, mails, daten } = umgebung([ZWEI_KRONEN, ohne], S);
    expect(post({ aktion: 'status', schluessel: S, nr: 'KW-OHNE-MAIL', status: 'Storniert', mail: true, nachricht: 'x' }).fehler).toBe('keine_email');
    expect(post({ aktion: 'status', schluessel: S, nr: 'KW-20261001-003', status: 'Storniert', mail: true, nachricht: '  ' }).fehler).toBe('ungueltige_nachricht');
    expect(post({ aktion: 'bestellungen', schluessel: S }).bestellungen.every(b => b.status === 'Neu')).toBe(true);
    expect(post({ aktion: 'status', schluessel: S, nr: 'KW-20261001-003', status: 'Storniert' })).toMatchObject({ ok: true, mail: false });
    expect(post({ aktion: 'status', schluessel: S, nr: 'KW-20261001-003', status: 'Neu', mail: true, nachricht: 'x' }).mail).toBe(false);   // nur bei Storno
    expect(mails).toHaveLength(0);
  });
});

/* ---------------- Seriennummern (GPSR) ---------------- */
const SL_KOPF = ['(SN) Seriennnummer', 'Verkaufsplattform', 'Produktbezeichnung / Typ', 'Herstellungsdatum', 'Herstellername & Kontakt', 'Verweis auf Sicherheits-/Risikoakte'];
const HERST = 'Mila’s Kronenwelt, Vogesenweg 8, 75045 Walzbachtal, Deutschland';
const SARAS_LISTE = () => [SL_KOPF,
  ['MK-2025-308', 'amazon', 'Lila, klein, Lena', '07.11.2026', HERST, 'Risikoakte_Hundekrone_2025.xlsx'],
  ['MK-2025-309', 'etsy', 'Gross, grün, 1,2,3,8,9, (10)', '10.11.2026', HERST, 'Risikoakte_Hundekrone_2025.xlsx'],
  ['MK-2025-310', '', '', '', '', '']];                                   // vorbereitete, leere Nummer

test.describe('Schnittstelle: Seriennummern', () => {
  test('ping meldet die zuletzt vergebene Nummer, Vorschlag beginnt bei der vorbereiteten MK-2025-310', async () => {
    const { post } = umgebung([ZWEI_KRONEN], S, { serienliste: SARAS_LISTE() });
    expect(post({ aktion: 'ping', schluessel: S }).serienliste).toBe('MK-2025-309');
    expect(post({ aktion: 'seriennummern', schluessel: S, anzahl: 3 })).toMatchObject({ ok: true, nummern: ['MK-2025-310', 'MK-2025-311', 'MK-2025-312'] });
    expect(umgebung([], S).post({ aktion: 'ping', schluessel: S }).serienliste).toBe('fehlt');
  });

  test('Versenden trägt jede Krone in Saras Liste ein, Spalten wie bei Sara, Bestell- und Rechnungsnummer rechts', async () => {
    const { post, serien, daten } = umgebung([ZWEI_KRONEN], S, { serienliste: SARAS_LISTE() });
    const r = post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false,
      seriennummern: ['MK-2025-310', 'mk-2025-311'], rechnungsnr: 'RE-2026-0042' });
    expect(r).toMatchObject({ ok: true, bestellung: { status: 'Versendet', seriennummern: 'MK-2025-310, MK-2025-311', rechnungsnr: 'RE-2026-0042' } });
    expect(serien[0]).toEqual([...SL_KOPF, 'Bestellnr.', 'Rechnungsnr.']);
    expect(serien[3]).toEqual(['MK-2025-310', 'kronenwelt', 'Einfarbig, Grün, Extra Mini, FRIDOLIN', '07.11.2026', HERST, 'Risikoakte_Hundekrone_2025.xlsx', 'KW-20261001-003', 'RE-2026-0042']);
    expect(serien[4]).toEqual(['MK-2025-311', 'kronenwelt', 'Glitzer, Blau, Gross', '07.11.2026', HERST, 'Risikoakte_Hundekrone_2025.xlsx', 'KW-20261001-003', 'RE-2026-0042']);
    expect(serien).toHaveLength(5);                                     // vorbereitete Zeile 310 wurde gefüllt, nicht doppelt angelegt
    expect(daten[1][spalte(daten, 'Seriennummern')]).toBe('MK-2025-310, MK-2025-311');
    expect(post({ aktion: 'seriennummern', schluessel: S, anzahl: 1 }).nummern).toEqual(['MK-2025-312']);
  });

  test('schon vergebene Nummer: nichts wird geändert, Vorschlag mit freien Nummern kommt zurück', async () => {
    const { post, serien, daten } = umgebung([ZWEI_KRONEN], S, { serienliste: SARAS_LISTE() });
    const r = post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: ['MK-2025-309', 'MK-2025-310'] });
    expect(r).toMatchObject({ ok: false, fehler: 'seriennummer_vergeben', vorschlag: ['MK-2025-310', 'MK-2025-311'] });
    expect(r.text).toContain('MK-2025-309');
    expect(daten[1][spalte(daten, 'Status')] || 'Neu').toBe('Neu');
    expect(serien).toHaveLength(4);
    for (const falsch of [['MK-2025-310', 'MK-2025-310'], ['Krone 1']]) {
      expect(post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: falsch }).fehler).toBe('ungueltige_seriennummer');
    }
  });

  test('Markt: „Übergeben“ mit Seriennummer; Plattform „markt“', async () => {
    const markt = ['06.11.2026', '', 'KW-20261106-001', 'Party', 'Konfetti', 'Mini', 'BELLA', 13, 'Bar', 'Marktkundin', '', '', 'Neu', 'Markt'];
    const kopf = [...KOPF, 'Status', 'Kanal'];
    const { post, serien } = umgebung([markt], S, { kopf, serienliste: SARAS_LISTE() });
    expect(post({ aktion: 'status', schluessel: S, nr: 'KW-20261106-001', status: 'Übergeben', seriennummern: ['MK-2025-310'] }).ok).toBe(true);
    expect(serien[3].slice(0, 3)).toEqual(['MK-2025-310', 'markt', 'Party, Konfetti, Mini, BELLA']);
  });

  test('ohne Seriennummern geht Versenden wie bisher; mit Nummern aber ohne Liste: Fehler, nichts geändert', async () => {
    const ohne = umgebung([ZWEI_KRONEN], S);
    expect(ohne.post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false }).ok).toBe(true);
    const u = umgebung([ZWEI_KRONEN], S);
    expect(u.post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: ['MK-2025-310'] }).fehler).toBe('serienliste_fehlt');
    expect(u.daten[1][spalte(u.daten, 'Status')] || 'Neu').toBe('Neu');
  });

  test('neue Nummern hinter der höchsten, auch wenn Sara zwischendurch von Hand eingetragen hat', async () => {
    const liste = SARAS_LISTE().slice(0, 3);                            // ohne vorbereitete 310
    liste.push(['MK-2025-315', 'etsy', 'von Hand', '11.11.2026', HERST, 'x']);
    const { post } = umgebung([], S, { serienliste: liste });
    expect(post({ aktion: 'seriennummern', schluessel: S, anzahl: 2 }).nummern).toEqual(['MK-2025-316', 'MK-2025-317']);
  });
});

test.describe('Schnittstelle: Verkauf über Etsy/Amazon in einem Schritt', () => {
  const pos = [{ variante: 'Party', farbe: 'Rosa', groesse: 'Mini', pers: 'ELLY', sku: 'KR-PARTY-ROSA-MI' }];
  test('Amazon: angelegt, Lager abgebucht, MK-Nummer in Saras Liste, versendet – ohne Kundenmail', async () => {
    const { post, serien, mails } = umgebung([], S, { serienliste: SARAS_LISTE() });
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Amazon', positionen: pos, preis: 15, kunde: 'Elly Muster',
      plattformNr: '302-1234567-1234567', direkt: true, sendungsnummer: '0034 0434 1234 5678 90', seriennummern: ['MK-2025-310'], rechnungsnr: 'RE-7' });
    expect(r.bestellung).toMatchObject({ status: 'Versendet', kanal: 'Amazon', plattformNr: '302-1234567-1234567', sendungsnummer: '003404341234567890',
      versendetAm: '07.11.2026', seriennummern: 'MK-2025-310', rechnungsnr: 'RE-7' });
    expect(serien[3].slice(0, 3)).toEqual(['MK-2025-310', 'amazon', 'Party, Rosa, Mini, ELLY']);
    expect(post({ aktion: 'lager', schluessel: S }).bestand['KR-PARTY-ROSA-MI']).toEqual({ Amazon: -1 });
    expect(mails).toHaveLength(0);
  });

  test('Markt „schon übergeben“: Status Übergeben, keine Sendungsnummer', async () => {
    const { post } = umgebung([], S, { serienliste: SARAS_LISTE() });
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Markt', positionen: pos, preis: 15, direkt: true, sendungsnummer: '123', seriennummern: ['MK-2025-310'] });
    expect(r.bestellung).toMatchObject({ status: 'Übergeben', sendungsnummer: '', seriennummern: 'MK-2025-310' });
  });

  test('MK-Nummer schon vergeben oder Sendungsnummer falsch: es wird gar nichts angelegt', async () => {
    const { post, daten, serien } = umgebung([], S, { serienliste: SARAS_LISTE() });
    expect(post({ aktion: 'anlegen', schluessel: S, kanal: 'Etsy', positionen: pos, preis: 15, kunde: 'A', direkt: true, seriennummern: ['MK-2025-309'] }))
      .toMatchObject({ ok: false, fehler: 'seriennummer_vergeben', vorschlag: ['MK-2025-310'] });
    expect(post({ aktion: 'anlegen', schluessel: S, kanal: 'Etsy', positionen: pos, preis: 15, kunde: 'A', direkt: true, sendungsnummer: '12<' }).fehler).toBe('ungueltige_sendungsnummer');
    expect(daten).toHaveLength(1);
    expect(serien).toHaveLength(4);
    expect(post({ aktion: 'lager', schluessel: S }).bewegungen).toEqual([]);
  });
});
