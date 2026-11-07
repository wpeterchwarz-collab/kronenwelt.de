// Kronenwelt-Schnittstelle (apps-script/Code.gs): läuft in Google Apps Script.
// Hier wird sie mit nachgestellter Tabelle und nachgestellten Google-Diensten geprüft.
const { test, expect } = require('@playwright/test');
const { umgebung, KOPF } = require('./schnittstelle-attrappe');

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
    expect(post({ aktion: 'ping', schluessel: S })).toMatchObject({ ok: true, version: '1.3', tabelle: 'Kronenwelt Bestellungen' });
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
    expect(daten[0].slice(12)).toEqual(['Status', 'Kanal', 'Sendungsnummer', 'Versendet am', 'Notiz', 'Artikelnr.', 'Kiste']);
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
