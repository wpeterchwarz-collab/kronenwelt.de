// Kronenwelt-Schnittstelle (apps-script/Code.gs): läuft in Google Apps Script.
// Hier wird sie mit nachgestellter Tabelle und nachgestellten Google-Diensten geprüft.
const { test, expect } = require('@playwright/test');
const { umgebung } = require('./schnittstelle-attrappe');

const BESTELLUNG = ['08.04.2026', '21:49', 'KW-20260408-000', 'Party', 'Rosa mit Punkten', 'Gross', 'TEST', 0.01, 'PayPal',
  'Peter Schwarz', 'p@example.de', 'Weg 8, 75045 Walzbachtal, DE'];
const SUMMENZEILE = ['', '', '', '', '', '', '', 0.01, '', '', '', ''];
const ZWEI_KRONEN = ['01.10.2026', '12:12', 'KW-20261001-003', 'Einfarbig, Glitzer', 'Grün, Blau', 'Extra Mini, Gross',
  'FRIDOLIN | ohne Namen', 29, 'PayPal', 'Kim Muster', 'k@example.de', 'Moorblick 4, 24329 Dannau, DE'];

test.describe('Schnittstelle (Apps Script)', () => {
  test('ohne oder mit falschem Schlüssel gibt es keine Bestellungen', async () => {
    const { post } = umgebung([BESTELLUNG]);
    expect(post({ aktion: 'bestellungen' })).toEqual({ ok: false, fehler: 'nicht_erlaubt' });
    expect(post({ aktion: 'bestellungen', schluessel: 'FALSCH' })).toEqual({ ok: false, fehler: 'nicht_erlaubt' });
    expect(post({ aktion: 'bestellungen', schluessel: 'GEHEIM12' })).toEqual({ ok: false, fehler: 'nicht_erlaubt' });
  });

  test('ohne eingerichteten Schlüssel ist alles gesperrt', async () => {
    const { post } = umgebung([BESTELLUNG], null);
    expect(post({ aktion: 'ping', schluessel: '' }).ok).toBe(false);
    expect(post({ aktion: 'ping', schluessel: 'null' }).ok).toBe(false);
  });

  test('ping meldet Version und Tabelle', async () => {
    const { post } = umgebung([]);
    expect(post({ aktion: 'ping', schluessel: 'GEHEIM123' })).toMatchObject({ ok: true, tabelle: 'Kronenwelt Bestellungen' });
  });

  test('Bestellungen: neueste zuerst, Summenzeile übersprungen, Preis als Zahl', async () => {
    const { post } = umgebung([BESTELLUNG, SUMMENZEILE, ZWEI_KRONEN]);
    const r = post({ aktion: 'bestellungen', schluessel: 'GEHEIM123' });
    expect(r.ok).toBe(true);
    expect(r.bestellungen.map(b => b.nr)).toEqual(['KW-20261001-003', 'KW-20260408-000']);
    expect(r.bestellungen[0]).toMatchObject({
      zeile: 4, datum: '01.10.2026', kunde: 'Kim Muster', preis: 29,
      variante: 'Einfarbig, Glitzer', personalisierung: 'FRIDOLIN | ohne Namen'
    });
    expect(r.bestellungen[1].preis).toBe(0.01);
  });

  test('Bestellungen aus dem Shop werden wie bisher gespeichert (ohne Schlüssel)', async () => {
    const { post, daten } = umgebung([BESTELLUNG]);
    const r = post({ variante: 'Glitzer', farbe: 'Blau', groesse: 'Gross', hundename: 'LUNA', preis: '17,00',
      kunde_name: 'A B', kunde_email: 'a@b.de', lieferadresse: 'X 1' });
    expect(r.success).toBe(true);
    expect(daten.at(-1).slice(3, 9)).toEqual(['Glitzer', 'Blau', 'Gross', 'LUNA', 17, 'PayPal']);
  });

  test('unbekannte Aktion wird abgelehnt', async () => {
    const { post } = umgebung([]);
    expect(post({ aktion: 'loeschen', schluessel: 'GEHEIM123' })).toEqual({ ok: false, fehler: 'unbekannte_aktion' });
  });
});
