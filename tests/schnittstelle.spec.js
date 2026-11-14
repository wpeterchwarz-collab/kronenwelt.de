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
    expect(post({ aktion: 'ping', schluessel: S })).toMatchObject({ ok: true, version: '1.10', tabelle: 'Kronenwelt Bestellungen' });
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
  test('ping meldet die zuletzt vergebene Nummer, Vorschlag beginnt bei der vorbereiteten MK-2026-310', async () => {
    const { post } = umgebung([ZWEI_KRONEN], S, { serienliste: SARAS_LISTE() });
    expect(post({ aktion: 'ping', schluessel: S }).serienliste).toBe('MK-2025-309');
    expect(post({ aktion: 'seriennummern', schluessel: S, anzahl: 3 })).toMatchObject({ ok: true, nummern: ['MK-2026-310', 'MK-2026-311', 'MK-2026-312'] });
    expect(umgebung([], S).post({ aktion: 'ping', schluessel: S }).serienliste).toBe('fehlt');
  });

  test('Versenden trägt jede Krone in Saras Liste ein, Spalten wie bei Sara, Bestell- und Rechnungsnummer rechts', async () => {
    const { post, serien, daten } = umgebung([ZWEI_KRONEN], S, { serienliste: SARAS_LISTE() });
    const r = post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false,
      seriennummern: ['MK-2026-310', 'mk-2026-311'], rechnungsnr: 'RE-2026-0042' });
    expect(r).toMatchObject({ ok: true, bestellung: { status: 'Versendet', seriennummern: 'MK-2026-310, MK-2026-311', rechnungsnr: 'RE-2026-0042' } });
    expect(serien[0]).toEqual([...SL_KOPF, 'Bestellnr.', 'Rechnungsnr.', 'Hinweis']);
    expect(serien[3]).toEqual(['MK-2026-310', 'kronenwelt', 'Einfarbig, Grün, Extra Mini, FRIDOLIN', '07.11.2026', HERST, 'Risikoakte_Hundekrone_2025.xlsx', 'KW-20261001-003', 'RE-2026-0042']);
    expect(serien[4]).toEqual(['MK-2026-311', 'kronenwelt', 'Glitzer, Blau, Gross', '07.11.2026', HERST, 'Risikoakte_Hundekrone_2025.xlsx', 'KW-20261001-003', 'RE-2026-0042']);
    expect(serien).toHaveLength(5);                                     // vorbereitete Zeile 310 wurde gefüllt, nicht doppelt angelegt
    expect(daten[1][spalte(daten, 'Seriennummern')]).toBe('MK-2026-310, MK-2026-311');
    expect(post({ aktion: 'seriennummern', schluessel: S, anzahl: 1 }).nummern).toEqual(['MK-2026-312']);
  });

  test('schon vergebene Nummer: nichts wird geändert, Vorschlag mit freien Nummern kommt zurück', async () => {
    const { post, serien, daten } = umgebung([ZWEI_KRONEN], S, { serienliste: SARAS_LISTE() });
    const r = post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: ['MK-2025-309', 'MK-2026-310'] });
    expect(r).toMatchObject({ ok: false, fehler: 'seriennummer_vergeben', vorschlag: ['MK-2026-310', 'MK-2026-311'] });
    expect(r.text).toContain('MK-2025-309');
    expect(daten[1][spalte(daten, 'Status')] || 'Neu').toBe('Neu');
    expect(serien).toHaveLength(4);
    for (const falsch of [['MK-2026-310', 'MK-2026-310'], ['Krone 1']]) {
      expect(post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: falsch }).fehler).toBe('ungueltige_seriennummer');
    }
  });

  test('Markt: „Übergeben“ mit Seriennummer; Plattform „markt“', async () => {
    const markt = ['06.11.2026', '', 'KW-20261106-001', 'Party', 'Konfetti', 'Mini', 'BELLA', 13, 'Bar', 'Marktkundin', '', '', 'Neu', 'Markt'];
    const kopf = [...KOPF, 'Status', 'Kanal'];
    const { post, serien } = umgebung([markt], S, { kopf, serienliste: SARAS_LISTE() });
    expect(post({ aktion: 'status', schluessel: S, nr: 'KW-20261106-001', status: 'Übergeben', seriennummern: ['MK-2026-310'] }).ok).toBe(true);
    expect(serien[3].slice(0, 3)).toEqual(['MK-2026-310', 'markt', 'Party, Konfetti, Mini, BELLA']);
  });

  test('ohne Seriennummern geht Versenden wie bisher; mit Nummern aber ohne Liste: Fehler, nichts geändert', async () => {
    const ohne = umgebung([ZWEI_KRONEN], S);
    expect(ohne.post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false }).ok).toBe(true);
    const u = umgebung([ZWEI_KRONEN], S);
    expect(u.post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: ['MK-2026-310'] }).fehler).toBe('serienliste_fehlt');
    expect(u.daten[1][spalte(u.daten, 'Status')] || 'Neu').toBe('Neu');
  });

  test('Jahreswechsel: Jahr vorne aktuell, Zahl hinten läuft weiter; gleiche Zahl mit anderem Jahr gilt als vergeben', async () => {
    const { post, serien } = umgebung([ZWEI_KRONEN], S, { serienliste: SARAS_LISTE() });
    expect(post({ aktion: 'seriennummern', schluessel: S, anzahl: 2 }).nummern).toEqual(['MK-2026-310', 'MK-2026-311']);   // vorbereitete 2025-310 wird 2026-310
    const r = post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: ['MK-2026-309', 'MK-2026-310'] });
    expect(r).toMatchObject({ ok: false, fehler: 'seriennummer_vergeben', vorschlag: ['MK-2026-310', 'MK-2026-311'] });
    expect(r.text).toContain('MK-2025-309');
    expect(post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: ['MK-2026-310', 'MK-2025-310'] }).fehler).toBe('ungueltige_seriennummer');
    expect(post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: ['MK-2026-310', 'MK-2026-311'] }).ok).toBe(true);
    expect(serien.map(z => z[0])).toEqual(['(SN) Seriennnummer', 'MK-2025-308', 'MK-2025-309', 'MK-2026-310', 'MK-2026-311']);
  });

  test('neue Nummern hinter der höchsten, auch wenn Sara zwischendurch von Hand eingetragen hat', async () => {
    const liste = SARAS_LISTE().slice(0, 3);                            // ohne vorbereitete 310
    liste.push(['MK-2025-315', 'etsy', 'von Hand', '11.11.2026', HERST, 'x']);
    const { post } = umgebung([], S, { serienliste: liste });
    expect(post({ aktion: 'seriennummern', schluessel: S, anzahl: 2 }).nummern).toEqual(['MK-2026-316', 'MK-2026-317']);
  });
});

test.describe('Schnittstelle: Verkauf über Etsy/Amazon in einem Schritt', () => {
  const pos = [{ variante: 'Party', farbe: 'Rosa', groesse: 'Mini', pers: 'ELLY', sku: 'KR-PARTY-ROSA-MI' }];
  test('Amazon: angelegt, Lager abgebucht, MK-Nummer in Saras Liste, versendet – ohne Kundenmail', async () => {
    const { post, serien, mails } = umgebung([], S, { serienliste: SARAS_LISTE() });
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Amazon', positionen: pos, preis: 15, kunde: 'Elly Muster',
      plattformNr: '302-1234567-1234567', direkt: true, sendungsnummer: '0034 0434 1234 5678 90', seriennummern: ['MK-2026-310'], rechnungsnr: 'RE-7' });
    expect(r.bestellung).toMatchObject({ status: 'Versendet', kanal: 'Amazon', plattformNr: '302-1234567-1234567', sendungsnummer: '003404341234567890',
      versendetAm: '07.11.2026', seriennummern: 'MK-2026-310', rechnungsnr: 'RE-7' });
    expect(serien[3].slice(0, 3)).toEqual(['MK-2026-310', 'amazon', 'Party, Rosa, Mini, ELLY']);
    expect(post({ aktion: 'lager', schluessel: S }).bestand['KR-PARTY-ROSA-MI']).toEqual({ Amazon: -1 });
    expect(mails).toHaveLength(0);
  });

  test('Markt „schon übergeben“: Status Übergeben, keine Sendungsnummer', async () => {
    const { post } = umgebung([], S, { serienliste: SARAS_LISTE() });
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Markt', positionen: pos, preis: 15, direkt: true, sendungsnummer: '123', seriennummern: ['MK-2026-310'] });
    expect(r.bestellung).toMatchObject({ status: 'Übergeben', sendungsnummer: '', seriennummern: 'MK-2026-310' });
  });

  test('MK-Nummer schon vergeben oder Sendungsnummer falsch: es wird gar nichts angelegt', async () => {
    const { post, daten, serien } = umgebung([], S, { serienliste: SARAS_LISTE() });
    expect(post({ aktion: 'anlegen', schluessel: S, kanal: 'Etsy', positionen: pos, preis: 15, kunde: 'A', direkt: true, seriennummern: ['MK-2025-309'] }))
      .toMatchObject({ ok: false, fehler: 'seriennummer_vergeben', vorschlag: ['MK-2026-310'] });
    expect(post({ aktion: 'anlegen', schluessel: S, kanal: 'Etsy', positionen: pos, preis: 15, kunde: 'A', direkt: true, sendungsnummer: '12<' }).fehler).toBe('ungueltige_sendungsnummer');
    expect(daten).toHaveLength(1);
    expect(serien).toHaveLength(4);
    expect(post({ aktion: 'lager', schluessel: S }).bewegungen).toEqual([]);
  });
});

test.describe('Schnittstelle: Instagram, Sonstiges, Rechnung nachtragen, Storno', () => {
  test('Instagram: eigener Kanal, Plattform „instagram“, Lager aus Markt & Webshop', async () => {
    const pos = [{ variante: 'Party', farbe: 'Rosa', groesse: 'Mini', pers: 'ELLY', sku: 'KR-PARTY-ROSA-MI' }];
    const { post, serien } = umgebung([], S, { serienliste: SARAS_LISTE() });
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Instagram', positionen: pos, preis: 15, kunde: 'Insta', direkt: true, seriennummern: ['MK-2026-310'] });
    expect(r.bestellung).toMatchObject({ kanal: 'Instagram', status: 'Versendet' });
    expect(serien[3].slice(0, 2)).toEqual(['MK-2026-310', 'instagram']);
    expect(post({ aktion: 'lager', schluessel: S }).bestand['KR-PARTY-ROSA-MI']).toEqual({ 'Markt & Webshop': -1 });
  });

  test('Sonstiges: freie Bezeichnung ohne Artikelnummer, Kommas zerstören die Positionen nicht', async () => {
    const { post } = umgebung([], S);
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Markt', preis: 8,
      positionen: [{ variante: 'Leine, rosa | Glitzer', farbe: '', groesse: '', pers: '', sku: '' }] });
    expect(r.ok).toBe(true);
    expect(r.bestellung.variante).toBe('Leine / rosa / Glitzer');
    expect(post({ aktion: 'lager', schluessel: S }).bewegungen).toEqual([]);
  });

  test('Rechnungsnummer nachtragen: in der Bestellung und in Saras Liste', async () => {
    const { post, serien, daten } = umgebung([ZWEI_KRONEN], S, { serienliste: SARAS_LISTE() });
    post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: ['MK-2026-310', 'MK-2026-311'] });
    const r = post({ aktion: 'rechnung', schluessel: S, nr: 'KW-20261001-003', rechnungsnr: 'RE-2026-0050' });
    expect(r).toMatchObject({ ok: true, bestellung: { rechnungsnr: 'RE-2026-0050' } });
    expect(daten[1][spalte(daten, 'Rechnungsnr.')]).toBe('RE-2026-0050');
    const re = serien[0].indexOf('Rechnungsnr.');
    expect(serien[3][re]).toBe('RE-2026-0050');
    expect(serien[4][re]).toBe('RE-2026-0050');
    expect(serien[1][re] || '').toBe('');                               // fremde Zeilen bleiben unberührt
    expect(post({ aktion: 'rechnung', schluessel: 'falsch', nr: 'KW-20261001-003', rechnungsnr: 'X' }).ok).toBe(false);
  });

  test('Storno vermerkt „storniert“ in Saras Liste, Zurücksetzen löscht den Hinweis wieder', async () => {
    const { post, serien } = umgebung([ZWEI_KRONEN], S, { serienliste: SARAS_LISTE() });
    post({ aktion: 'versenden', schluessel: S, nr: 'KW-20261001-003', sendungsnummer: '', mail: false, seriennummern: ['MK-2026-310', 'MK-2026-311'] });
    const r = post({ aktion: 'status', schluessel: S, nr: 'KW-20261001-003', status: 'Storniert', mail: false });
    expect(r).toMatchObject({ ok: true, serienFehler: false });
    const h = serien[0].indexOf('Hinweis');
    expect(h).toBeGreaterThan(5);
    expect(serien[3][h]).toBe('storniert 07.11.2026');
    expect(serien[4][h]).toBe('storniert 07.11.2026');
    expect(serien[3][0]).toBe('MK-2026-310');                           // Nummer bleibt vergeben
    post({ aktion: 'status', schluessel: S, nr: 'KW-20261001-003', status: 'Versendet', mail: false });
    expect(serien[3][h]).toBe('');
  });
});

test.describe('Schnittstelle: Spende', () => {
  const pos = [{ variante: 'Party', farbe: 'Rosa', groesse: 'Mini', pers: 'LUNA', sku: 'KR-PARTY-ROSA-MI' }];
  test('kein Umsatz (immer 0 €), Lager abgebucht, MK-Nummer mit Plattform „spende“, ohne Sendung = übergeben', async () => {
    const { post, serien } = umgebung([], S, { serienliste: SARAS_LISTE() });
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Spende', zahlung: 'Keine (Spende)', positionen: pos, preis: 15, kunde: 'Tierheim Bruchsal',
      direkt: true, seriennummern: ['MK-2026-310'] });
    expect(r.bestellung).toMatchObject({ kanal: 'Spende', preis: 0, status: 'Übergeben', sendungsnummer: '' });
    expect(serien[3].slice(0, 2)).toEqual(['MK-2026-310', 'spende']);
    expect(post({ aktion: 'lager', schluessel: S }).bestand['KR-PARTY-ROSA-MI']).toEqual({ 'Markt & Webshop': -1 });
  });

  test('mit Sendungsnummer: versendet', async () => {
    const { post } = umgebung([], S);
    const r = post({ aktion: 'anlegen', schluessel: S, kanal: 'Spende', positionen: pos, preis: 0, kunde: 'Gewinnerin', direkt: true, sendungsnummer: '00340434123456789012' });
    expect(r.bestellung).toMatchObject({ preis: 0, status: 'Versendet', sendungsnummer: '00340434123456789012' });
  });
});

test.describe('Schnittstelle: GitHub und Cloudinary über das Apps Script (1.8)', () => {
  const crypto = require('crypto');
  test('ping meldet, ob die Zugänge eingerichtet sind', async () => {
    expect(umgebung([], S).post({ aktion: 'ping', schluessel: S })).toMatchObject({ github: 'fehlt', cloudinary: 'fehlt' });
    expect(umgebung([], S, { github: {}, cloudinary: true }).post({ aktion: 'ping', schluessel: S })).toMatchObject({ github: 'eingerichtet', cloudinary: 'eingerichtet' });
  });

  test('lesen: mehrere Dateien auf einmal, Umlaute bleiben heil, fehlende Datei = null', async () => {
    const { post } = umgebung([], S, { github: { dateien: { 'katalog.json': '{"name":"Größe – Grün"}', 'medien.json': '{}' } } });
    const r = post({ aktion: 'github', schluessel: S, art: 'lesen', pfade: ['katalog.json', 'medien.json', 'galerie.json'] });
    expect(r).toMatchObject({ ok: true, dateien: { 'katalog.json': { inhalt: '{"name":"Größe – Grün"}', sha: 'sha-katalog.json' }, 'medien.json': { inhalt: '{}' }, 'galerie.json': null } });
  });

  test('schreiben: mit aktueller sha, nur gültiges JSON, nur erlaubte Dateien', async () => {
    const { post, github } = umgebung([], S, { github: { dateien: { 'galerie.json': '[]' } } });
    expect(post({ aktion: 'github', schluessel: S, art: 'schreiben', pfad: 'galerie.json', inhalt: '[{"titel":"Mädchen"}]', nachricht: 'Admin: Galerie' }).ok).toBe(true);
    expect(github.gespeichert).toEqual([{ datei: 'galerie.json', nachricht: 'Admin: Galerie', inhalt: '[{"titel":"Mädchen"}]' }]);
    expect(post({ aktion: 'github', schluessel: S, art: 'schreiben', pfad: 'medien.json', inhalt: '{}' }).ok).toBe(true);   // neue Datei
    for (const pfad of ['index.html', 'config.js', '../katalog.json', 'apps-script/Code.gs']) {
      expect(post({ aktion: 'github', schluessel: S, art: 'schreiben', pfad, inhalt: '{}' }).fehler).toBe('datei_nicht_erlaubt');
      expect(post({ aktion: 'github', schluessel: S, art: 'lesen', pfade: [pfad] }).fehler).toBe('datei_nicht_erlaubt');
    }
    expect(post({ aktion: 'github', schluessel: S, art: 'schreiben', pfad: 'katalog.json', inhalt: '{kaputt' }).fehler).toBe('ungueltiger_inhalt');
    expect(github.gespeichert).toHaveLength(2);
  });

  test('ohne Admin-Schlüssel oder ohne Token geht nichts; abgelaufenes Token wird klar gemeldet', async () => {
    const mit = umgebung([], S, { github: { dateien: { 'katalog.json': '{}' } } });
    expect(mit.post({ aktion: 'github', schluessel: 'falsch', art: 'lesen', pfade: ['katalog.json'] })).toMatchObject({ ok: false, fehler: 'nicht_erlaubt' });
    expect(umgebung([], S).post({ aktion: 'github', schluessel: S, art: 'lesen', pfade: ['katalog.json'] }).fehler).toBe('github_fehlt');
    expect(umgebung([], S, { github: { falsch: true } }).post({ aktion: 'github', schluessel: S, art: 'lesen', pfade: ['katalog.json'] }).fehler).toBe('github_token_ungueltig');
  });

  test('Verlauf der letzten Speicherungen', async () => {
    const r = umgebung([], S, { github: {} }).post({ aktion: 'github', schluessel: S, art: 'verlauf' });
    expect(r.verlauf).toEqual([{ text: 'Admin: Preise aktualisiert', datum: '2026-11-13T10:00:00Z' }]);
  });

  test('Cloudinary: gültige Unterschrift, Secret verlässt das Skript nie, nur erlaubte Parameter', async () => {
    const { post } = umgebung([], S, { cloudinary: true });
    const r = post({ aktion: 'cloudinary', schluessel: S, params: { public_id: 'party-rosa', overwrite: 'true', invalidate: 'true' } });
    expect(r).toMatchObject({ ok: true, cloud: 'dw6amyijc', api_key: 'CL-KEY', params: { public_id: 'party-rosa', overwrite: 'true', invalidate: 'true' } });
    const text = Object.keys(r.params).sort().map(k => k + '=' + r.params[k]).join('&') + 'CL-SECRET';
    expect(r.signature).toBe(crypto.createHash('sha1').update(text).digest('hex'));
    expect(JSON.stringify(r)).not.toContain('CL-SECRET');
    expect(post({ aktion: 'cloudinary', schluessel: S, params: { public_id: 'x', type: 'private' } }).fehler).toBe('parameter_nicht_erlaubt');
    expect(post({ aktion: 'cloudinary', schluessel: S, params: { public_id: '../x y' } }).fehler).toBe('ungueltige_id');
    expect(umgebung([], S).post({ aktion: 'cloudinary', schluessel: S, params: { public_id: 'x' } }).fehler).toBe('cloudinary_fehlt');
  });
});

test.describe('Schnittstelle: Etsy (ab 1.9)', () => {
  const JETZT = Math.floor(Date.now() / 1000);
  const receipt = (id, extra = {}) => Object.assign({
    receipt_id: id, status: 'paid', name: 'Erika Etsy', buyer_email: '', created_timestamp: JETZT + 60,
    formatted_address: 'Erika Etsy\nHundeweg 3\n76131 Karlsruhe\nDeutschland',
    grandtotal: { amount: 1500, divisor: 100, currency_code: 'EUR' },
    transactions: [{ title: 'Personalisierte handgemachte Hundekrone, individuelle Krone, perfekt für Geburtstag, blau', quantity: 1, sku: '',
      variations: [{ formatted_name: 'Größe', formatted_value: 'Groß' }, { formatted_name: 'Personalisierung', formatted_value: 'BELLO' }] }]
  }, extra);
  // Anmeldung wie in der Admin-Seite: Start → Etsy schickt Code + state zurück → Code einlösen
  const verbinden = u => {
    const start = u.post({ aktion: 'etsyStart', schluessel: S });
    const state = new URL(start.url).searchParams.get('state');
    return u.post({ aktion: 'etsyCode', schluessel: S, code: 'CODE', state });
  };
  const etsyAb = u => { u.props.ETSY_AB = String(JETZT); };

  test('ping meldet den Stand: fehlt → eingerichtet → verbunden', async () => {
    expect(umgebung([]).post({ aktion: 'ping', schluessel: S }).etsy).toBe('fehlt');
    const u = umgebung([], S, { etsy: {} });
    expect(u.post({ aktion: 'ping', schluessel: S }).etsy).toBe('eingerichtet');
    expect(verbinden(u)).toMatchObject({ ok: true, etsy: 'verbunden', shop: '4711' });
    expect(u.post({ aktion: 'ping', schluessel: S }).etsy).toBe('verbunden');
  });

  test('Anmeldeadresse: PKCE, nur Leserechte, Rückkehr zur Admin-Seite; das Secret steht nie darin', async () => {
    const u = umgebung([], S, { etsy: {} });
    const url = new URL(u.post({ aktion: 'etsyStart', schluessel: S }).url);
    expect(url.origin + url.pathname).toBe('https://www.etsy.com/oauth/connect');
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({ response_type: 'code', client_id: 'ETSY-KEY', redirect_uri: 'https://kronenwelt.de/admin.html',
      scope: 'transactions_r shops_r', code_challenge_method: 'S256' });
    expect(q.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.href).not.toContain('ETSY-SECRET');
    // Der Prüfwert wird beim Einlösen mitgeschickt und passt zur Challenge
    u.post({ aktion: 'etsyCode', schluessel: S, code: 'CODE', state: q.state });
    const gesendet = u.abrufe.find(a => a.url.endsWith('/public/oauth/token')).opt.payload;
    expect(gesendet).toMatchObject({ grant_type: 'authorization_code', code: 'CODE', redirect_uri: 'https://kronenwelt.de/admin.html' });
    expect(require('crypto').createHash('sha256').update(gesendet.code_verifier).digest('base64url')).toBe(q.code_challenge);
  });

  test('falscher oder fehlender state: nichts wird eingelöst', async () => {
    const u = umgebung([], S, { etsy: {} });
    u.post({ aktion: 'etsyStart', schluessel: S });
    for (const state of ['FALSCH', undefined]) {
      expect(u.post({ aktion: 'etsyCode', schluessel: S, code: 'CODE', state })).toMatchObject({ ok: false, fehler: 'etsy_anmeldung_abgelaufen' });
    }
    expect(u.abrufe.some(a => a.url.includes('etsy.com'))).toBe(false);
    expect(u.post({ aktion: 'ping', schluessel: S }).etsy).toBe('eingerichtet');
  });

  test('ohne Admin-Schlüssel, ohne Zugang oder ohne Verbindung geht nichts', async () => {
    const u = umgebung([], S, { etsy: {} });
    expect(u.post({ aktion: 'etsyStart', schluessel: 'FALSCH' })).toEqual({ ok: false, fehler: 'nicht_erlaubt' });
    expect(u.post({ aktion: 'etsyAbruf', schluessel: S })).toMatchObject({ ok: false, fehler: 'etsy_nicht_verbunden' });
    expect(umgebung([]).post({ aktion: 'etsyStart', schluessel: S })).toMatchObject({ ok: false, fehler: 'etsy_fehlt' });
  });

  test('Etsy lehnt die Anmeldung ab: klare Meldung, nicht verbunden', async () => {
    const u = umgebung([], S, { etsy: { falsch: true } });
    expect(verbinden(u)).toMatchObject({ ok: false, fehler: 'etsy_anmeldung' });
    expect(u.post({ aktion: 'ping', schluessel: S }).etsy).toBe('eingerichtet');
  });

  test('neue Bestellung ohne SKU: Etsy-Text, Größe und Name erkannt, kein Lager, Hinweis in der Notiz', async () => {
    const u = umgebung([BESTELLUNG], S, { etsy: { receipts: [receipt(111)] } });
    verbinden(u); etsyAb(u);
    const r = u.post({ aktion: 'etsyAbruf', schluessel: S });
    expect(r).toMatchObject({ ok: true, neu: 1 });
    const b = u.post({ aktion: 'bestellungen', schluessel: S }).bestellungen[0];
    expect(b).toMatchObject({ kanal: 'Etsy', status: 'Neu', zahlung: 'Etsy', preis: 15, kunde: 'Erika Etsy', plattformNr: '111',
      groesse: 'Gross', personalisierung: 'BELLO', artikel: '', kiste: 'nicht vom Lager',
      adresse: 'Hundeweg 3, 76131 Karlsruhe, Deutschland' });
    expect(b.variante).not.toContain(',');                       // Kommas im Etsy-Titel dürfen die Positionen nicht zerlegen
    expect(b.variante.length).toBeLessThanOrEqual(60);
    expect(b.notiz).toContain('noch nicht dem Katalog zugeordnet');
    expect(u.blatt('Lagerbewegungen')).toBeUndefined();
  });

  test('mit unserer Artikelnummer als SKU: Krone aus dem Katalog, Lager aus der Etsy-Kiste abgebucht', async () => {
    const t = { title: 'Egal', quantity: 2, sku: 'KR-PARTY-ROSA-GR', variations: [{ formatted_name: 'Personalization', formatted_value: 'LUNA' }] };
    const u = umgebung([], S, { etsy: { receipts: [receipt(222, { transactions: [t], grandtotal: { amount: 3000, divisor: 100 } })] } });
    verbinden(u); etsyAb(u);
    u.post({ aktion: 'etsyAbruf', schluessel: S });
    const b = u.post({ aktion: 'bestellungen', schluessel: S }).bestellungen[0];
    expect(b).toMatchObject({ variante: 'Party, Party', farbe: 'Rosa mit Punkten, Rosa mit Punkten', groesse: 'Gross, Gross',
      personalisierung: 'LUNA | LUNA', artikel: 'KR-PARTY-ROSA-GR, KR-PARTY-ROSA-GR', kiste: 'Etsy', preis: 30, notiz: '' });
    const lager = u.blatt('Lagerbewegungen');
    const z = lager.find(x => x.includes('KR-PARTY-ROSA-GR'));
    expect(z[lager[0].indexOf('Kiste')]).toBe('Etsy');
    expect(z[lager[0].indexOf('Menge')]).toBe(-2);
  });

  test('Zahlenkrone: Etsy-SKU mit Farbe wird zur Lager-Nummer (BASIS), Farbe bleibt erhalten', async () => {
    const t = { title: 'Zahlenkrone', quantity: 1, sku: 'KR-ZKLASSIK-MINT-KL', variations: [] };
    const u = umgebung([], S, { etsy: { receipts: [receipt(333, { transactions: [t] })] } });
    verbinden(u); etsyAb(u);
    u.post({ aktion: 'etsyAbruf', schluessel: S });
    expect(u.post({ aktion: 'bestellungen', schluessel: S }).bestellungen[0])
      .toMatchObject({ variante: 'Zahlenkrone Klassik', farbe: 'Mint', groesse: 'Klein', artikel: 'KR-ZKLASSIK-BASIS-KL' });
  });

  test('jede Etsy-Bestellung nur einmal – auch wenn Sara sie schon von Hand mit Plattform-Nr. eingetragen hat', async () => {
    const kopf = KOPF.concat(['Status', 'Kanal', 'Plattform-Nr.']);
    const vonHand = ['07.11.2026', '09:00', 'KW-20261107-001', 'Party', 'Blau', 'Gross', 'REX', 15, 'Etsy', 'Erika Etsy', '', '', 'Neu', 'Etsy', '111'];
    const u = umgebung([vonHand], S, { kopf, etsy: { receipts: [receipt(111), receipt(112)] } });
    verbinden(u); etsyAb(u);
    expect(u.post({ aktion: 'etsyAbruf', schluessel: S }).neu).toBe(1);
    expect(u.post({ aktion: 'etsyAbruf', schluessel: S }).neu).toBe(0);
    expect(u.post({ aktion: 'bestellungen', schluessel: S }).bestellungen.map(b => b.plattformNr)).toEqual(['112', '111']);
  });

  test('nur Bestellungen ab dem Verbinden; stornierte werden übersprungen; mehrere Seiten werden gelesen', async () => {
    const liste = [receipt(1, { created_timestamp: JETZT - 86400 }), receipt(2, { status: 'canceled' }), receipt(3), receipt(4, { created_timestamp: JETZT + 30 })];
    const u = umgebung([], S, { etsy: { receipts: liste, seite: 1 } });
    verbinden(u); etsyAb(u);
    expect(u.post({ aktion: 'etsyAbruf', schluessel: S }).neu).toBe(2);
    // älteste zuerst in der Tabelle → in der Liste (neueste zuerst) steht 3 vor 4
    expect(u.post({ aktion: 'bestellungen', schluessel: S }).bestellungen.map(b => b.plattformNr)).toEqual(['3', '4']);
  });

  test('abgelaufenes Zugriffs-Token wird mit dem Erneuerungs-Token erneuert', async () => {
    const etsy = { receipts: [receipt(5)] };
    const u = umgebung([], S, { etsy });
    verbinden(u); etsyAb(u);
    const t = JSON.parse(u.props.ETSY_TOKEN); t.bis = Date.now() - 1000; u.props.ETSY_TOKEN = JSON.stringify(t);
    expect(u.post({ aktion: 'etsyAbruf', schluessel: S }).neu).toBe(1);
    expect(etsy.tokenAbrufe.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'ETSY-RT-1' });
    expect(JSON.parse(u.props.ETSY_TOKEN).refresh).toBe('ETSY-RT-2');
  });

  test('Erneuerung abgelehnt (z. B. nach 90 Tagen): Verbindung gilt als getrennt, klare Meldung', async () => {
    const etsy = {};
    const u = umgebung([], S, { etsy });
    verbinden(u);
    const t = JSON.parse(u.props.ETSY_TOKEN); t.bis = 0; u.props.ETSY_TOKEN = JSON.stringify(t);
    etsy.falsch = true;
    expect(u.post({ aktion: 'etsyAbruf', schluessel: S })).toMatchObject({ ok: false, fehler: 'etsy_anmeldung' });
    expect(u.post({ aktion: 'ping', schluessel: S }).etsy).toBe('eingerichtet');
  });

  test('Zeitplan-Abruf: übernimmt Bestellungen, verschluckt Fehler, tut ohne Verbindung nichts', async () => {
    const etsy = { receipts: [receipt(6)] };
    const u = umgebung([], S, { etsy });
    u.ctx.etsyAutomatisch();                                     // noch nicht verbunden
    expect(u.abrufe.length).toBe(0);
    verbinden(u); etsyAb(u);
    u.ctx.etsyAutomatisch();
    expect(u.daten.length).toBe(2);
    etsy.abgelaufen = true;
    expect(() => u.ctx.etsyAutomatisch()).not.toThrow();
  });

  // ---- Blatt „Etsy-Artikel“ (1.10) ----
  const KRONE = 'Personalisierte handgemachte Hundekrone, individuelle Krone, perfekt für Geburtstag und Fotoshooting mit Hund, ';
  const artikel = (id, titel, preis) => ({ listing_id: id, title: titel, price: { amount: preis * 100, divisor: 100, currency_code: 'EUR' } });
  const LISTE = [artikel(11, KRONE + 'berry', 12), artikel(12, KRONE + 'rosa', 12), artikel(13, KRONE + 'rosa', 14),
    artikel(14, KRONE + 'blau', 12), artikel(15, KRONE + 'blau', 12), artikel(16, KRONE + 'blau', 14),
    artikel(17, 'Krone mit Leo Muster, Hundekrone, Geburtstag', 14), artikel(18, 'Nikolausmütze, Weihnachtsmütze, Hundemütze,  personalisiert', 14),
    artikel(19, 'Handgemachte Hundekrone Leo,  mit austauschbaren Zahlen nach Wahl,  perfekt für Geburtstag und Fotoshooting mit Hund', 18)];
  const zeile = (u, id) => { const b = u.blatt('Etsy-Artikel'); const z = b.find(x => x[0] === String(id)); return z && { krone: z[3], farbe: z[4], hinweis: z[5] }; };
  const position = (id, titel, variations, extra = {}) => Object.assign({ listing_id: id, title: titel, quantity: 1, sku: '', variations }, extra);

  test('Abgleich legt je Etsy-Artikel eine Zeile an; Vorschläge nur, wo Titel (und Preis) eindeutig sind', async () => {
    const u = umgebung([], S, { etsy: { listings: LISTE, seite: 4 } });
    verbinden(u);
    expect(u.post({ aktion: 'etsyArtikel', schluessel: S })).toEqual({ ok: true, neu: 9, gesamt: 9, offen: 3 });
    expect(u.blatt('Etsy-Artikel')[0]).toEqual(['Etsy-Nr.', 'Titel', 'Preis (€)', 'Krone', 'Farbe', 'Hinweis']);
    expect(zeile(u, 11)).toMatchObject({ krone: 'Einfarbig', farbe: 'Berry' });
    expect(zeile(u, 12)).toMatchObject({ krone: 'Party', farbe: 'Rosa mit Punkten' });      // rosa für 12 €
    expect(zeile(u, 13)).toMatchObject({ krone: 'Edel & Wild', farbe: 'Rosa' });            // rosa für 14 €
    expect(zeile(u, 14)).toMatchObject({ krone: '', farbe: '' });                           // blau für 12 € gibt es zweimal: kein Vorschlag
    expect(zeile(u, 15).hinweis).toContain('Bitte Krone und Farbe eintragen');
    expect(zeile(u, 16)).toMatchObject({ krone: 'Glitzer', farbe: 'Blau' });
    expect(zeile(u, 18)).toMatchObject({ krone: '' });                                      // nicht im Katalog
  });

  test('zweiter Abgleich: nichts doppelt, Eingetragenes bleibt, neue Etsy-Artikel kommen dazu', async () => {
    const etsy = { listings: LISTE.slice(0, 5) };
    const u = umgebung([], S, { etsy });
    verbinden(u);
    u.post({ aktion: 'etsyArtikel', schluessel: S });
    const b = u.blatt('Etsy-Artikel');
    b.find(x => x[0] === '14')[3] = 'Einfarbig'; b.find(x => x[0] === '14')[4] = 'Blau';     // Sara trägt ein
    etsy.listings = LISTE;
    expect(u.post({ aktion: 'etsyArtikel', schluessel: S })).toEqual({ ok: true, neu: 4, gesamt: 9, offen: 2 });
    expect(zeile(u, 14)).toMatchObject({ krone: 'Einfarbig', farbe: 'Blau' });
    expect(b.filter(x => x[0] === '14').length).toBe(1);
  });

  test('Bestellung zu einem zugeordneten Etsy-Artikel: Krone aus dem Katalog, Lager aus der Etsy-Kiste', async () => {
    const t = position(11, KRONE + 'berry', [{ formatted_name: 'Größe', formatted_value: 'Extra mini' }, { formatted_name: 'Personalisierung', formatted_value: 'BELLO' }]);
    const u = umgebung([], S, { etsy: { listings: LISTE, receipts: [receipt(501, { transactions: [t] })] } });
    verbinden(u); etsyAb(u);
    u.post({ aktion: 'etsyArtikel', schluessel: S });
    u.post({ aktion: 'etsyAbruf', schluessel: S });
    expect(u.post({ aktion: 'bestellungen', schluessel: S }).bestellungen[0]).toMatchObject({ variante: 'Einfarbig', farbe: 'Berry',
      groesse: 'Extra Mini', personalisierung: 'BELLO', artikel: 'KR-UNI-BERRY-XM', kiste: 'Etsy', notiz: '' });
    const lager = u.blatt('Lagerbewegungen');
    expect(lager.find(x => x.includes('KR-UNI-BERRY-XM'))[lager[0].indexOf('Menge')]).toBe(-1);
  });

  test('Farbe hängt von der Etsy-Variante ab (Leo Muster); Zahlenkrone: Lager-Nummer BASIS, Pet-Anzahl bleibt lesbar', async () => {
    const leo = position(17, 'Krone mit Leo Muster, Hundekrone, Geburtstag', [{ formatted_name: 'Größe', formatted_value: 'Klein' }, { formatted_name: 'Leo Muster', formatted_value: 'Großes Muster' }]);
    const zahl = position(19, LISTE[8].title, [{ formatted_name: 'Größe und Anzahl der Zahlenpets', formatted_value: 'Groß + 6 Pet' }, { formatted_name: 'Farbe der Pets', formatted_value: 'Schwarz/Zahlen gold' }]);
    const u = umgebung([], S, { etsy: { listings: LISTE, receipts: [receipt(502, { transactions: [leo, zahl] })] } });
    verbinden(u); etsyAb(u);
    u.post({ aktion: 'etsyArtikel', schluessel: S });
    u.post({ aktion: 'etsyAbruf', schluessel: S });
    const b = u.post({ aktion: 'bestellungen', schluessel: S }).bestellungen[0];
    expect(b).toMatchObject({ variante: 'Edel & Wild, Zahlenkrone Leo', farbe: 'Leopard, Schwarz / Zahlen gold', groesse: 'Klein, Gross + 6 Pet', kiste: 'Etsy' });
    expect(b.artikel).toBe('KR-EDEL-LEOPARD-KL, ' + b.artikel.split(', ')[1]);
    expect(b.artikel.split(', ')[1]).toMatch(/^KR-[A-Z]+-[A-Z]+-GR$/);
  });

  test('Krone im Blatt, aber Farbe noch nicht im Katalog (Edel & Wild Rosa): Name steht richtig da, Lager bucht nicht', async () => {
    const t = position(13, KRONE + 'rosa', [{ formatted_name: 'Größe', formatted_value: 'Mini' }]);
    const u = umgebung([], S, { etsy: { listings: LISTE, receipts: [receipt(503, { transactions: [t] })] } });
    verbinden(u); etsyAb(u);
    u.post({ aktion: 'etsyArtikel', schluessel: S });
    u.post({ aktion: 'etsyAbruf', schluessel: S });
    expect(u.post({ aktion: 'bestellungen', schluessel: S }).bestellungen[0]).toMatchObject({ variante: 'Edel & Wild', farbe: 'Rosa', groesse: 'Mini', artikel: '', kiste: 'nicht vom Lager' });
    expect(u.blatt('Lagerbewegungen')).toBeUndefined();
  });

  test('freie Bezeichnung im Blatt (nicht im Katalog) steht in der Bestellung; unbekannter Etsy-Artikel wird im Blatt nachgetragen', async () => {
    const muetze = position(18, LISTE[7].title, [{ formatted_name: 'Größe', formatted_value: 'Groß' }, { formatted_name: 'Farbe', formatted_value: 'Rot' }]);
    const fremd = position(99, 'Ganz neuer Artikel, noch nie gesehen', []);
    const u = umgebung([], S, { etsy: { listings: LISTE, receipts: [receipt(504, { transactions: [muetze, fremd] })] } });
    verbinden(u); etsyAb(u);
    u.post({ aktion: 'etsyArtikel', schluessel: S });
    u.blatt('Etsy-Artikel').find(x => x[0] === '18')[3] = 'Nikolausmütze';
    u.post({ aktion: 'etsyAbruf', schluessel: S });
    const b = u.post({ aktion: 'bestellungen', schluessel: S }).bestellungen[0];
    expect(b.variante).toBe('Nikolausmütze, Ganz neuer Artikel / noch nie gesehen');
    expect(b.farbe).toMatch(/^Rot,/);
    expect(zeile(u, 99)).toMatchObject({ krone: '', hinweis: expect.stringContaining('Bitte Krone') });
  });

  test('Trennen löscht die Tokens, der Zugang bleibt eingetragen', async () => {
    const u = umgebung([], S, { etsy: {} });
    verbinden(u);
    expect(u.post({ aktion: 'etsyTrennen', schluessel: S })).toEqual({ ok: true, etsy: 'eingerichtet' });
    expect(u.props.ETSY_TOKEN).toBe('');
  });
});
