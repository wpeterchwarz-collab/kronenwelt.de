/* ============================================================
   Kronenwelt-Schnittstelle (Google Apps Script, gehört zur Tabelle „Kronenwelt Bestellungen“)

   1) Der Shop schickt jede bezahlte Bestellung hierher → neue Zeile im Blatt „Bestellungen“
      (ohne Schlüssel, wie bisher; neu: Status „Neu“, Kanal „Webshop“).
   2) Die Admin-Seite liest und ändert Bestellungen und das Lager. Das geht nur mit dem Admin-Schlüssel,
      der in den Skript-Eigenschaften steht (nie im Code, nie auf GitHub).

   Einrichten (einmalig):  Funktion „einrichten“ ausführen → Schlüssel aus dem Protokoll
   in die Admin-Seite (Einstellungen → Bestellungen) kopieren.
   Nach jeder Code-Änderung: Bereitstellen → Bereitstellungen verwalten → Bearbeiten →
   Neue Version. Die Adresse (…/exec) bleibt dabei gleich.

   3) Lager: Jede Bewegung (genäht, verkauft, umgelagert, gezählt) ist eine Zeile im Blatt
      „Lagerbewegungen“. Der Bestand ist die Summe dieser Zeilen, je Artikelnummer und Kiste.
      Verkäufe und Stornos bucht die Schnittstelle selbst (über die Bestellnummer, nie doppelt).

   4) Zahlung prüfen: Jede Shop-Bestellung bringt die PayPal-Nummer mit. Die Schnittstelle fragt bei
      PayPal nach, ob genau diese Zahlung abgeschlossen ist, und rechnet den Preis selbst aus katalog.json
      nach. Ergebnis steht in der Spalte „Zahlung geprüft“ (OK / PRÜFEN / NICHT GEPRÜFT). Gespeichert wird
      die Bestellung immer; eine verdächtige Bestellung wird nur markiert.
      Zugang zu PayPal: Skript-Eigenschaften PAYPAL_CLIENT_ID und PAYPAL_SECRET (nie im Code).

   Spalten: Die ersten 12 Spalten sind seit Beginn gleich. Neue Spalten (Status, Kanal, …)
   werden rechts angehängt, sobald sie gebraucht werden. Nichts wird umbenannt oder gelöscht.

   Dieser Code liegt auch im GitHub-Repo (apps-script/Code.gs), damit Änderungen
   nachvollziehbar sind. Er enthält keine Geheimnisse.
   ============================================================ */

const SHEET_NAME = 'Bestellungen';
const SCHNITTSTELLE_VERSION = '1.4';
const SPALTEN = [
  'Datum', 'Uhrzeit', 'Bestellnr.',
  'Variante', 'Farbe', 'Grösse', 'Personalisierung',
  'Preis (€)', 'Zahlung',
  'Kundenname', 'E-Mail', 'Lieferadresse'
];
const ZUSATZ_SPALTEN = ['Status', 'Kanal', 'Sendungsnummer', 'Versendet am', 'Notiz', 'Artikelnr.', 'Kiste', 'PayPal-ID', 'Zahlung geprüft'];
const STATUS = ['Neu', 'In Arbeit', 'Versendet', 'Übergeben', 'Storniert'];

// Lager: Kisten und aus welcher Kiste jeder Kanal verkauft. Neue Kiste = ein Eintrag hier.
const KISTEN = ['Markt & Webshop', 'Etsy', 'Amazon', 'Werkstatt'];
const WERKSTATT = 'Werkstatt';                         // Vorrat zum Nachfüllen der anderen Kisten
const KANAL_KISTE = { 'Webshop': 'Markt & Webshop', 'Markt': 'Markt & Webshop', 'Etsy': 'Etsy', 'Amazon': 'Amazon' };
const OHNE_LAGER = 'nicht vom Lager';
const LAGER_BLATT = 'Lagerbewegungen';
const LAGER_SPALTEN = ['Datum', 'Uhrzeit', 'Artikelnr.', 'Artikel', 'Kiste', 'Menge', 'Grund', 'Bestellnr.', 'Notiz'];
const MINDEST_BLATT = 'Mindestbestand';
const MINDEST_SPALTEN = ['Artikelnr.', 'Kiste', 'Mindestbestand'];
// Gründe, die die Admin-Seite buchen darf („Verkauf“ und „Storno“ bucht nur die Schnittstelle selbst)
const GRUENDE = ['Genäht', 'Umlagerung', 'Ausgebucht', 'Korrektur'];

// Zahlung prüfen: PayPal (Live; mit Skript-Eigenschaft PAYPAL_MODUS = sandbox zum Testen) und der Katalog der Website
const PAYPAL_API = { live: 'https://api-m.paypal.com', sandbox: 'https://api-m.sandbox.paypal.com' };
const KATALOG_URL = 'https://kronenwelt.de/katalog.json';

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
    const paypalId = String(data.paypal_id || '').trim().slice(0, 40);
    const zeile = zeileAnhaengen(sheet, kopf, {
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
      'Kanal': 'Webshop',
      'Artikelnr.': artikelListe(String(data.artikel || '').split(',')),
      'Kiste': KANAL_KISTE['Webshop'],
      'PayPal-ID': paypalId
    });
    zahlungPruefenSicher(sheet, kopf, zeile);        // nach dem Speichern: eine Bestellung geht nie verloren
    lagerAbgleichSicher(nr);
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
  const schreibt = ['status', 'versenden', 'anlegen', 'buchen', 'inventur', 'mindest', 'zahlung'].indexOf(data.aktion) >= 0;
  const lock = LockService.getScriptLock();
  try {
    if (schreibt) lock.waitLock(20000);
    switch (data.aktion) {
      case 'ping':
        return antwort({ ok: true, version: SCHNITTSTELLE_VERSION, tabelle: SpreadsheetApp.getActiveSpreadsheet().getName(),
          paypal: paypalZugang() ? 'eingerichtet' : 'fehlt' });
      case 'zahlung':
        return antwort(zahlungNachpruefen(data));
      case 'bestellungen':
        return antwort({ ok: true, version: SCHNITTSTELLE_VERSION, bestellungen: bestellungenLesen() });
      case 'status':
        return antwort(statusSetzen(data));
      case 'versenden':
        return antwort(versenden(data));
      case 'anlegen':
        return antwort(anlegen(data));
      case 'lager':
        return antwort(lagerStand());
      case 'buchen':
        return antwort(buchen(data));
      case 'inventur':
        return antwort(inventur(data));
      case 'mindest':
        return antwort(mindestSetzen(data));
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
    sendungsnummer: feld('Sendungsnummer'), versendetAm: feld('Versendet am'), notiz: feld('Notiz'),
    artikel: feld('Artikelnr.'), kiste: feld('Kiste'),
    paypalId: feld('PayPal-ID'), zahlungGeprueft: feld('Zahlung geprüft')
  };
}

// Status einer Bestellung ändern (Neu, In Arbeit, Versendet, Übergeben, Storniert)
function statusSetzen(data) {
  if (STATUS.indexOf(data.status) < 0) throw fehler('ungueltiger_status', 'Unbekannter Status');
  const sheet = blatt();
  const kopf = spaltenSicherstellen(sheet);
  const zeile = zeileFinden(sheet, kopf, data.zeile, data.nr);
  sheet.getRange(zeile, kopf.indexOf('Status') + 1).setValue(data.status);
  const b = bestellungLesen(sheet, kopf, zeile);
  const lager = lagerAbgleichSicher(b.nr, b);              // Storno bucht zurück, Rücknahme des Stornos wieder ab
  return { ok: true, bestellung: b, lagerFehler: lager < 0 };
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
  // Aus welcher Kiste? Ohne Angabe die Kiste des Kanals; „nicht vom Lager“ = auf Bestellung genäht
  const kiste = data.kiste === undefined ? (KANAL_KISTE[kanal] || '') : KISTEN.indexOf(data.kiste) >= 0 ? data.kiste : OHNE_LAGER;
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
    'Notiz': text(data.notiz, 500),
    'Artikelnr.': artikelListe(pos.map(function (p) { return p.sku; })),
    'Kiste': kiste || OHNE_LAGER
  });
  const b = bestellungLesen(sheet, kopf, zeile);
  const lager = lagerAbgleichSicher(b.nr, b);
  return { ok: true, bestellung: b, lagerFehler: lager < 0 };
}

/* ---------------- 3) Lager ---------------- */
// Artikelnummer wie im Katalog: GRUPPE-PRODUKT-FARBE-GROESSE (z. B. KR-PARTY-ROSA-GR)
function skuOk(x) { return typeof x === 'string' && x.length <= 60 && /^[A-Z0-9]+(-[A-Z0-9]+){1,6}$/.test(x); }
// Liste für die Spalte „Artikelnr.“ (gleiche Reihenfolge wie die Kronen); unbekannte bleiben leer
function artikelListe(liste) {
  const l = (liste || []).map(function (x) { x = String(x == null ? '' : x).trim(); return skuOk(x) ? x : ''; });
  return l.some(function (x) { return x; }) ? l.join(', ') : '';
}

function lagerBlatt(name, spalten) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, spalten.length).setValues([spalten]);
    kopfFormat(sheet.getRange(1, 1, 1, spalten.length));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function zeilenLesen(sheet) {
  const n = sheet.getLastRow();
  if (n < 2) return { kopf: kopfzeile(sheet), zeilen: [] };
  const kopf = kopfzeile(sheet);
  const w = sheet.getRange(2, 1, n - 1, kopf.length).getDisplayValues();   // Anzeige: Datum und Uhrzeit wie im Blatt
  return { kopf: kopf, zeilen: w.map(function (z) { const o = {}; kopf.forEach(function (k, i) { o[k] = z[i]; }); return o; }) };
}

// Alle Bewegungen (älteste zuerst)
function bewegungenLesen() {
  return zeilenLesen(lagerBlatt(LAGER_BLATT, LAGER_SPALTEN)).zeilen
    .map(function (z) {
      return { datum: String(z['Datum'] || ''), uhrzeit: String(z['Uhrzeit'] || ''), sku: String(z['Artikelnr.'] || '').trim(),
        artikel: String(z['Artikel'] || ''), kiste: String(z['Kiste'] || '').trim(), menge: parseInt(z['Menge'], 10) || 0,
        grund: String(z['Grund'] || ''), nr: String(z['Bestellnr.'] || '').trim(), notiz: String(z['Notiz'] || '') };
    })
    .filter(function (b) { return b.sku && b.kiste && b.menge; });
}


// { sku: { kiste: menge } }
function bestandAus(bewegungen) {
  const b = {};
  bewegungen.forEach(function (x) {
    b[x.sku] = b[x.sku] || {};
    b[x.sku][x.kiste] = (b[x.sku][x.kiste] || 0) + x.menge;
  });
  return b;
}

function mindestLesen() {
  const m = {};
  zeilenLesen(lagerBlatt(MINDEST_BLATT, MINDEST_SPALTEN)).zeilen.forEach(function (z) {
    const sku = String(z['Artikelnr.'] || '').trim(), kiste = String(z['Kiste'] || '').trim(), n = parseInt(z['Mindestbestand'], 10);
    if (sku && kiste && n > 0) { m[sku] = m[sku] || {}; m[sku][kiste] = n; }
  });
  return m;
}

function lagerStand() {
  const bew = bewegungenLesen();
  return { ok: true, kisten: KISTEN, werkstatt: WERKSTATT, kanalKiste: KANAL_KISTE, ohneLager: OHNE_LAGER,
    bestand: bestandAus(bew), mindest: mindestLesen(), bewegungen: bew.slice(-40).reverse() };
}

function bewegungAnhaengen(sheet, kopf, b) {
  const jetzt = new Date();
  zeileAnhaengenRoh(sheet, kopf, {
    'Datum': Utilities.formatDate(jetzt, 'Europe/Berlin', 'dd.MM.yyyy'),
    'Uhrzeit': Utilities.formatDate(jetzt, 'Europe/Berlin', 'HH:mm'),
    'Artikelnr.': b.sku, 'Artikel': String(b.artikel || '').slice(0, 120), 'Kiste': b.kiste, 'Menge': b.menge,
    'Grund': b.grund, 'Bestellnr.': b.nr || '', 'Notiz': String(b.notiz || '').slice(0, 300)
  });
}

// Bucht für eine Bestellung genau so viel, dass das Lager zur Bestellung passt.
// Soll: je Krone −1 aus der Kiste der Bestellung (storniert oder „nicht vom Lager“: 0).
// Ist: alle Bewegungen mit dieser Bestellnummer. Mehrfaches Aufrufen bucht nie doppelt.
// Fehler im Lager dürfen nie eine Bestellung verhindern: dann nur protokollieren
function lagerAbgleichSicher(nr, b) {
  try { return lagerAbgleich(nr, b); } catch (err) { Logger.log('Lager-Abgleich ' + nr + ': ' + err.message); return -1; }
}

function lagerAbgleich(nr, b) {
  if (!b) {
    const sheet = blatt(), kopf = kopfzeile(sheet);
    b = bestellungLesen(sheet, kopf, zeileFinden(sheet, kopf, null, nr));
  }
  const skus = String(b.artikel || '').split(',').map(function (x) { return x.trim(); });
  const namen = positionenText(b);
  const soll = {}, text = {};
  if (b.status !== 'Storniert' && KISTEN.indexOf(b.kiste) >= 0) {
    skus.forEach(function (sku, i) {
      if (!skuOk(sku)) return;
      const k = sku + '|' + b.kiste;
      soll[k] = (soll[k] || 0) - 1;
      text[k] = namen.length === skus.length ? namen[i].replace(/ „.*“$/, '') : '';
    });
  }
  const lager = lagerBlatt(LAGER_BLATT, LAGER_SPALTEN);
  const ist = {};
  bewegungenLesen().forEach(function (x) { if (x.nr === b.nr) { const k = x.sku + '|' + x.kiste; ist[k] = (ist[k] || 0) + x.menge; } });
  const kopf = kopfzeile(lager);
  let gebucht = 0;
  Object.keys(soll).concat(Object.keys(ist)).forEach(function (k, i, alle) {
    if (alle.indexOf(k) !== i) return;
    const diff = (soll[k] || 0) - (ist[k] || 0);
    if (!diff) return;
    const t = k.split('|');
    bewegungAnhaengen(lager, kopf, { sku: t[0], kiste: t[1], menge: diff, grund: diff < 0 ? 'Verkauf' : 'Storno', nr: b.nr, artikel: text[k] || '' });
    gebucht++;
  });
  return gebucht;
}

// Buchungen der Admin-Seite: genäht (+), umgelagert (−/+), ausgebucht (−), Korrektur (±)
function buchen(data) {
  const liste = Array.isArray(data.buchungen) ? data.buchungen : [];
  if (!liste.length || liste.length > 300) throw fehler('ungueltige_buchung', 'Keine Buchung');
  liste.forEach(function (b) {
    const m = Number(b && b.menge);
    if (!b || !skuOk(b.sku) || KISTEN.indexOf(b.kiste) < 0 || GRUENDE.indexOf(b.grund) < 0 || !(m === Math.round(m)) || !m || Math.abs(m) > 500) {
      throw fehler('ungueltige_buchung', 'Buchung prüfen');
    }
  });
  const sheet = lagerBlatt(LAGER_BLATT, LAGER_SPALTEN), kopf = kopfzeile(sheet);
  liste.forEach(function (b) { bewegungAnhaengen(sheet, kopf, { sku: b.sku, kiste: b.kiste, menge: Number(b.menge), grund: b.grund, artikel: b.artikel, notiz: b.notiz }); });
  const r = lagerStand();
  r.gebucht = liste.length;
  return r;
}

// Inventur einer Kiste: gezählte Stückzahl je Artikel → Korrekturbuchung für den Unterschied
function inventur(data) {
  if (KISTEN.indexOf(data.kiste) < 0) throw fehler('ungueltige_kiste', 'Kiste prüfen');
  const z = data.zaehlung && typeof data.zaehlung === 'object' ? data.zaehlung : {};
  const skus = Object.keys(z);
  if (!skus.length || skus.length > 1000) throw fehler('ungueltige_zaehlung', 'Keine Zählung');
  skus.forEach(function (sku) { const n = Number(z[sku]); if (!skuOk(sku) || !(n >= 0) || n !== Math.round(n) || n > 9999) throw fehler('ungueltige_zaehlung', 'Zählung prüfen'); });
  const bestand = bestandAus(bewegungenLesen());
  const sheet = lagerBlatt(LAGER_BLATT, LAGER_SPALTEN), kopf = kopfzeile(sheet);
  const namen = data.artikel && typeof data.artikel === 'object' ? data.artikel : {};
  let korrigiert = 0;
  skus.forEach(function (sku) {
    const diff = Number(z[sku]) - ((bestand[sku] || {})[data.kiste] || 0);
    if (!diff) return;
    bewegungAnhaengen(sheet, kopf, { sku: sku, kiste: data.kiste, menge: diff, grund: 'Inventur', artikel: namen[sku], notiz: data.notiz });
    korrigiert++;
  });
  const r = lagerStand();
  r.korrigiert = korrigiert;
  return r;
}

// Mindestbestand einer Kiste setzen (0 = kein Mindestbestand)
function mindestSetzen(data) {
  if (KISTEN.indexOf(data.kiste) < 0) throw fehler('ungueltige_kiste', 'Kiste prüfen');
  const w = data.werte && typeof data.werte === 'object' ? data.werte : {};
  const skus = Object.keys(w);
  skus.forEach(function (sku) { const n = Number(w[sku]); if (!skuOk(sku) || !(n >= 0) || n !== Math.round(n) || n > 999) throw fehler('ungueltiger_mindestbestand', 'Mindestbestand prüfen'); });
  const sheet = lagerBlatt(MINDEST_BLATT, MINDEST_SPALTEN);
  const kopf = kopfzeile(sheet);
  const iSku = kopf.indexOf('Artikelnr.'), iKiste = kopf.indexOf('Kiste'), iMin = kopf.indexOf('Mindestbestand');
  const n = sheet.getLastRow();
  const zeilen = n > 1 ? sheet.getRange(2, 1, n - 1, kopf.length).getDisplayValues() : [];
  const rest = {};
  skus.forEach(function (s) { rest[s] = true; });
  zeilen.forEach(function (z, i) {
    const sku = String(z[iSku]).trim();
    if (String(z[iKiste]).trim() !== data.kiste || !rest[sku]) return;
    sheet.getRange(i + 2, iMin + 1).setValue(Number(w[sku]));
    delete rest[sku];
  });
  Object.keys(rest).forEach(function (sku) {
    if (Number(w[sku]) > 0) zeileAnhaengenRoh(sheet, kopf, { 'Artikelnr.': sku, 'Kiste': data.kiste, 'Mindestbestand': Number(w[sku]) });
  });
  return lagerStand();
}

function zeileAnhaengenRoh(sheet, kopf, werte) {
  sheet.appendRow(kopf.map(function (name) { return werte[name] !== undefined ? werte[name] : ''; }));
  return sheet.getLastRow();
}

/* ---------------- 4) Zahlung prüfen (PayPal + Preis aus dem Katalog) ---------------- */
function paypalZugang() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('PAYPAL_CLIENT_ID'), geheim = p.getProperty('PAYPAL_SECRET');
  if (!id || !geheim) return null;
  return { id: id, geheim: geheim, api: PAYPAL_API[p.getProperty('PAYPAL_MODUS') === 'sandbox' ? 'sandbox' : 'live'] };
}

function euroText(n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' €'; }

// Prüft die Zahlung der Bestellung in dieser Zeile und schreibt das Ergebnis in „Zahlung geprüft“.
function zahlungPruefenSicher(sheet, kopf, zeile) {
  let text;
  try {
    text = zahlungPruefen(bestellungLesen(sheet, kopf, zeile));
  } catch (err) {
    text = 'NICHT GEPRÜFT: ' + String(err.message || err).slice(0, 120);
  }
  sheet.getRange(zeile, kopf.indexOf('Zahlung geprüft') + 1).setValue(text);
  return text;
}

function zahlungPruefen(b) {
  const id = b.paypalId;
  if (!id) return 'PRÜFEN: ohne PayPal-Zahlungsnummer gemeldet';
  if (!/^[A-Z0-9]{10,30}$/.test(id)) return 'PRÜFEN: ungültige PayPal-Zahlungsnummer';
  const zugang = paypalZugang();
  if (!zugang) return 'NICHT GEPRÜFT: PayPal-Zugang fehlt (Skript-Eigenschaften)';
  const schon = andereBestellungMitPaypal(id, b.nr);
  if (schon) return 'PRÜFEN: diese PayPal-Zahlung gehört schon zu ' + schon;

  const order = paypalBestellung(zugang, id);
  if (!order) return 'PRÜFEN: Zahlung bei PayPal nicht gefunden';
  const pu = (order.purchase_units || [])[0] || {};
  const cap = (((pu.payments || {}).captures) || [])[0] || {};
  const st = cap.status || order.status;
  if (order.status !== 'COMPLETED' || cap.status !== 'COMPLETED') return 'PRÜFEN: Zahlung nicht abgeschlossen (' + st + ')';
  const betragObj = cap.amount || pu.amount || {};
  if (betragObj.currency_code !== 'EUR') return 'PRÜFEN: Zahlung nicht in Euro (' + betragObj.currency_code + ')';
  const bezahlt = Number(betragObj.value);

  const soll = sollPreis(b);
  if (soll.fehlt.length) return 'PRÜFEN: bezahlt ' + euroText(bezahlt) + ', Artikel nicht im Katalog: ' + soll.fehlt.join(', ');
  if (bezahlt + 0.005 < soll.summe) return 'PRÜFEN: bezahlt ' + euroText(bezahlt) + ', laut Preisliste ' + euroText(soll.summe);
  if (Math.abs(bezahlt - b.preis) > 0.005) return 'PRÜFEN: bezahlt ' + euroText(bezahlt) + ', gemeldet ' + euroText(b.preis);
  return 'OK: ' + euroText(bezahlt) + ' bei PayPal bezahlt';
}

// Admin: Zahlung einer Bestellung (erneut) prüfen, z. B. nachdem der PayPal-Zugang eingetragen wurde
function zahlungNachpruefen(data) {
  const sheet = blatt();
  const kopf = spaltenSicherstellen(sheet);
  const zeile = zeileFinden(sheet, kopf, data.zeile, data.nr);
  zahlungPruefenSicher(sheet, kopf, zeile);
  return { ok: true, bestellung: bestellungLesen(sheet, kopf, zeile) };
}

function andereBestellungMitPaypal(id, nr) {
  const sheet = blatt(), kopf = kopfzeile(sheet), n = sheet.getLastRow();
  const ip = kopf.indexOf('PayPal-ID'), inr = kopf.indexOf('Bestellnr.');
  if (ip < 0 || n < 2) return '';
  const w = sheet.getRange(2, 1, n - 1, kopf.length).getDisplayValues();
  for (let i = 0; i < w.length; i++) {
    if (String(w[i][ip]).trim() === id && String(w[i][inr]).trim() !== nr) return String(w[i][inr]).trim();
  }
  return '';
}

function paypalToken(zugang) {
  const cache = CacheService.getScriptCache(), k = 'paypal_token_' + zugang.api.length;
  const alt = cache.get(k);
  if (alt) return alt;
  const r = UrlFetchApp.fetch(zugang.api + '/v1/oauth2/token', {
    method: 'post', muteHttpExceptions: true, payload: 'grant_type=client_credentials',
    contentType: 'application/x-www-form-urlencoded',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(zugang.id + ':' + zugang.geheim) }
  });
  if (r.getResponseCode() !== 200) throw new Error('PayPal-Anmeldung fehlgeschlagen (' + r.getResponseCode() + '), Zugangsdaten prüfen');
  const j = JSON.parse(r.getContentText());
  cache.put(k, j.access_token, Math.max(60, Math.min(21600, (j.expires_in || 3600) - 300)));
  return j.access_token;
}

function paypalBestellung(zugang, id) {
  const r = UrlFetchApp.fetch(zugang.api + '/v2/checkout/orders/' + encodeURIComponent(id), {
    method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + paypalToken(zugang) }
  });
  const c = r.getResponseCode();
  if (c === 404 || c === 422) return null;
  if (c !== 200) throw new Error('PayPal antwortet nicht (' + c + ')');
  return JSON.parse(r.getContentText());
}

// Katalog der Website (10 Minuten zwischengespeichert)
function katalogLaden() {
  const cache = CacheService.getScriptCache();
  const alt = cache.get('katalog');
  if (alt) return JSON.parse(alt);
  const r = UrlFetchApp.fetch(KATALOG_URL, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('katalog.json nicht erreichbar (' + r.getResponseCode() + ')');
  const text = r.getContentText();
  try { cache.put('katalog', text, 600); } catch (e) { /* zu groß für den Zwischenspeicher: dann eben jedes Mal laden */ }
  return JSON.parse(text);
}

// Preis laut Katalog aus dem, was Sara liest und näht (Variante, Farbe, Größe je Krone).
// Größe „Gross + 6 Pets“ = Preis für Gross + Aufpreis für 6 Pets.
function sollPreis(b) {
  const k = katalogLaden();
  const teil = function (x) { return String(x || '').split(/\s*,\s*/); };
  const v = teil(b.variante), f = teil(b.farbe), g = teil(b.groesse);
  let summe = 0;
  const fehlt = [];
  v.forEach(function (name, i) {
    const p = (k.produkte || []).filter(function (x) { return x.name === name; })[0];
    const groesse = String(g[i] || '').replace(/\s*\+.*$/, '');
    const pets = (/\+\s*(\d+)\s*Pets/i.exec(g[i] || '') || [])[1];
    const farbeOk = p && (p.merkmale.farbe || []).some(function (x) { return x.wert === f[i]; });
    const gr = p && (p.merkmale.groesse || []).filter(function (x) { return x.wert === groesse; })[0];
    if (!p || !farbeOk || !gr) { fehlt.push([name, f[i], g[i]].join(' ')); return; }
    summe += Number(gr.preis) || 0;
    if (pets) {
      const o = (((k.optionen || {}).zahlenpets || {}).werte || []).filter(function (x) { return String(x.wert) === pets; })[0];
      if (!o) { fehlt.push(name + ' ' + g[i]); return; }
      summe += Number(o.aufpreis) || 0;
    }
  });
  return { summe: Math.round(summe * 100) / 100, fehlt: fehlt };
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

/* Nach dem Update auf 1.4 einmal „paypalTesten“ ausführen: zeigt im Protokoll, ob die Anmeldung bei PayPal klappt. */
function paypalTesten() {
  const z = paypalZugang();
  if (!z) { Logger.log('PayPal-Zugang fehlt: PAYPAL_CLIENT_ID und PAYPAL_SECRET in den Skript-Eigenschaften eintragen.'); return; }
  paypalToken(z);
  Logger.log('PayPal-Anmeldung klappt (' + (z.api.indexOf('sandbox') >= 0 ? 'Sandbox' : 'Live') + ').');
}

/* Einmalig nach dem Update auf 1.2 ausführen: Google fragt nach der Erlaubnis, Mails zu senden
   (für die Versandmail) und legt die neuen Spalten an. Der Admin-Schlüssel bleibt unverändert.
   Ab 1.3 legt es auch die Blätter „Lagerbewegungen“ und „Mindestbestand“ an. */
function berechtigen() {
  spaltenSicherstellen(blatt());
  // Ab 1.4: Erlaubnis für Anfragen ins Internet (PayPal, katalog.json)
  Logger.log('Katalog erreichbar: ' + (katalogLaden().produkte || []).length + ' Produkte.');
  Logger.log(paypalZugang() ? 'PayPal-Zugang ist eingetragen.' : 'PayPal-Zugang fehlt noch: PAYPAL_CLIENT_ID und PAYPAL_SECRET in den Skript-Eigenschaften eintragen.');
  lagerBlatt(LAGER_BLATT, LAGER_SPALTEN);
  lagerBlatt(MINDEST_BLATT, MINDEST_SPALTEN);
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
