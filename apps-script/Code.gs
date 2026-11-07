/* ============================================================
   Kronenwelt-Schnittstelle (Google Apps Script, gehört zur Tabelle „Kronenwelt Bestellungen“)

   1) Der Shop schickt jede bezahlte Bestellung hierher → neue Zeile im Blatt „Bestellungen“
      (ohne Schlüssel, wie bisher; neu: Status „Neu“, Kanal „Webshop“).
   2) Die Admin-Seite liest und ändert Bestellungen. Das geht nur mit dem Admin-Schlüssel,
      der in den Skript-Eigenschaften steht (nie im Code, nie auf GitHub).

   Einrichten (einmalig):  Funktion „einrichten“ ausführen → Schlüssel aus dem Protokoll
   in die Admin-Seite (Einstellungen → Bestellungen) kopieren.
   Nach jeder Code-Änderung: Bereitstellen → Bereitstellungen verwalten → Bearbeiten →
   Neue Version. Die Adresse (…/exec) bleibt dabei gleich.

   Spalten: Die ersten 12 Spalten sind seit Beginn gleich. Neue Spalten (Status, Kanal, …)
   werden rechts angehängt, sobald sie gebraucht werden. Nichts wird umbenannt oder gelöscht.

   Dieser Code liegt auch im GitHub-Repo (apps-script/Code.gs), damit Änderungen
   nachvollziehbar sind. Er enthält keine Geheimnisse.
   ============================================================ */

const SHEET_NAME = 'Bestellungen';
const SCHNITTSTELLE_VERSION = '1.2';
const SPALTEN = [
  'Datum', 'Uhrzeit', 'Bestellnr.',
  'Variante', 'Farbe', 'Grösse', 'Personalisierung',
  'Preis (€)', 'Zahlung',
  'Kundenname', 'E-Mail', 'Lieferadresse'
];
const ZUSATZ_SPALTEN = ['Status', 'Kanal', 'Sendungsnummer', 'Versendet am', 'Notiz'];
const STATUS = ['Neu', 'In Arbeit', 'Versendet', 'Übergeben', 'Storniert'];

// Absender der Versandmail (Antworten gehen an die Shop-Adresse)
const SHOP_NAME  = "Mila's Kronenwelt";
const SHOP_EMAIL = 'm.kronenwelt@gmail.com';
const SHOP_ADRESSE = 'Sternenstaubhandmade · Sara Schwarz · Vogesenweg 8 · 75045 Walzbachtal';
const DHL_LINK = 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=';

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

/* ---------------- 1) Bestellung aus dem Shop speichern ---------------- */
function bestellungSpeichern(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const sheet = blatt();
    const kopf = spaltenSicherstellen(sheet);
    const now = new Date();
    const nr = neueBestellnr(sheet, kopf, now);
    zeileAnhaengen(sheet, kopf, {
      'Datum': Utilities.formatDate(now, 'Europe/Berlin', 'dd.MM.yyyy'),
      'Uhrzeit': Utilities.formatDate(now, 'Europe/Berlin', 'HH:mm'),
      'Bestellnr.': nr,
      'Variante': data.variante || '',
      'Farbe': data.farbe || '',
      'Grösse': data.groesse || '',
      'Personalisierung': data.hundename || '',
      'Preis (€)': parseFloat(String(data.preis || '0').replace(',', '.')) || 0,
      'Zahlung': data.zahlung || 'PayPal',
      'Kundenname': data.kunde_name || '',
      'E-Mail': data.kunde_email || '',
      'Lieferadresse': data.lieferadresse || '',
      'Status': 'Neu',
      'Kanal': 'Webshop'
    });
    return antwort({ success: true, bestellnr: nr });
  } catch (err) {
    return antwort({ success: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- 2) Anfragen der Admin-Seite ---------------- */
function adminAnfrage(data) {
  if (!schluesselOk(data.schluessel)) {
    Utilities.sleep(800);                                   // Ausprobieren von Schlüsseln bremsen
    return antwort({ ok: false, fehler: 'nicht_erlaubt' });
  }
  const schreibt = ['status', 'versenden', 'anlegen'].indexOf(data.aktion) >= 0;
  const lock = LockService.getScriptLock();
  try {
    if (schreibt) lock.waitLock(20000);
    switch (data.aktion) {
      case 'ping':
        return antwort({ ok: true, version: SCHNITTSTELLE_VERSION, tabelle: SpreadsheetApp.getActiveSpreadsheet().getName() });
      case 'bestellungen':
        return antwort({ ok: true, version: SCHNITTSTELLE_VERSION, bestellungen: bestellungenLesen() });
      case 'status':
        return antwort(statusSetzen(data));
      case 'versenden':
        return antwort(versenden(data));
      case 'anlegen':
        return antwort(anlegen(data));
      default:
        return antwort({ ok: false, fehler: 'unbekannte_aktion' });
    }
  } catch (err) {
    return antwort({ ok: false, fehler: err.code || 'fehler', text: err.message });
  } finally {
    if (schreibt) lock.releaseLock();
  }
}

// Alle Bestellungen, neueste zuerst. Zeilen ohne Bestellnummer (z. B. Summenzeile) werden übersprungen.
function bestellungenLesen() {
  const sheet = blatt();
  const zeilen = sheet.getLastRow();
  if (zeilen < 2) return [];
  const kopf = kopfzeile(sheet);
  const breite = Math.max(kopf.length, 1);
  const bereich = sheet.getRange(1, 1, zeilen, breite);
  const anzeige = bereich.getDisplayValues();
  const werte = bereich.getValues();
  const liste = [];
  for (let i = 1; i < anzeige.length; i++) {
    const b = bestellungAusZeile(kopf, anzeige[i], werte[i], i + 1);
    if (b) liste.push(b);
  }
  return liste.reverse();
}

function bestellungAusZeile(kopf, a, w, zeile) {
  const feld = function (name) { const i = kopf.indexOf(name); return i >= 0 ? String(a[i] == null ? '' : a[i]).trim() : ''; };
  const nr = feld('Bestellnr.');
  if (!nr) return null;
  const pi = kopf.indexOf('Preis (€)');
  const preis = pi >= 0 && typeof w[pi] === 'number' ? w[pi]
    : parseFloat(feld('Preis (€)').replace(/[^\d,.-]/g, '').replace('.', '').replace(',', '.')) || 0;
  return {
    zeile: zeile,
    datum: feld('Datum'), uhrzeit: feld('Uhrzeit'), nr: nr,
    variante: feld('Variante'), farbe: feld('Farbe'), groesse: feld('Grösse'), personalisierung: feld('Personalisierung'),
    preis: Math.round(preis * 100) / 100, zahlung: feld('Zahlung'),
    kunde: feld('Kundenname'), email: feld('E-Mail'), adresse: feld('Lieferadresse'),
    status: feld('Status') || 'Neu', kanal: feld('Kanal') || 'Webshop',
    sendungsnummer: feld('Sendungsnummer'), versendetAm: feld('Versendet am'), notiz: feld('Notiz')
  };
}

// Status einer Bestellung ändern (Neu, In Arbeit, Versendet, Übergeben, Storniert)
function statusSetzen(data) {
  if (STATUS.indexOf(data.status) < 0) throw fehler('ungueltiger_status', 'Unbekannter Status');
  const sheet = blatt();
  const kopf = spaltenSicherstellen(sheet);
  const zeile = zeileFinden(sheet, kopf, data.zeile, data.nr);
  sheet.getRange(zeile, kopf.indexOf('Status') + 1).setValue(data.status);
  return { ok: true, bestellung: bestellungLesen(sheet, kopf, zeile) };
}

// Als versendet markieren, Sendungsnummer speichern, auf Wunsch Versandmail an den Kunden
function versenden(data) {
  const nummer = String(data.sendungsnummer || '').replace(/\s+/g, '').toUpperCase();
  if (nummer && !/^[A-Z0-9]{8,40}$/.test(nummer)) throw fehler('ungueltige_sendungsnummer', 'Sendungsnummer prüfen');
  const sheet = blatt();
  const kopf = spaltenSicherstellen(sheet);
  const zeile = zeileFinden(sheet, kopf, data.zeile, data.nr);
  const heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy');
  const setze = function (name, wert) { sheet.getRange(zeile, kopf.indexOf(name) + 1).setValue(wert); };
  setze('Sendungsnummer', nummer);
  setze('Versendet am', heute);
  setze('Status', 'Versendet');
  const b = bestellungLesen(sheet, kopf, zeile);
  let mail = false;
  if (data.mail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) throw fehler('keine_email', 'Keine gültige E-Mail-Adresse bei dieser Bestellung');
    sendeVersandmail(b);
    mail = true;
    setze('Notiz', (b.notiz ? b.notiz + ' · ' : '') + 'Versandmail ' + heute);
  }
  return { ok: true, mail: mail, bestellung: bestellungLesen(sheet, kopf, zeile) };
}

// Bestellung von Hand anlegen (Etsy, Amazon, Markt, …)
function anlegen(data) {
  const pos = Array.isArray(data.positionen) ? data.positionen : [];
  if (!pos.length || pos.length > 20 || pos.some(function (p) { return !p || !p.variante; })) throw fehler('ungueltige_positionen', 'Mindestens eine Krone angeben');
  const kanal = String(data.kanal || '').trim().slice(0, 30);
  if (!kanal) throw fehler('kein_kanal', 'Kanal fehlt');
  const preis = Number(data.preis);
  if (!(preis >= 0)) throw fehler('ungueltiger_preis', 'Preis prüfen');
  const datum = /^\d{2}\.\d{2}\.\d{4}$/.test(data.datum || '') ? data.datum : Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy');
  const sheet = blatt();
  const kopf = spaltenSicherstellen(sheet);
  const nr = neueBestellnr(sheet, kopf, new Date());
  const text = function (x, n) { return String(x == null ? '' : x).trim().slice(0, n || 200); };
  const zeile = zeileAnhaengen(sheet, kopf, {
    'Datum': datum,
    'Uhrzeit': Utilities.formatDate(new Date(), 'Europe/Berlin', 'HH:mm'),
    'Bestellnr.': nr,
    'Variante': pos.map(function (p) { return text(p.variante, 60); }).join(', '),
    'Farbe': pos.map(function (p) { return text(p.farbe, 60); }).join(', '),
    'Grösse': pos.map(function (p) { return text(p.groesse, 40); }).join(', '),
    'Personalisierung': pos.map(function (p) { return text(p.pers, 40) || 'ohne Namen'; }).join(' | '),
    'Preis (€)': Math.round(preis * 100) / 100,
    'Zahlung': text(data.zahlung, 40),
    'Kundenname': text(data.kunde, 100),
    'E-Mail': text(data.email, 120),
    'Lieferadresse': text(data.adresse, 300),
    'Status': STATUS.indexOf(data.status) >= 0 ? data.status : 'Neu',
    'Kanal': kanal,
    'Notiz': text(data.notiz, 500)
  });
  return { ok: true, bestellung: bestellungLesen(sheet, kopf, zeile) };
}

/* ---------------- Versandmail ---------------- */
function sendeVersandmail(b) {
  const vorname = (b.kunde || '').split(' ')[0] || 'liebe Kundin, lieber Kunde';
  const pos = positionenText(b);
  const link = b.sendungsnummer ? DHL_LINK + encodeURIComponent(b.sendungsnummer) : '';
  const betreff = 'Deine Krone ist unterwegs 👑 – Bestellung ' + b.nr;
  const text = [
    'Hallo ' + vorname + ',',
    '',
    'deine Bestellung ' + b.nr + ' ist heute zu dir unterwegs:',
    pos.map(function (p) { return '  • ' + p; }).join('\n'),
    '',
    b.sendungsnummer ? 'DHL-Sendungsnummer: ' + b.sendungsnummer + '\nSendung verfolgen: ' + link : 'Das Paket ist ohne Sendungsnummer unterwegs.',
    '',
    'Lieferadresse: ' + b.kunde + ', ' + b.adresse,
    '',
    'Viel Freude mit der Krone! Wir freuen uns über ein Foto von deinem Hund.',
    'Bei Fragen antworte einfach auf diese Mail.',
    '',
    'Liebe Grüße',
    'Sara von ' + SHOP_NAME,
    '',
    '—',
    SHOP_ADRESSE + ' · ' + SHOP_EMAIL
  ].join('\n');
  const e = htmlEsc;
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#263234;font-size:15px;line-height:1.6;max-width:560px">' +
    '<p>Hallo ' + e(vorname) + ',</p>' +
    '<p>deine Bestellung <strong>' + e(b.nr) + '</strong> ist heute zu dir unterwegs:</p>' +
    '<ul style="padding-left:18px;margin:0 0 16px">' + pos.map(function (p) { return '<li>' + e(p) + '</li>'; }).join('') + '</ul>' +
    (b.sendungsnummer
      ? '<p style="margin:20px 0"><span style="color:#5f6d6e;font-size:13px">DHL-Sendungsnummer</span><br><strong style="font-size:17px;letter-spacing:.5px">' + e(b.sendungsnummer) + '</strong></p>' +
        '<p><a href="' + e(link) + '" style="display:inline-block;background:#4d6d71;color:#ffffff;text-decoration:none;padding:12px 22px;font-size:13px;letter-spacing:1px;text-transform:uppercase">Sendung verfolgen</a></p>'
      : '<p>Das Paket ist ohne Sendungsnummer unterwegs.</p>') +
    '<p style="color:#5f6d6e;font-size:13px">Lieferadresse: ' + e(b.kunde + ', ' + b.adresse) + '</p>' +
    '<p>Viel Freude mit der Krone! Wir freuen uns über ein Foto von deinem Hund.<br>Bei Fragen antworte einfach auf diese Mail.</p>' +
    '<p>Liebe Grüße<br>Sara von ' + e(SHOP_NAME) + '</p>' +
    '<p style="color:#8a9596;font-size:12px;border-top:1px solid #e6e2dc;padding-top:12px;margin-top:24px">' + e(SHOP_ADRESSE) + ' · ' + e(SHOP_EMAIL) + '</p>' +
    '</div>';
  MailApp.sendEmail({ to: b.email, subject: betreff, body: text, htmlBody: html, name: SHOP_NAME, replyTo: SHOP_EMAIL });
}

// "Party, Glitzer" / "Rosa, Blau" / "Gross, Klein" / "MILA | ohne Namen" → einzelne Zeilen
function positionenText(b) {
  const t = function (x, s) { return String(x || '').split(s).map(function (y) { return y.trim(); }); };
  const v = t(b.variante, ', '), f = t(b.farbe, ', '), g = t(b.groesse, ', '), p = t(b.personalisierung, ' | ');
  const name = function (x) { return x && x !== 'ohne Namen' ? ' „' + x + '“' : ''; };
  if (v.length > 1 && v.length === f.length && v.length === g.length) {
    return v.map(function (x, i) { return x + ', ' + f[i] + ', ' + g[i] + (p.length === v.length ? name(p[i]) : ''); });
  }
  return [b.variante + ', ' + b.farbe + ', ' + b.groesse + name(b.personalisierung)];
}

function htmlEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

/* ---------------- Hilfsfunktionen ---------------- */
function blatt() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, SPALTEN.length).setValues([SPALTEN]);
    kopfFormat(sheet.getRange(1, 1, 1, SPALTEN.length));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function kopfzeile(sheet) {
  const breite = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, breite).getDisplayValues()[0].map(function (k) { return String(k).trim(); });
}

// Hängt fehlende Zusatzspalten rechts an und gibt die Kopfzeile zurück
function spaltenSicherstellen(sheet) {
  const kopf = kopfzeile(sheet);
  ZUSATZ_SPALTEN.forEach(function (name) {
    if (kopf.indexOf(name) >= 0) return;
    let spalte = kopf.length + 1;
    while (spalte > 1 && kopf[spalte - 2] === '') spalte--;         // leere Kopfzellen am Ende auffüllen
    sheet.getRange(1, spalte).setValue(name);
    kopfFormat(sheet.getRange(1, spalte));
    kopf[spalte - 1] = name;
  });
  return kopf;
}

function kopfFormat(bereich) {
  bereich.setBackground('#5a4538');
  bereich.setFontColor('#ffffff');
  bereich.setFontWeight('bold');
}

// Neue Zeile in Spaltenreihenfolge der Kopfzeile, gibt die Zeilennummer zurück
function zeileAnhaengen(sheet, kopf, werte) {
  const zeile = kopf.map(function (name) { return werte[name] !== undefined ? werte[name] : ''; });
  sheet.appendRow(zeile);
  const nr = sheet.getLastRow();
  if (nr % 2 === 0) sheet.getRange(nr, 1, 1, kopf.length).setBackground('#fafaf8');
  sheet.getRange(nr, kopf.indexOf('Preis (€)') + 1).setNumberFormat('#,##0.00 €');
  return nr;
}

// KW-JJJJMMTT-NNN, garantiert noch nicht vergeben
function neueBestellnr(sheet, kopf, now) {
  const tag = Utilities.formatDate(now, 'Europe/Berlin', 'yyyyMMdd');
  const spalte = kopf.indexOf('Bestellnr.') + 1;
  const n = sheet.getLastRow();
  const vorhanden = {};
  if (spalte > 0 && n > 1) sheet.getRange(2, spalte, n - 1, 1).getDisplayValues().forEach(function (z) { vorhanden[z[0]] = true; });
  let zahl = n;
  let nr;
  do { nr = 'KW-' + tag + '-' + String(zahl).padStart(3, '0'); zahl++; } while (vorhanden[nr]);
  return nr;
}

// Zeile zur Bestellnummer finden; die mitgeschickte Zeilennummer wird nur genutzt, wenn die Nummer dort passt
function zeileFinden(sheet, kopf, zeile, nr) {
  const spalte = kopf.indexOf('Bestellnr.') + 1;
  if (!nr || spalte < 1) throw fehler('bestellung_nicht_gefunden', 'Bestellung nicht gefunden');
  const z = parseInt(zeile, 10);
  if (z >= 2 && z <= sheet.getLastRow() && String(sheet.getRange(z, spalte).getDisplayValue()).trim() === nr) return z;
  const n = sheet.getLastRow();
  if (n > 1) {
    const liste = sheet.getRange(2, spalte, n - 1, 1).getDisplayValues();
    for (let i = 0; i < liste.length; i++) if (String(liste[i][0]).trim() === nr) return i + 2;
  }
  throw fehler('bestellung_nicht_gefunden', 'Bestellung ' + nr + ' nicht gefunden');
}

function bestellungLesen(sheet, kopf, zeile) {
  const bereich = sheet.getRange(zeile, 1, 1, kopf.length);
  return bestellungAusZeile(kopf, bereich.getDisplayValues()[0], bereich.getValues()[0], zeile);
}

function fehler(code, text) {
  const e = new Error(text);
  e.code = code;
  return e;
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

/* Einmalig nach dem Update auf 1.2 ausführen: Google fragt nach der Erlaubnis, Mails zu senden
   (für die Versandmail) und legt die neuen Spalten an. Der Admin-Schlüssel bleibt unverändert. */
function berechtigen() {
  spaltenSicherstellen(blatt());
  Logger.log('Spalten geprüft. Heute noch möglich: ' + MailApp.getRemainingDailyQuota() + ' Mails.');
}

function testScript() {
  bestellungSpeichern({
    variante: 'Party', farbe: 'Rosa mit Punkten', groesse: 'Gross', hundename: 'MILA',
    preis: '15,00', zahlung: 'PayPal',
    kunde_name: 'Test Kunde', kunde_email: 'test@kronenwelt.de', lieferadresse: 'Musterstrasse 1, 76137 Karlsruhe, DE'
  });
  Logger.log('Testzeile erfolgreich eingetragen!');
}
