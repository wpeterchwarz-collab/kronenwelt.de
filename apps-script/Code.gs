/* ============================================================
   Kronenwelt-Schnittstelle (Google Apps Script, gehört zur Tabelle „Kronenwelt Bestellungen“)

   1) Der Shop schickt jede bezahlte Bestellung hierher → neue Zeile im Blatt „Bestellungen“
      (unverändert wie bisher, ohne Schlüssel).
   2) Die Admin-Seite fragt Daten ab, z. B. die Bestellliste. Das geht nur mit dem
      Admin-Schlüssel, der in den Skript-Eigenschaften steht (nie im Code, nie auf GitHub).

   Einrichten (einmalig):  Funktion „einrichten“ ausführen → Schlüssel aus dem Protokoll
   in die Admin-Seite (Einstellungen → Bestellungen) kopieren.
   Danach: Bereitstellen → Bereitstellungen verwalten → Bearbeiten → Neue Version.
   Die Adresse (…/exec) bleibt dabei gleich.

   Dieser Code liegt auch im GitHub-Repo (apps-script/Code.gs), damit Änderungen
   nachvollziehbar sind. Er enthält keine Geheimnisse.
   ============================================================ */

const SHEET_NAME = 'Bestellungen';
const SCHNITTSTELLE_VERSION = '1.1';
const SPALTEN = [
  'Datum', 'Uhrzeit', 'Bestellnr.',
  'Variante', 'Farbe', 'Grösse', 'Personalisierung',
  'Preis (€)', 'Zahlung',
  'Kundenname', 'E-Mail', 'Lieferadresse'
];

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return antwort({ success: false, error: 'Ungültige Anfrage' });
  }
  // Anfragen der Admin-Seite haben ein Feld „aktion“
  if (data && data.aktion) return adminAnfrage(data);
  return bestellungSpeichern(data);
}

function doGet(e) {
  return antwort({ error: 'GET not allowed' });
}

/* ---------------- 1) Bestellung aus dem Shop speichern (wie bisher) ---------------- */
function bestellungSpeichern(data) {
  try {
    const sheet = blatt();
    const now     = new Date();
    const datum   = Utilities.formatDate(now, 'Europe/Berlin', 'dd.MM.yyyy');
    const uhrzeit = Utilities.formatDate(now, 'Europe/Berlin', 'HH:mm');
    const lastRow = sheet.getLastRow();
    const bestellnr = 'KW-' + now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '-' +
      String(lastRow).padStart(3, '0');

    sheet.appendRow([
      datum, uhrzeit, bestellnr,
      data.variante      || '',
      data.farbe         || '',
      data.groesse       || '',
      data.hundename     || '',
      parseFloat(String(data.preis || '0').replace(',', '.')) || 0,
      data.zahlung       || 'PayPal',
      data.kunde_name    || '',
      data.kunde_email   || '',
      data.lieferadresse || ''
    ]);

    const newRow = sheet.getLastRow();
    if (newRow % 2 === 0) sheet.getRange(newRow, 1, 1, SPALTEN.length).setBackground('#fafaf8');
    sheet.getRange(newRow, 8).setNumberFormat('#,##0.00 €');

    return antwort({ success: true, bestellnr: bestellnr });
  } catch (err) {
    return antwort({ success: false, error: err.message });
  }
}

/* ---------------- 2) Anfragen der Admin-Seite ---------------- */
function adminAnfrage(data) {
  if (!schluesselOk(data.schluessel)) {
    Utilities.sleep(800);                                   // Ausprobieren von Schlüsseln bremsen
    return antwort({ ok: false, fehler: 'nicht_erlaubt' });
  }
  try {
    switch (data.aktion) {
      case 'ping':
        return antwort({ ok: true, version: SCHNITTSTELLE_VERSION, tabelle: SpreadsheetApp.getActiveSpreadsheet().getName() });
      case 'bestellungen':
        return antwort({ ok: true, version: SCHNITTSTELLE_VERSION, bestellungen: bestellungenLesen() });
      default:
        return antwort({ ok: false, fehler: 'unbekannte_aktion' });
    }
  } catch (err) {
    return antwort({ ok: false, fehler: 'fehler', text: err.message });
  }
}

// Alle Bestellungen, neueste zuerst. Zeilen ohne Bestellnummer (z. B. Summenzeile) werden übersprungen.
function bestellungenLesen() {
  const sheet = blatt();
  const zeilen = sheet.getLastRow();
  if (zeilen < 2) return [];
  const breite = Math.max(sheet.getLastColumn(), SPALTEN.length);
  const bereich = sheet.getRange(1, 1, zeilen, breite);
  const anzeige = bereich.getDisplayValues();
  const werte = bereich.getValues();
  const kopf = anzeige[0].map(function (k) { return String(k).trim(); });
  const spalte = function (name) { return kopf.indexOf(name); };
  const s = {
    datum: spalte('Datum'), uhrzeit: spalte('Uhrzeit'), nr: spalte('Bestellnr.'),
    variante: spalte('Variante'), farbe: spalte('Farbe'), groesse: spalte('Grösse'),
    pers: spalte('Personalisierung'), preis: spalte('Preis (€)'), zahlung: spalte('Zahlung'),
    name: spalte('Kundenname'), email: spalte('E-Mail'), adresse: spalte('Lieferadresse')
  };
  const liste = [];
  for (let i = 1; i < anzeige.length; i++) {
    const a = anzeige[i], w = werte[i];
    const nr = s.nr >= 0 ? String(a[s.nr]).trim() : '';
    if (!nr) continue;
    const preis = s.preis >= 0 && typeof w[s.preis] === 'number' ? w[s.preis]
      : parseFloat(String(s.preis >= 0 ? a[s.preis] : '0').replace(/[^\d,.-]/g, '').replace('.', '').replace(',', '.')) || 0;
    const feld = function (k) { return s[k] >= 0 ? String(a[s[k]]).trim() : ''; };
    liste.push({
      zeile: i + 1,
      datum: feld('datum'), uhrzeit: feld('uhrzeit'), nr: nr,
      variante: feld('variante'), farbe: feld('farbe'), groesse: feld('groesse'), personalisierung: feld('pers'),
      preis: Math.round(preis * 100) / 100, zahlung: feld('zahlung'),
      kunde: feld('name'), email: feld('email'), adresse: feld('adresse')
    });
  }
  return liste.reverse();
}

/* ---------------- Hilfsfunktionen ---------------- */
function blatt() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, SPALTEN.length).setValues([SPALTEN]);
    const header = sheet.getRange(1, 1, 1, SPALTEN.length);
    header.setBackground('#5a4538');
    header.setFontColor('#ffffff');
    header.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function schluesselOk(gesendet) {
  const richtig = PropertiesService.getScriptProperties().getProperty('ADMIN_SCHLUESSEL');
  if (!richtig || !gesendet || typeof gesendet !== 'string' || gesendet.length !== richtig.length) return false;
  let unterschied = 0;                                    // Vergleich in konstanter Zeit
  for (let i = 0; i < richtig.length; i++) unterschied |= richtig.charCodeAt(i) ^ gesendet.charCodeAt(i);
  return unterschied === 0;
}

function antwort(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* Einmalig im Editor ausführen: legt einen neuen Admin-Schlüssel an und zeigt ihn im Protokoll.
   Erneut ausführen = neuer Schlüssel, der alte gilt dann nicht mehr. */
function einrichten() {
  const zeichen = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let schluessel = '';
  const zufall = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, zufall + new Date().getTime());
  for (let i = 0; i < 32; i++) schluessel += zeichen.charAt((bytes[i] + 256) % zeichen.length);
  PropertiesService.getScriptProperties().setProperty('ADMIN_SCHLUESSEL', schluessel);
  Logger.log('Neuer Admin-Schlüssel (in die Admin-Seite unter Einstellungen → Bestellungen eintragen):');
  Logger.log(schluessel);
}

function testScript() {
  bestellungSpeichern({
    variante: 'Party', farbe: 'Rosa mit Punkten', groesse: 'Gross', hundename: 'MILA',
    preis: '15,00', zahlung: 'PayPal',
    kunde_name: 'Test Kunde', kunde_email: 'test@kronenwelt.de', lieferadresse: 'Musterstrasse 1, 76137 Karlsruhe, DE'
  });
  Logger.log('Testzeile erfolgreich eingetragen!');
}
