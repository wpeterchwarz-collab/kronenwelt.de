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
    expect(post({ aktion: 'ping', schluessel: S })).toMatchObject({ ok: true, version: '1.2', tabelle: 'Kronenwelt Bestellungen' });
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
    expect(daten[0].slice(12)).toEqual(['Status', 'Kanal', 'Sendungsnummer', 'Versendet am', 'Notiz']);
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
