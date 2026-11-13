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

   5) Seriennummern (GPSR): Beim Versenden/Übergeben bekommt jede Krone die nächste MK-Nummer
      (MK-2025-310, …). Sie wird in Saras bestehende „GPSR_Seriennummernliste“ geschrieben
      (eigene Tabelle, ID in der Skript-Eigenschaft SERIENLISTE_ID) und bei der Bestellung vermerkt.

   6) Zugänge der Admin-Seite (ab 1.8): GitHub-Token und Cloudinary-Zugang liegen nur hier in den
      Skript-Eigenschaften (GITHUB_TOKEN, CLOUDINARY_KEY, CLOUDINARY_SECRET), nicht mehr im Browser.
      Die Admin-Seite liest und speichert ihre Dateien über die Aktion „github“ (nur die Dateien in
      GITHUB_DATEIEN) und lässt Foto-Uploads über „cloudinary“ unterschreiben. Hochgeladen wird direkt.

   7) Etsy (ab 1.9): Neue Etsy-Bestellungen kommen von selbst in die Tabelle (Kanal „Etsy“).
      Zugang: Skript-Eigenschaften ETSY_KEYSTRING und ETSY_SECRET (von „Your Apps“ bei Etsy, nie im Code).
      Verbinden: in der Admin-Seite (Einstellungen → Etsy); Sara erlaubt den Zugriff einmal bei Etsy.
      Automatisch alle 15 Minuten: einmal die Funktion „etsyZeitplan“ im Editor ausführen.
      Übernommen werden nur bezahlte Bestellungen ab dem Verbinden, jede nur einmal (Spalte „Plattform-Nr.“).
      Ab 1.10: Blatt „Etsy-Artikel“ – je Etsy-Artikel eine Zeile; in „Krone“ und „Farbe“ steht, welcher
      Katalog-Artikel dazu gehört. Dann bucht bei Etsy-Bestellungen auch das Lager ab.

   Spalten: Die ersten 12 Spalten sind seit Beginn gleich. Neue Spalten (Status, Kanal, …)
   werden rechts angehängt, sobald sie gebraucht werden. Nichts wird umbenannt oder gelöscht.

   Dieser Code liegt auch im GitHub-Repo (apps-script/Code.gs), damit Änderungen
   nachvollziehbar sind. Er enthält keine Geheimnisse.
   ============================================================ */

const SHEET_NAME = 'Bestellungen';
const SCHNITTSTELLE_VERSION = '1.10';
const SPALTEN = [
  'Datum', 'Uhrzeit', 'Bestellnr.',
  'Variante', 'Farbe', 'Grösse', 'Personalisierung',
  'Preis (€)', 'Zahlung',
  'Kundenname', 'E-Mail', 'Lieferadresse'
];
const ZUSATZ_SPALTEN = ['Status', 'Kanal', 'Sendungsnummer', 'Versendet am', 'Notiz', 'Artikelnr.', 'Kiste', 'PayPal-ID', 'Zahlung geprüft', 'Seriennummern', 'Rechnungsnr.', 'Plattform-Nr.'];
const STATUS = ['Neu', 'In Arbeit', 'Versendet', 'Übergeben', 'Storniert'];

// Lager: Kisten und aus welcher Kiste jeder Kanal verkauft. Neue Kiste = ein Eintrag hier.
const KISTEN = ['Markt & Webshop', 'Etsy', 'Amazon', 'Werkstatt'];
const WERKSTATT = 'Werkstatt';                         // Vorrat zum Nachfüllen der anderen Kisten
const KANAL_KISTE = { 'Webshop': 'Markt & Webshop', 'Markt': 'Markt & Webshop', 'Instagram': 'Markt & Webshop', 'Spende': 'Markt & Webshop', 'Etsy': 'Etsy', 'Amazon': 'Amazon' };
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

// Seriennummern: Saras Liste (Spalten A–F wie bisher, neue Spalten rechts angehängt)
// MK-<Jahr>-<laufende Zahl>: das Jahr ist das aktuelle, die Zahl hinten läuft über alle Jahre durch (MK-2025-309 → MK-2026-310)
function serienVorsilbe() { return 'MK-' + Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy') + '-'; }
function serienZahl(sn) { return parseInt(String(sn).split('-').pop(), 10); }
const SERIEN_MUSTER = /^MK-\d{4}-\d{3,}$/;
const SERIEN_ZUSATZ = ['Bestellnr.', 'Rechnungsnr.', 'Hinweis'];
const SERIEN_PLATTFORM = { 'Webshop': 'kronenwelt', 'Etsy': 'etsy', 'Amazon': 'amazon', 'Markt': 'markt', 'Instagram': 'instagram', 'Spende': 'spende' };

// Absender der Versandmail (Antworten gehen an die Shop-Adresse)
const SHOP_NAME  = "Mila's Kronenwelt";
const SHOP_EMAIL = 'm.kronenwelt@gmail.com';
const SHOP_ADRESSE = 'Sternenstaubhandmade · Sara Schwarz · Vogesenweg 8 · 75045 Walzbachtal';
const DHL_LINK = 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=';
const SHOP_URL = 'https://kronenwelt.de';
const WHATSAPP = '4917631242035';                     // wie in config.js
const INSTAGRAM = 'kronenwelt';
const LIEFERZEIT = '5–6 Werktage';

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
    // Bestellbestätigung an den Kunden, wenn der Shop darum bittet (sonst schickt der Shop sie selbst über EmailJS)
    let bestaetigung = false;
    if (data.bestaetigung_per_schnittstelle) {
      try {
        const b = bestellungLesen(sheet, kopf, zeile);
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) { sendeBestellbestaetigung(b); bestaetigung = true; }
      } catch (err) { Logger.log('Bestellbestätigung ' + nr + ': ' + err.message); }
    }
    return antwort({ success: true, bestellnr: nr, bestaetigung: bestaetigung });
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
  const schreibt = ['status', 'versenden', 'anlegen', 'buchen', 'inventur', 'mindest', 'zahlung', 'rechnung', 'etsyAbruf', 'etsyArtikel'].indexOf(data.aktion) >= 0;
  const lock = LockService.getScriptLock();
  try {
    if (schreibt) lock.waitLock(20000);
    switch (data.aktion) {
      case 'ping':
        return antwort({ ok: true, version: SCHNITTSTELLE_VERSION, tabelle: SpreadsheetApp.getActiveSpreadsheet().getName(),
          paypal: paypalZugang() ? 'eingerichtet' : 'fehlt', serienliste: serienStatus(),
          github: githubToken() ? 'eingerichtet' : 'fehlt', cloudinary: cloudinaryZugang() ? 'eingerichtet' : 'fehlt',
          etsy: etsyStatus() });
      case 'github':
        return antwort(githubAnfrage(data));
      case 'cloudinary':
        return antwort(cloudinarySignatur(data));
      case 'etsyStart':
        return antwort(etsyStart());
      case 'etsyCode':
        return antwort(etsyCode(data));
      case 'etsyAbruf':
        return antwort(etsyAbruf());
      case 'etsyArtikel':
        return antwort(etsyArtikelAbgleich());
      case 'etsyTrennen':
        return antwort(etsyTrennen());
      case 'zahlung':
        return antwort(zahlungNachpruefen(data));
      case 'seriennummern':
        return antwort(serienVorschlag(data));
      case 'rechnung':
        return antwort(rechnungSetzen(data));
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
    const r = { ok: false, fehler: err.code || 'fehler', text: err.message };
    if (err.vorschlag) r.vorschlag = err.vorschlag;
    return antwort(r);
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
    paypalId: feld('PayPal-ID'), zahlungGeprueft: feld('Zahlung geprüft'),
    seriennummern: feld('Seriennummern'), rechnungsnr: feld('Rechnungsnr.'), plattformNr: feld('Plattform-Nr.')
  };
}

// Status einer Bestellung ändern (Neu, In Arbeit, Versendet, Übergeben, Storniert)
function statusSetzen(data) {
  if (STATUS.indexOf(data.status) < 0) throw fehler('ungueltiger_status', 'Unbekannter Status');
  const sheet = blatt();
  const kopf = spaltenSicherstellen(sheet);
  const zeile = zeileFinden(sheet, kopf, data.zeile, data.nr);
  // Storno mit Mail an den Kunden: erst prüfen, dann ändern (sonst wäre storniert, aber keine Mail möglich)
  const stornoMail = data.status === 'Storniert' && data.mail === true;
  const nachricht = String(data.nachricht || '').trim();
  if (stornoMail) {
    const vorher = bestellungLesen(sheet, kopf, zeile);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vorher.email)) throw fehler('keine_email', 'Keine gültige E-Mail-Adresse bei dieser Bestellung');
    if (!nachricht || nachricht.length > 3000) throw fehler('ungueltige_nachricht', 'Text der Mail prüfen');
  }
  if (data.status === 'Übergeben' || data.status === 'Versendet') serienEintragen(sheet, kopf, zeile, data);
  sheet.getRange(zeile, kopf.indexOf('Status') + 1).setValue(data.status);
  let b = bestellungLesen(sheet, kopf, zeile);
  const lager = lagerAbgleichSicher(b.nr, b);              // Storno bucht zurück, Rücknahme des Stornos wieder ab
  // MK-Nummern bleiben vergeben; in Saras Liste steht bei Storno ein Hinweis (bei Rücknahme wieder leer)
  let serienFehler = false;
  if (b.seriennummern) {
    try { serienListeSetzen(b.nr, 'Hinweis', data.status === 'Storniert' ? 'storniert ' + Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy') : ''); }
    catch (err) { serienFehler = true; Logger.log('Seriennummernliste: ' + err.message); }
  }
  let mail = false;
  if (stornoMail) {
    sendeStornomail(b, nachricht);
    mail = true;
    const heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy');
    sheet.getRange(zeile, kopf.indexOf('Notiz') + 1).setValue((b.notiz ? b.notiz + ' · ' : '') + 'Stornomail ' + heute);
    b = bestellungLesen(sheet, kopf, zeile);
  }
  return { ok: true, bestellung: b, mail: mail, lagerFehler: lager < 0, serienFehler: serienFehler };
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
  if (data.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bestellungLesen(sheet, kopf, zeile).email)) throw fehler('keine_email', 'Keine gültige E-Mail-Adresse bei dieser Bestellung');
  serienEintragen(sheet, kopf, zeile, data);               // zuerst: klappt das nicht, ändert sich nichts
  setze('Sendungsnummer', nummer);
  setze('Versendet am', heute);
  setze('Status', 'Versendet');
  const b = bestellungLesen(sheet, kopf, zeile);
  let mail = false;
  if (data.mail) {
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
  const preis = kanal === 'Spende' ? 0 : Number(data.preis);   // Spende = verschenkt/gesponsert: kein Umsatz
  if (!(preis >= 0)) throw fehler('ungueltiger_preis', 'Preis prüfen');
  // Aus welcher Kiste? Ohne Angabe die Kiste des Kanals; „nicht vom Lager“ = auf Bestellung genäht
  const kiste = data.kiste === undefined ? (KANAL_KISTE[kanal] || '') : KISTEN.indexOf(data.kiste) >= 0 ? data.kiste : OHNE_LAGER;
  // „Schon verschickt“ (Etsy/Amazon) bzw. „schon übergeben“ (Markt): alles in einem Schritt. Erst prüfen, dann anlegen.
  const direkt = data.direkt === true;
  const sendung = kanal === 'Markt' ? '' : String(data.sendungsnummer || '').replace(/\s+/g, '').toUpperCase();   // Markt: keine Sendung
  if (direkt && sendung && !/^[A-Z0-9]{8,40}$/.test(sendung)) throw fehler('ungueltige_sendungsnummer', 'Sendungsnummer prüfen');
  if (direkt && serienAusDaten(data).length) serienPruefen(serienAusDaten(data));
  const datum = /^\d{2}\.\d{2}\.\d{4}$/.test(data.datum || '') ? data.datum : Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy');
  const sheet = blatt();
  const kopf = spaltenSicherstellen(sheet);
  const nr = neueBestellnr(sheet, kopf, new Date());
  const text = function (x, n) { return String(x == null ? '' : x).trim().slice(0, n || 200); };
  // Kronen-Angaben ohne Trennzeichen (Komma trennt die Kronen, | die Namen); wichtig für freie Bezeichnungen („Sonstiges“)
  const feld = function (x, n) { return text(x, n).replace(/\s*,\s*/g, ' / ').replace(/\s*\|\s*/g, ' / '); };
  pos.forEach(function (p) { p.variante = feld(p.variante, 60); p.farbe = feld(p.farbe, 60); p.groesse = feld(p.groesse, 40); p.pers = feld(p.pers, 40); });
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
    'Kiste': kiste || OHNE_LAGER,
    'Plattform-Nr.': text(data.plattformNr, 60)
  });
  if (direkt) {
    serienEintragen(sheet, kopf, zeile, data);
    const setze = function (name, wert) { sheet.getRange(zeile, kopf.indexOf(name) + 1).setValue(wert); };
    const uebergeben = kanal === 'Markt' || (kanal === 'Spende' && !sendung);   // Spende ohne Sendung = persönlich übergeben
    setze('Status', uebergeben ? 'Übergeben' : 'Versendet');
    if (!uebergeben) { setze('Sendungsnummer', sendung); setze('Versendet am', Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy')); }
  }
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

// Preis je Krone laut Katalog (für die Bestellbestätigung); unbekannte Krone → Fehler
function einzelpreise(b) {
  const teil = function (x) { return String(x || '').split(/\s*,\s*/); };
  const v = teil(b.variante), f = teil(b.farbe), g = teil(b.groesse);
  return v.map(function (name, i) {
    const r = sollPreis({ variante: name, farbe: f[i], groesse: g[i] });
    if (r.fehlt.length) throw new Error('unbekannt');
    return r.summe;
  });
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

/* ---------------- 5) Seriennummern (GPSR) ---------------- */
function serienBlatt() {
  const id = PropertiesService.getScriptProperties().getProperty('SERIENLISTE_ID');
  if (!id) return null;
  return SpreadsheetApp.openById(id).getSheets()[0];
}

function serienStatus() {
  try {
    const sh = serienBlatt();
    if (!sh) return 'fehlt';
    return serienLesen(sh).hoechste || 'leer';
  } catch (e) { return 'fehler'; }
}

// Liest Saras Liste: welche Nummern sind vergeben (mit Produkt), welche nur vorbereitet (Nummer ohne Produkt)
function serienLesen(sh) {
  const n = sh.getLastRow();
  const w = n > 1 ? sh.getRange(2, 1, n - 1, 3).getDisplayValues() : [];
  const vergeben = {}, frei = [];                         // vergeben: laufende Zahl → Nummer (Jahr egal)
  let max = 0, hoechste = '';
  w.forEach(function (z, i) {
    const sn = String(z[0]).trim().toUpperCase();
    if (!SERIEN_MUSTER.test(sn)) return;
    const zahl = serienZahl(sn);
    if (zahl > max) max = zahl;
    if (String(z[2]).trim()) { vergeben[zahl] = sn; if (!hoechste || zahl >= serienZahl(hoechste)) hoechste = sn; }
    else frei.push({ sn: sn, zahl: zahl, zeile: i + 2 });
  });
  return { vergeben: vergeben, frei: frei.filter(function (f) { return !vergeben[f.zahl]; }).sort(function (a, b) { return a.zahl - b.zahl; }), max: max, hoechste: hoechste };
}

function serienNaechste(info, anzahl) {
  const v = serienVorsilbe();
  const l = info.frei.map(function (f) { return v + String(f.zahl).padStart(3, '0'); });   // vorbereitete Zeilen zuerst, mit aktuellem Jahr
  let m = info.max;
  while (l.length < anzahl) { m++; l.push(v + String(m).padStart(3, '0')); }
  return l.slice(0, anzahl);
}

// Admin: Vorschlag für die nächsten Nummern (schreibt nichts)
function serienVorschlag(data) {
  const sh = serienBlatt();
  if (!sh) throw fehler('serienliste_fehlt', 'Seriennummernliste ist nicht eingerichtet');
  const anzahl = Math.max(1, Math.min(20, parseInt(data.anzahl, 10) || 1));
  const info = serienLesen(sh);
  return { ok: true, nummern: serienNaechste(info, anzahl), hoechste: info.hoechste };
}

// Spalte in Saras Liste für alle Zeilen einer Bestellung setzen (Rechnungsnr., Hinweis)
function serienListeSetzen(nr, spalte, wert) {
  const sh = serienBlatt();
  if (!sh) return 0;
  let k = kopfzeile(sh);
  if (k.indexOf(spalte) < 0) { sh.getRange(1, k.length + 1).setValue(spalte); k = k.concat([spalte]); }
  const ib = k.indexOf('Bestellnr.');
  if (ib < 0) return 0;
  const n = sh.getLastRow();
  const w = n > 1 ? sh.getRange(2, ib + 1, n - 1, 1).getDisplayValues() : [];
  let z = 0;
  w.forEach(function (r, i) { if (String(r[0]).trim() === nr) { sh.getRange(i + 2, k.indexOf(spalte) + 1).setValue(wert); z++; } });
  return z;
}

// Rechnungsnummer nachträglich setzen: bei der Bestellung und in Saras Liste
function rechnungSetzen(data) {
  const sheet = blatt();
  const kopf = spaltenSicherstellen(sheet);
  const zeile = zeileFinden(sheet, kopf, data.zeile, data.nr);
  const re = String(data.rechnungsnr || '').trim().slice(0, 60);
  sheet.getRange(zeile, kopf.indexOf('Rechnungsnr.') + 1).setValue(re);
  const b = bestellungLesen(sheet, kopf, zeile);
  const inListe = b.seriennummern ? serienListeSetzen(b.nr, 'Rechnungsnr.', re) : 0;
  return { ok: true, bestellung: b, inListe: inListe };
}

// Nummern prüfen, ohne etwas zu schreiben (Format, doppelt, schon vergeben, Liste eingerichtet)
function serienPruefen(liste) {
  if (liste.some(function (x) { return !SERIEN_MUSTER.test(x); })) throw fehler('ungueltige_seriennummer', 'Seriennummer prüfen (z. B. MK-2026-310)');
  const zahlen = liste.map(serienZahl);
  if (zahlen.some(function (x, i) { return zahlen.indexOf(x) !== i; })) throw fehler('ungueltige_seriennummer', 'Seriennummer doppelt');
  const sh = serienBlatt();
  if (!sh) throw fehler('serienliste_fehlt', 'Seriennummernliste ist nicht eingerichtet');
  const info = serienLesen(sh);
  const schon = liste.filter(function (x) { return info.vergeben[serienZahl(x)]; });   // die Zahl zählt, nicht das Jahr
  if (schon.length) {
    const e = fehler('seriennummer_vergeben', 'Schon vergeben: ' + schon.map(function (x) { return info.vergeben[serienZahl(x)]; }).join(', '));
    e.vorschlag = serienNaechste(info, liste.length);
    throw e;
  }
  return { sh: sh, info: info };
}
function serienAusDaten(data) {
  return Array.isArray(data.seriennummern) ? data.seriennummern.map(function (x) { return String(x || '').trim().toUpperCase(); }).filter(Boolean) : [];
}

// Beim Versenden/Übergeben: Nummern prüfen, in Saras Liste schreiben, bei der Bestellung vermerken
function serienEintragen(sheet, kopf, zeile, data) {
  const liste = serienAusDaten(data);
  const rechnung = String(data.rechnungsnr || '').trim().slice(0, 60);
  if (rechnung) sheet.getRange(zeile, kopf.indexOf('Rechnungsnr.') + 1).setValue(rechnung);
  if (!liste.length) return [];
  const pr = serienPruefen(liste), sh = pr.sh, info = pr.info;
  const b = bestellungLesen(sheet, kopf, zeile);
  const pos = positionenListe(b);
  // Spaltenköpfe der Liste: A–F wie bei Sara, Bestellnr./Rechnungsnr. rechts ergänzen
  let k = kopfzeile(sh);
  SERIEN_ZUSATZ.forEach(function (name) {
    if (k.indexOf(name) < 0) { sh.getRange(1, k.length + 1).setValue(name); k = k.concat([name]); }
  });
  // Hersteller und Risikoakte wie in der letzten ausgefüllten Zeile
  const n = sh.getLastRow();
  const alt = n > 1 ? sh.getRange(2, 1, n - 1, 6).getDisplayValues().filter(function (z) { return String(z[2]).trim(); }) : [];
  const vorlage = alt.length ? alt[alt.length - 1] : ['', '', '', '', SHOP_NAME + ', ' + SHOP_ADRESSE, ''];
  const heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy');
  liste.forEach(function (sn, i) {
    const p = pos[i] || pos[pos.length - 1] || { name: b.variante, details: '', pers: '' };
    const bez = [p.name].concat(String(p.details || '').split(' · ')).concat(p.pers ? [p.pers] : []).filter(Boolean).join(', ');
    const werte = [sn, SERIEN_PLATTFORM[b.kanal] || String(b.kanal || '').toLowerCase(), bez, heute, vorlage[4], vorlage[5]];
    const frei = info.frei.filter(function (f) { return f.zahl === serienZahl(sn); })[0];   // vorbereitete Zeile, Jahr wird angepasst
    const z = frei ? frei.zeile : sh.getLastRow() + 1;
    sh.getRange(z, 1, 1, 6).setValues([werte]);
    sh.getRange(z, k.indexOf('Bestellnr.') + 1).setValue(b.nr);
    if (rechnung) sh.getRange(z, k.indexOf('Rechnungsnr.') + 1).setValue(rechnung);
  });
  const vorher = String(b.seriennummern || '').split(/\s*,\s*/).filter(Boolean);
  sheet.getRange(zeile, kopf.indexOf('Seriennummern') + 1).setValue(vorher.concat(liste).join(', '));
  return liste;
}

/* ---------------- Mails an Kunden (Bestellbestätigung, Versand) ----------------
   Beide Mails haben dasselbe Layout: schlicht, gut lesbar am Handy (Tabellen, feste Breite höchstens 560 px,
   nur Inline-Styles, keine Bilder nötig). Dazu immer eine Textfassung für Mailprogramme ohne HTML. */
const M = { tinte: '#263234', grau: '#5f6d6e', hell: '#8a9596', linie: '#e6e2dc', petrol: '#4d6d71', grund: '#f5f3ef', box: '#f8f6f2' };

function vornameVon(b) { return (String(b.kunde || '').trim().split(/\s+/)[0]) || ''; }

// Eine Krone je Zeile: { name, details, pers, preis }
function positionenListe(b) {
  const t = function (x, sep) { return String(x || '').split(sep).map(function (y) { return y.trim(); }); };
  const v = t(b.variante, ', '), f = t(b.farbe, ', '), g = t(b.groesse, ', '), p = t(b.personalisierung, ' | ');
  const gleich = v.length === f.length && v.length === g.length;
  let preise = null;
  try { preise = einzelpreise(b); } catch (e) { preise = null; }       // ohne Katalog: Liste ohne Einzelpreise
  if (!gleich) return [{ name: b.variante, details: [b.farbe, b.groesse].filter(Boolean).join(' · '), pers: b.personalisierung, preis: null }];
  return v.map(function (x, i) {
    const pers = p.length === v.length ? p[i] : (i === 0 ? b.personalisierung : '');
    return { name: x, details: [f[i], g[i]].filter(Boolean).join(' · '), pers: pers && pers !== 'ohne Namen' ? pers : '',
      preis: preise && preise.length === v.length ? preise[i] : null };
  });
}

// Adresse wie von PayPal („8 Vogesenweg, 75045 WALZBACHTAL, DE“) als Zeilen
function adresseZeilen(b) {
  const z = String(b.adresse || '').split(/\s*,\s*/).filter(Boolean).map(function (x) { return x === 'DE' ? 'Deutschland' : x; });
  return [b.kunde].concat(z).filter(Boolean);
}

function mailLayout(o) {
  const e = htmlEsc;
  return '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><title>' + e(o.titel) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + M.grund + ';">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + e(o.vorschau) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + M.grund + ';"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:6px;font-family:Arial,Helvetica,sans-serif;color:' + M.tinte + ';">' +
    '<tr><td style="padding:26px 28px 8px;border-bottom:3px solid ' + M.petrol + ';">' +
      '<div style="font-size:20px;font-weight:bold;letter-spacing:1px;color:' + M.tinte + ';">👑 ' + e(SHOP_NAME.toUpperCase()) + '</div>' +
      '<div style="font-size:11px;letter-spacing:2px;color:' + M.hell + ';padding:4px 0 14px;">HANDMADE · PERSONALISIERT</div></td></tr>' +
    '<tr><td style="padding:26px 28px 8px;font-size:15px;line-height:1.6;">' + o.inhalt + '</td></tr>' +
    '<tr><td style="padding:18px 28px 26px;font-size:12px;line-height:1.6;color:' + M.hell + ';border-top:1px solid ' + M.linie + ';">' +
      'Sternenstaubhandmade · Inhaberin Sara Schwarz<br>Vogesenweg 8 · 75045 Walzbachtal<br>' +
      '<a href="mailto:' + SHOP_EMAIL + '" style="color:' + M.grau + ';">' + SHOP_EMAIL + '</a> · <a href="' + SHOP_URL + '" style="color:' + M.grau + ';">kronenwelt.de</a>' +
      (o.fussRecht ? '<br><br>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.<br>Es gelten unsere <a href="' + SHOP_URL + '/agb.html" style="color:' + M.grau + ';">AGB</a> und die ' +
        '<a href="' + SHOP_URL + '/widerruf.html" style="color:' + M.grau + ';">Widerrufsbelehrung</a>. Personalisierte Kronen sind vom Widerrufsrecht ausgeschlossen.' : '') +
    '</td></tr></table></td></tr></table></body></html>';
}

function mailTitel(t) { return '<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:' + M.tinte + ';">' + htmlEsc(t) + '</h1>'; }
function mailAbsatz(t) { return '<p style="margin:0 0 16px;">' + t + '</p>'; }
function mailZwischen(t) { return '<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:' + M.hell + ';margin:22px 0 8px;font-weight:bold;">' + htmlEsc(t) + '</div>'; }
function mailKnopf(text, url) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;"><tr><td style="background:' + M.petrol + ';border-radius:3px;">' +
    '<a href="' + htmlEsc(url) + '" style="display:inline-block;padding:13px 24px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:1px;">' + htmlEsc(text) + '</a></td></tr></table>';
}
function mailPositionen(liste, mitPreis) {
  const e = htmlEsc;
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ' + M.linie + ';">' +
    liste.map(function (x) {
      return '<tr><td style="padding:12px 0;border-bottom:1px solid ' + M.linie + ';vertical-align:top;">' +
        '<div style="font-weight:bold;">' + e(x.name) + '</div>' +
        '<div style="font-size:14px;color:' + M.grau + ';">' + e(x.details) + '</div>' +
        (x.pers ? '<div style="font-size:14px;margin-top:2px;">Personalisierung: <strong>„' + e(x.pers) + '“</strong></div>' : '') +
        '</td>' + (mitPreis ? '<td style="padding:12px 0 12px 12px;border-bottom:1px solid ' + M.linie + ';text-align:right;vertical-align:top;white-space:nowrap;">' +
        (x.preis != null ? euroText(x.preis) : '') + '</td>' : '') + '</tr>';
    }).join('') + '</table>';
}
function mailInfoBox(zeilen) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + M.box + ';border-radius:4px;margin:0 0 6px;">' +
    zeilen.map(function (z) {
      return '<tr><td style="padding:8px 14px;font-size:13px;color:' + M.grau + ';white-space:nowrap;">' + htmlEsc(z[0]) + '</td>' +
        '<td style="padding:8px 14px;font-size:14px;text-align:right;font-weight:bold;">' + z[1] + '</td></tr>';
    }).join('') + '</table>';
}
function mailHilfe() {
  return mailZwischen('Fragen?') + mailAbsatz('Antworte einfach auf diese Mail oder schreib uns per ' +
    '<a href="https://wa.me/' + WHATSAPP + '" style="color:' + M.petrol + ';font-weight:bold;">WhatsApp</a>. Wir helfen dir gern.') +
    mailAbsatz('Liebe Grüße<br>Sara &amp; Mila 🐾');
}

// Bestellbestätigung: direkt nach der Bestellung im Webshop
function sendeBestellbestaetigung(b) {
  const e = htmlEsc, vorname = vornameVon(b), pos = positionenListe(b);
  const mitPreis = pos.every(function (x) { return x.preis != null; });
  const betreff = 'Danke für deine Bestellung ' + b.nr + ' 👑';
  const inhalt =
    mailTitel('Danke für deine Bestellung!') +
    mailAbsatz('Hallo ' + e(vorname || 'und herzlich willkommen') + ',') +
    mailAbsatz('wie schön, dass du dich für eine Krone von uns entschieden hast! Deine Bestellung ist bei uns angekommen und wird jetzt liebevoll von Hand gefertigt.') +
    mailInfoBox([['Bestellnummer', e(b.nr)], ['Bestellt am', e(b.datum)], ['Bezahlt mit', e(b.zahlung || 'PayPal')]]) +
    mailZwischen(pos.length > 1 ? 'Deine ' + pos.length + ' Kronen' : 'Deine Krone') + mailPositionen(pos, mitPreis) +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">' +
      '<tr><td style="padding:4px 0;font-size:14px;color:' + M.grau + ';">Versand</td><td style="padding:4px 0;font-size:14px;text-align:right;">kostenlos</td></tr>' +
      '<tr><td style="padding:6px 0;font-size:16px;font-weight:bold;">Gesamt</td><td style="padding:6px 0;font-size:16px;font-weight:bold;text-align:right;">' + euroText(b.preis) + '</td></tr></table>' +
    mailZwischen('Lieferadresse') + mailAbsatz(adresseZeilen(b).map(e).join('<br>')) +
    mailZwischen('So geht es weiter') +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;font-size:14px;line-height:1.5;">' +
      [['1', 'Sara näht deine Krone von Hand' + (pos.some(function (x) { return x.pers; }) ? ', mit deiner Personalisierung.' : '.')],
       ['2', 'Sobald sie unterwegs ist, bekommst du eine Mail mit der DHL-Sendungsnummer.'],
       ['3', 'Die Lieferzeit beträgt ' + LIEFERZEIT + '.']].map(function (z) {
        return '<tr><td style="padding:4px 10px 4px 0;vertical-align:top;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:' + M.petrol + ';color:#fff;text-align:center;font-size:12px;font-weight:bold;">' + z[0] + '</span></td>' +
          '<td style="padding:4px 0;vertical-align:top;">' + e(z[1]) + '</td></tr>';
      }).join('') + '</table>' +
    mailHilfe();
  const text = [
    'Hallo ' + (vorname || '') + ',', '',
    'vielen Dank für deine Bestellung! Sie ist bei uns angekommen und wird jetzt von Hand gefertigt.', '',
    'Bestellnummer: ' + b.nr, 'Bestellt am: ' + b.datum, 'Bezahlt mit: ' + (b.zahlung || 'PayPal'), '',
    pos.length > 1 ? 'Deine Kronen:' : 'Deine Krone:',
    pos.map(function (x) { return '- ' + x.name + ', ' + x.details.replace(/ · /g, ', ') + (x.pers ? ' „' + x.pers + '“' : '') + (mitPreis ? ' (' + euroText(x.preis) + ')' : ''); }).join('\n'),
    'Versand: kostenlos', 'Gesamt: ' + euroText(b.preis), '',
    'Lieferadresse:', adresseZeilen(b).join('\n'), '',
    'So geht es weiter: Sara näht deine Krone von Hand. Sobald sie unterwegs ist, bekommst du eine Mail mit der DHL-Sendungsnummer. Die Lieferzeit beträgt ' + LIEFERZEIT + '.', '',
    'Fragen? Antworte einfach auf diese Mail oder schreib uns per WhatsApp: https://wa.me/' + WHATSAPP, '',
    'Liebe Grüße', 'Sara & Mila', '', '--',
    'Sternenstaubhandmade · Inhaberin Sara Schwarz · Vogesenweg 8 · 75045 Walzbachtal · ' + SHOP_EMAIL,
    'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    'AGB: ' + SHOP_URL + '/agb.html · Widerrufsbelehrung: ' + SHOP_URL + '/widerruf.html',
    'Personalisierte Kronen sind vom Widerrufsrecht ausgeschlossen.'
  ].join('\n');
  const html = mailLayout({ titel: betreff, vorschau: 'Bestellung ' + b.nr + ' ist angekommen. Wir fertigen deine Krone jetzt von Hand.', inhalt: inhalt, fussRecht: true });
  MailApp.sendEmail({ to: b.email, subject: betreff, body: text, htmlBody: html, name: SHOP_NAME, replyTo: SHOP_EMAIL });
}

// Stornomail: Text schreibt Sara im Admin (vorausgefüllt), hier kommt er ins gemeinsame Layout
function sendeStornomail(b, nachricht) {
  const e = htmlEsc, pos = positionenListe(b);
  const betreff = 'Deine Bestellung ' + b.nr + ' wurde storniert';
  const absaetze = nachricht.split(/\n\s*\n/).map(function (a) { return mailAbsatz(e(a.trim()).replace(/\n/g, '<br>')); }).join('');
  const inhalt = mailTitel('Deine Bestellung wurde storniert') + absaetze +
    mailZwischen('Stornierte Bestellung') +
    mailInfoBox([['Bestellnummer', e(b.nr)], ['Bestellt am', e(b.datum)], ['Betrag', euroText(b.preis)]]) +
    '<div style="height:8px;"></div>' + mailPositionen(pos, false);
  const text = nachricht + '\n\n' + [
    'Stornierte Bestellung: ' + b.nr + ' vom ' + b.datum + ' (' + euroText(b.preis) + ')',
    positionenText(b).map(function (p) { return '- ' + p; }).join('\n'), '', '--',
    'Sternenstaubhandmade · Inhaberin Sara Schwarz · Vogesenweg 8 · 75045 Walzbachtal · ' + SHOP_EMAIL
  ].join('\n');
  const html = mailLayout({ titel: betreff, vorschau: 'Bestellung ' + b.nr + ' wurde storniert.', inhalt: inhalt, fussRecht: false });
  MailApp.sendEmail({ to: b.email, subject: betreff, body: text, htmlBody: html, name: SHOP_NAME, replyTo: SHOP_EMAIL });
}

// Versandmail: wenn Sara die Bestellung als versendet markiert
function sendeVersandmail(b) {
  const e = htmlEsc, vorname = vornameVon(b), pos = positionenListe(b);
  const link = b.sendungsnummer ? DHL_LINK + encodeURIComponent(b.sendungsnummer) : '';
  const betreff = 'Deine Krone ist unterwegs 👑 – Bestellung ' + b.nr;
  const inhalt =
    mailTitel(pos.length > 1 ? 'Deine Kronen sind unterwegs!' : 'Deine Krone ist unterwegs!') +
    mailAbsatz('Hallo ' + e(vorname || '') + ',') +
    mailAbsatz('deine Bestellung <strong>' + e(b.nr) + '</strong> ist fertig und heute an DHL übergeben worden. In 1–3 Werktagen sollte sie bei dir sein.') +
    (b.sendungsnummer
      ? mailInfoBox([['DHL-Sendungsnummer', '<span style="letter-spacing:.5px;">' + e(b.sendungsnummer) + '</span>']]) + '<div style="height:12px;"></div>' + mailKnopf('SENDUNG VERFOLGEN', link)
      : mailAbsatz('Das Paket ist ohne Sendungsnummer unterwegs.')) +
    mailZwischen('Im Paket') + mailPositionen(pos, false) +
    mailZwischen('Lieferadresse') + mailAbsatz(adresseZeilen(b).map(e).join('<br>')) +
    mailZwischen('Viel Freude damit!') +
    mailAbsatz('Wir freuen uns riesig über ein Foto von deinem Hund mit Krone, gern per Mail oder auf Instagram mit ' +
      '<a href="https://www.instagram.com/' + INSTAGRAM + '" style="color:' + M.petrol + ';font-weight:bold;">@' + INSTAGRAM + '</a>.') +
    mailHilfe();
  const text = [
    'Hallo ' + (vorname || '') + ',', '',
    'deine Bestellung ' + b.nr + ' ist heute an DHL übergeben worden:',
    positionenText(b).map(function (p) { return '- ' + p; }).join('\n'), '',
    b.sendungsnummer ? 'DHL-Sendungsnummer: ' + b.sendungsnummer + '\nSendung verfolgen: ' + link : 'Das Paket ist ohne Sendungsnummer unterwegs.', '',
    'Lieferadresse:', adresseZeilen(b).join('\n'), '',
    'Viel Freude mit der Krone! Wir freuen uns über ein Foto von deinem Hund (Instagram: @' + INSTAGRAM + ').',
    'Fragen? Antworte einfach auf diese Mail oder schreib uns per WhatsApp: https://wa.me/' + WHATSAPP, '',
    'Liebe Grüße', 'Sara & Mila', '', '--',
    'Sternenstaubhandmade · Inhaberin Sara Schwarz · Vogesenweg 8 · 75045 Walzbachtal · ' + SHOP_EMAIL
  ].join('\n');
  const html = mailLayout({ titel: betreff, vorschau: 'Bestellung ' + b.nr + ' ist unterwegs' + (b.sendungsnummer ? ', Sendungsnummer ' + b.sendungsnummer : '') + '.', inhalt: inhalt, fussRecht: false });
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

/* ---------------- 7) Etsy ---------------- */
// Etsy Open API v3, „Seller App“ (nur der eigene Shop). Anmeldung: OAuth 2 mit PKCE.
// Das Zugriffs-Token gilt 1 Stunde und wird mit dem Erneuerungs-Token (90 Tage) selbst erneuert.
const ETSY_API = 'https://api.etsy.com/v3';
const ETSY_ANMELDUNG = 'https://www.etsy.com/oauth/connect';
const ETSY_RUECKKEHR = 'https://kronenwelt.de/admin.html';   // muss bei Etsy genau so als Callback-URL eingetragen sein
const ETSY_RECHTE = 'transactions_r shops_r';                // nur lesen: Bestellungen und Shop-Nummer

function etsyProps() { return PropertiesService.getScriptProperties(); }
function etsyZugang() {
  const p = etsyProps(), key = p.getProperty('ETSY_KEYSTRING'), secret = p.getProperty('ETSY_SECRET');
  return key && secret ? { key: key, secret: secret } : null;
}
function etsyTokenLesen() {
  try { return JSON.parse(etsyProps().getProperty('ETSY_TOKEN') || 'null'); } catch (e) { return null; }
}
// 'fehlt' = Zugang nicht eingetragen · 'eingerichtet' = Zugang da, Shop noch nicht verbunden · 'verbunden'
function etsyStatus() {
  if (!etsyZugang()) return 'fehlt';
  const t = etsyTokenLesen();
  return t && t.refresh ? 'verbunden' : 'eingerichtet';
}
function etsyOhnePolster(b64) { return String(b64).replace(/=+$/, ''); }

// Schritt 1: Adresse, auf der Sara bei Etsy den Zugriff erlaubt
function etsyStart() {
  const z = etsyZugang();
  if (!z) throw fehler('etsy_fehlt', 'Etsy-Zugang fehlt (ETSY_KEYSTRING und ETSY_SECRET im Apps Script eintragen)');
  const pruef = Utilities.getUuid() + Utilities.getUuid();          // 72 Zeichen, erlaubt sind A–Z a–z 0–9 . _ ~ -
  const state = Utilities.getUuid();
  const challenge = etsyOhnePolster(Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pruef, Utilities.Charset.UTF_8)));
  etsyProps().setProperty('ETSY_ANMELDUNG', JSON.stringify({ pruef: pruef, state: state, zeit: Date.now() }));
  const q = { response_type: 'code', client_id: z.key, redirect_uri: ETSY_RUECKKEHR, scope: ETSY_RECHTE,
    state: state, code_challenge: challenge, code_challenge_method: 'S256' };
  return { ok: true, url: ETSY_ANMELDUNG + '?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&') };
}

// Schritt 2: Etsy schickt Sara mit einem Code zurück zur Admin-Seite; hier wird er gegen die Tokens getauscht
function etsyCode(data) {
  const z = etsyZugang();
  if (!z) throw fehler('etsy_fehlt', 'Etsy-Zugang fehlt');
  let a = null;
  try { a = JSON.parse(etsyProps().getProperty('ETSY_ANMELDUNG') || 'null'); } catch (e) { a = null; }
  if (!a || !data.state || data.state !== a.state || Date.now() - a.zeit > 15 * 60000) {
    throw fehler('etsy_anmeldung_abgelaufen', 'Die Anmeldung bei Etsy ist abgelaufen. Bitte noch einmal „Mit Etsy verbinden“ klicken.');
  }
  etsyProps().setProperty('ETSY_ANMELDUNG', '');
  etsyTokenHolen(z, { grant_type: 'authorization_code', client_id: z.key, redirect_uri: ETSY_RUECKKEHR,
    code: String(data.code || ''), code_verifier: a.pruef });
  const ich = etsyAbrufen('/application/users/me');
  if (!ich.shop_id) throw fehler('etsy_kein_shop', 'Zu diesem Etsy-Konto gehört kein Shop.');
  const p = etsyProps();
  p.setProperty('ETSY_SHOP_ID', String(ich.shop_id));
  // Nur Bestellungen ab jetzt übernehmen: ältere hat Sara schon von Hand eingetragen
  if (!p.getProperty('ETSY_AB')) p.setProperty('ETSY_AB', String(Math.floor(Date.now() / 1000)));
  return { ok: true, etsy: 'verbunden', shop: String(ich.shop_id) };
}

function etsyTrennen() {
  const p = etsyProps();
  p.setProperty('ETSY_TOKEN', ''); p.setProperty('ETSY_ANMELDUNG', '');
  return { ok: true, etsy: etsyStatus() };
}

function etsyTokenHolen(z, felder) {
  const r = UrlFetchApp.fetch(ETSY_API + '/public/oauth/token', { method: 'post', muteHttpExceptions: true,
    headers: { 'x-api-key': z.key + ':' + z.secret }, payload: felder });
  let d = {};
  try { d = JSON.parse(r.getContentText()); } catch (e) { d = {}; }
  if (r.getResponseCode() !== 200 || !d.access_token) {
    if (felder.grant_type === 'refresh_token' && r.getResponseCode() >= 400 && r.getResponseCode() < 500) etsyProps().setProperty('ETSY_TOKEN', '');
    throw fehler('etsy_anmeldung', 'Etsy hat die Anmeldung abgelehnt (' + r.getResponseCode() + (d.error_description ? ': ' + d.error_description : d.error ? ': ' + d.error : '') + '). Bitte neu verbinden.');
  }
  const t = { access: d.access_token, refresh: d.refresh_token || felder.refresh_token || '', bis: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  etsyProps().setProperty('ETSY_TOKEN', JSON.stringify(t));
  return t;
}

// Gültiges Zugriffs-Token; kurz vor Ablauf wird es erneuert
function etsyToken(z) {
  let t = etsyTokenLesen();
  if (!t || !t.refresh) throw fehler('etsy_nicht_verbunden', 'Etsy ist noch nicht verbunden.');
  if (!t.access || Date.now() > t.bis - 120000) t = etsyTokenHolen(z, { grant_type: 'refresh_token', client_id: z.key, refresh_token: t.refresh });
  return t.access;
}

function etsyAbrufen(pfad) {
  const z = etsyZugang();
  if (!z) throw fehler('etsy_fehlt', 'Etsy-Zugang fehlt');
  const r = UrlFetchApp.fetch(ETSY_API + pfad, { method: 'get', muteHttpExceptions: true,
    headers: { 'x-api-key': z.key + ':' + z.secret, 'Authorization': 'Bearer ' + etsyToken(z) } });
  if (r.getResponseCode() !== 200) throw fehler('etsy_fehler', 'Etsy antwortet mit Fehler ' + r.getResponseCode());
  return JSON.parse(r.getContentText());
}

function etsyGeld(g) { return g && Number(g.divisor) ? Number(g.amount) / Number(g.divisor) : 0; }

// Eine Etsy-Bestellung („Receipt“) in die Felder der Tabelle übersetzen. Jede Krone ist eine Position.
// Welcher Katalog-Artikel gemeint ist, steht (in dieser Reihenfolge)
//   1. in der SKU bei Etsy, wenn dort unsere Artikelnummer eingetragen ist, oder
//   2. im Blatt „Etsy-Artikel“ (zuordnung: Etsy-Nr. → Krone und Farbe).
// Dann bucht auch das Lager ab. Sonst steht der Etsy-Text in der Bestellung.
function etsyPositionen(receipt, katalog, zuordnung) {
  const groessen = (((katalog || {}).merkmale || {}).groesse || {}).werte || [];
  const kurz = function (x, n) { return String(x == null ? '' : x).replace(/\s+/g, ' ').replace(/\s*[,|]\s*/g, ' / ').trim().slice(0, n); };
  const liste = [];
  (receipt.transactions || []).forEach(function (t) {
    const vars = Array.isArray(t.variations) ? t.variations : [];
    let pers = '', groesse = '', zusatz = '';
    const rest = [];
    vars.forEach(function (v) {
      const name = String(v.formatted_name || ''), wert = String(v.formatted_value || '').trim();
      if (!wert) return;
      if (/personali/i.test(name)) { pers = wert; return; }
      let treffer = null, laenge = 0;                       // „Extra Mini“ vor „Mini“: der längste passende Name gewinnt
      groessen.forEach(function (x) {
        [x.wert, x.name].forEach(function (n) {
          if (n && String(n).length > laenge && wert.toLowerCase().indexOf(String(n).toLowerCase()) === 0) { treffer = x; laenge = String(n).length; }
        });
      });
      if (treffer && !groesse) { groesse = treffer.wert; zusatz = wert.slice(laenge).trim(); return; }   // „Groß + 3 Pet“ → Gross, „+ 3 Pet“
      rest.push(wert);
    });
    const mitZusatz = function (g) { return kurz(g + (zusatz ? ' ' + zusatz : ''), 40); };
    const sku = skuOk(String(t.sku || '').trim()) ? String(t.sku).trim() : '';
    const k = sku ? etsyArtikel(sku, katalog) : null;
    const z = !k && zuordnung ? zuordnung[String(t.listing_id || '')] : null;
    let p;
    if (k) {
      p = { variante: k.variante, farbe: k.farbe || kurz(rest.join(' / '), 60), groesse: k.groesse, sku: k.lagerSku };
    } else if (z && z.krone) {
      const a = etsyAusBlatt(z, rest, groesse, katalog);
      p = { variante: kurz(a.variante, 60), farbe: kurz(a.farbe || rest.join(' / '), 60), groesse: mitZusatz(groesse), sku: a.sku };
    } else {
      p = { variante: kurz(t.title, 60), farbe: kurz(rest.join(' / '), 60), groesse: mitZusatz(groesse), sku: '' };
    }
    p.pers = kurz(pers, 40);
    p.listing = String(t.listing_id || '');
    p.titel = String(t.title || '');
    p.preis = etsyGeld(t.price);
    const menge = Math.max(1, Math.min(20, parseInt(t.quantity, 10) || 1));
    for (let i = 0; i < menge; i++) liste.push(p);
  });
  return liste;
}

/* ---------------- Blatt „Etsy-Artikel“ ---------------- */
const ETSY_BLATT = 'Etsy-Artikel';
const ETSY_BLATT_SPALTEN = ['Etsy-Nr.', 'Titel', 'Preis (€)', 'Krone', 'Farbe', 'Hinweis'];
const ETSY_OFFEN = 'Bitte Krone und Farbe eintragen (wie im Katalog). Leer lassen, wenn es den Artikel im Katalog nicht gibt.';
const ETSY_KRONE_TITEL = 'Personalisierte handgemachte Hundekrone, individuelle Krone, perfekt für Geburtstag und Fotoshooting mit Hund, ';
// Vorschläge für die erste Befüllung (Stand 13.11.2026, mit Peter abgestimmt). preis = nur nötig, wo es den Titel zweimal gibt.
// Farbe mit „=“: Die Farbe hängt von der Etsy-Variante ab („Etsy-Wert = Farbe im Katalog; …“).
const ETSY_VORSCHLAG = [
  [ETSY_KRONE_TITEL + 'Gold', 'Edel & Wild', 'Gold'],
  [ETSY_KRONE_TITEL + 'schwarz', 'Edel & Wild', 'Schwarz'],
  [ETSY_KRONE_TITEL + 'rosa', 'Edel & Wild', 'Rosa', 14],
  [ETSY_KRONE_TITEL + 'rosa', 'Party', 'Rosa mit Punkten', 12],
  [ETSY_KRONE_TITEL + 'hellgrau', 'Party', 'Grau mit Punkten'],
  [ETSY_KRONE_TITEL + 'mint', 'Party', 'Mint mit Punkten'],
  [ETSY_KRONE_TITEL + 'petrol', 'Party', 'Petrol mit Punkten'],
  [ETSY_KRONE_TITEL + 'petrol mit weißen Punkten', 'Party', 'Petrol mit Punkten'],
  [ETSY_KRONE_TITEL + 'Konfetti', 'Party', 'Konfetti'],
  [ETSY_KRONE_TITEL + 'orange', 'Einfarbig', 'Orange'],
  [ETSY_KRONE_TITEL + 'berry', 'Einfarbig', 'Berry'],
  [ETSY_KRONE_TITEL + 'grün', 'Einfarbig', 'Grün'],
  [ETSY_KRONE_TITEL + 'blau', 'Glitzer', 'Blau', 14],
  [ETSY_KRONE_TITEL + 'weiß', 'Glitzer', 'Weiss'],
  [ETSY_KRONE_TITEL + 'pink', 'Glitzer', 'Pink'],
  [ETSY_KRONE_TITEL + 'silber', 'Glitzer', 'Silber'],
  [ETSY_KRONE_TITEL + 'türkis', 'Glitzer', 'Türkis'],
  ['Krone mit Leo Muster, Hundekrone, Geburtstag', 'Edel & Wild', 'Weiß schwarz = Leo Weiss; Braun schwarz = Leo Braun; Großes Muster = Leopard'],
  ['Handgemachte Hundekrone, drei Farben zur Auswahl, mit austauschbaren Zahlen nach Wahl, perfekt für Geburtstag und Fotoshooting mit Hund',
    'Zahlenkrone Klassik', 'Rosa = Rosa; Grün = Mint; Weiß/ bunte Punkte = Weiss/bunte Punkte'],
  ['Handgemachte Hundekrone Leo, mit austauschbaren Zahlen nach Wahl, perfekt für Geburtstag und Fotoshooting mit Hund',
    'Zahlenkrone Leo', 'Gold/Zahlen schwarz = Gold / Zahlen schwarz; Schwarz/Zahlen gold = Schwarz / Zahlen gold']
];
function etsyGleich(x) { return String(x == null ? '' : x).toLowerCase().replace(/ß/g, 'ss').replace(/[\s\/]+/g, ''); }

// Vorschlag für einen Etsy-Artikel. preis = Grundpreis des Artikels oder null (dann nur bei eindeutigem Titel).
function etsyVorschlag(titel, preis) {
  const t = String(titel || '').replace(/\s+/g, ' ').trim();
  const passend = ETSY_VORSCHLAG.filter(function (v) { return v[0] === t; });
  if (!passend.length) return null;
  if (passend.length === 1 && passend[0][3] == null) return passend[0];
  const genau = passend.filter(function (v) { return preis != null && v[3] === preis; });
  return genau.length === 1 ? genau[0] : null;
}

// Zeile aus dem Blatt → Katalog-Artikel. Ergebnis: Bezeichnung für die Bestellung und (wenn alles passt) die Lager-Artikelnummer.
function etsyAusBlatt(z, etsyWerte, groesse, katalog) {
  const k = katalog || {};
  let farbe = String(z.farbe || '').trim();
  if (farbe.indexOf('=') >= 0) {                              // „Etsy-Wert = Farbe im Katalog; …“
    let gefunden = '';
    farbe.split(';').forEach(function (teil) {
      const i = teil.indexOf('=');
      if (i < 0) return;
      const links = etsyGleich(teil.slice(0, i));
      if (!gefunden && (etsyWerte || []).some(function (w) { return etsyGleich(w) === links; })) gefunden = teil.slice(i + 1).trim();
    });
    farbe = gefunden;
  }
  const p = (k.produkte || []).filter(function (x) { return etsyGleich(x.name) === etsyGleich(z.krone); })[0];
  if (!p) return { variante: String(z.krone).trim(), farbe: farbe, sku: '' };       // freie Bezeichnung, z. B. „Nikolausmütze“
  const f = ((p.merkmale || {}).farbe || []).filter(function (x) { return farbe && etsyGleich(x.wert) === etsyGleich(farbe); })[0];
  const g = ((p.merkmale || {}).groesse || []).filter(function (x) { return x.wert === groesse; })[0];
  const gruppe = (k.gruppen || []).filter(function (x) { return x.id === p.gruppe; })[0] || {};
  const gk = ((((k.merkmale || {}).groesse || {}).werte || []).filter(function (x) { return x.wert === groesse; })[0] || {}).kuerzel;
  const sku = f && g && gk ? [gruppe.kuerzel, p.kuerzel, (f.lager && f.lager.kuerzel) || f.kuerzel, gk].join('-') : '';
  return { variante: p.name, farbe: f ? f.wert : farbe, sku: skuOk(sku) ? sku : '' };
}

// Blatt lesen: Etsy-Nr. → { zeile, krone, farbe }
function etsyBlattLesen(sheet) {
  const kopf = kopfzeile(sheet), n = sheet.getLastRow(), map = {};
  if (n < 2) return map;
  const sp = function (name) { return kopf.indexOf(name); };
  sheet.getRange(2, 1, n - 1, kopf.length).getDisplayValues().forEach(function (z, i) {
    const id = String(z[sp('Etsy-Nr.')] || '').trim();
    if (id) map[id] = { zeile: i + 2, titel: z[sp('Titel')], krone: String(z[sp('Krone')] || '').trim(), farbe: String(z[sp('Farbe')] || '').trim() };
  });
  return map;
}

// Neue Zeile für einen Etsy-Artikel; preis = Grundpreis (aus der Artikelliste) oder null (aus einer Bestellung)
function etsyBlattZeile(sheet, id, titel, preis) {
  const v = etsyVorschlag(titel, preis);
  sheet.appendRow([String(id), String(titel || '').replace(/\s+/g, ' ').trim(), preis == null ? '' : preis,
    v ? v[1] : '', v ? v[2] : '', v ? 'Vorschlag – bitte prüfen' : ETSY_OFFEN]);
  return v ? { krone: v[1], farbe: v[2] } : { krone: '', farbe: '' };
}

// Alle Etsy-Artikel im Verkauf ins Blatt „Etsy-Artikel“ holen. Vorhandene Zeilen (und was Sara eingetragen hat) bleiben.
function etsyArtikelAbgleich() {
  const shop = etsyProps().getProperty('ETSY_SHOP_ID');
  if (etsyStatus() !== 'verbunden' || !shop) throw fehler('etsy_nicht_verbunden', 'Etsy ist noch nicht verbunden.');
  const sheet = lagerBlatt(ETSY_BLATT, ETSY_BLATT_SPALTEN);
  const map = etsyBlattLesen(sheet);
  let offset = 0, gesamt = 0, neu = 0;
  do {
    const r = etsyAbrufen('/application/shops/' + encodeURIComponent(shop) + '/listings/active?limit=100&offset=' + offset);
    const liste = r.results || [];
    gesamt = Number(r.count) || 0;
    liste.forEach(function (l) {
      const id = String(l.listing_id || '');
      if (!id || map[id]) return;
      const z = etsyBlattZeile(sheet, id, l.title, l.price ? Math.round(etsyGeld(l.price) * 100) / 100 : null);
      map[id] = z; neu++;
    });
    offset += liste.length;
    if (!liste.length) break;
  } while (offset < gesamt && offset < 1000);
  const alle = Object.keys(map);
  return { ok: true, neu: neu, gesamt: alle.length, offen: alle.filter(function (id) { return !map[id].krone; }).length };
}

// Artikelnummer (KR-PARTY-ROSA-GR) → Krone, Farbe, Größe aus dem Katalog; unbekannt → null.
// Bei Etsy darf die Nummer mit dem Farbkürzel stehen (KR-ZKLASSIK-ROSA-GR) oder die Lager-Nummer (KR-ZKLASSIK-BASIS-GR).
// Zurück kommt immer die Lager-Nummer (lagerSku), wie bei Shop-Bestellungen; bei der Lager-Nummer bleibt die Farbe offen.
function etsyArtikel(sku, katalog) {
  const k = katalog || {};
  const gWerte = (((k.merkmale || {}).groesse || {}).werte) || [];
  let genau = null, lager = null;
  (k.produkte || []).forEach(function (p) {
    const gruppe = (k.gruppen || []).filter(function (g) { return g.id === p.gruppe; })[0] || {};
    ((p.merkmale || {}).farbe || []).forEach(function (f) {
      ((p.merkmale || {}).groesse || []).forEach(function (g) {
        const gk = (gWerte.filter(function (x) { return x.wert === g.wert; })[0] || {}).kuerzel;
        const lk = (f.lager && f.lager.kuerzel) || f.kuerzel;
        const lagerSku = [gruppe.kuerzel, p.kuerzel, lk, gk].join('-');
        if ([gruppe.kuerzel, p.kuerzel, f.kuerzel, gk].join('-') === sku) genau = genau || { variante: p.name, farbe: f.wert, groesse: g.wert, lagerSku: lagerSku };
        else if (lagerSku === sku) lager = lager || { variante: p.name, farbe: '', groesse: g.wert, lagerSku: lagerSku };
      });
    });
  });
  return genau || lager;
}

// Neue bezahlte Etsy-Bestellungen in die Tabelle übernehmen. Jede Etsy-Nummer nur einmal.
function etsyAbruf() {
  const p = etsyProps(), shop = p.getProperty('ETSY_SHOP_ID');
  if (etsyStatus() !== 'verbunden' || !shop) throw fehler('etsy_nicht_verbunden', 'Etsy ist noch nicht verbunden.');
  const ab = parseInt(p.getProperty('ETSY_AB'), 10) || Math.floor(Date.now() / 1000);
  const sheet = blatt(), kopf = spaltenSicherstellen(sheet);
  const vorhanden = {};
  const sp = kopf.indexOf('Plattform-Nr.') + 1, n = sheet.getLastRow();
  if (n > 1) sheet.getRange(2, sp, n - 1, 1).getDisplayValues().forEach(function (z) { if (z[0]) vorhanden[String(z[0]).trim()] = true; });
  let katalog = null;
  try { katalog = katalogLaden(); } catch (e) { katalog = null; }
  const artikelBlatt = lagerBlatt(ETSY_BLATT, ETSY_BLATT_SPALTEN);
  const zuordnung = etsyBlattLesen(artikelBlatt);
  const neu = [];
  let offset = 0, gesamt = 0;
  do {
    const r = etsyAbrufen('/application/shops/' + encodeURIComponent(shop) + '/receipts?was_paid=true&min_created=' + ab + '&limit=100&offset=' + offset);
    const liste = r.results || [];
    gesamt = Number(r.count) || 0;
    liste.forEach(function (rc) {
      const id = String(rc.receipt_id || '');
      if (!id || vorhanden[id] || /cancel/i.test(String(rc.status || ''))) return;
      vorhanden[id] = true;
      neu.push(rc);
    });
    offset += liste.length;
    if (!liste.length) break;
  } while (offset < gesamt && offset < 500);
  // Älteste zuerst, damit die Reihenfolge in der Tabelle stimmt
  neu.sort(function (a, b) { return (a.created_timestamp || a.create_timestamp || 0) - (b.created_timestamp || b.create_timestamp || 0); });
  const angelegt = [];
  neu.forEach(function (rc) {
    const pos = etsyPositionen(rc, katalog, zuordnung);
    if (!pos.length) return;
    // Etsy-Artikel, die noch nicht im Blatt stehen, dort eintragen: Sara kann sie dann zuordnen
    pos.forEach(function (x) {
      if (x.listing && !zuordnung[x.listing]) { etsyBlattZeile(artikelBlatt, x.listing, x.titel, null); zuordnung[x.listing] = { krone: '', farbe: '' }; }
    });
    const zeit = new Date(((rc.created_timestamp || rc.create_timestamp) || Math.floor(Date.now() / 1000)) * 1000);
    const nr = neueBestellnr(sheet, kopf, new Date());
    const alleSkus = pos.every(function (x) { return x.sku; });
    const zeile = zeileAnhaengen(sheet, kopf, {
      'Datum': Utilities.formatDate(zeit, 'Europe/Berlin', 'dd.MM.yyyy'),
      'Uhrzeit': Utilities.formatDate(zeit, 'Europe/Berlin', 'HH:mm'),
      'Bestellnr.': nr,
      'Variante': pos.map(function (x) { return x.variante; }).join(', '),
      'Farbe': pos.map(function (x) { return x.farbe; }).join(', '),
      'Grösse': pos.map(function (x) { return x.groesse; }).join(', '),
      'Personalisierung': pos.map(function (x) { return x.pers || 'ohne Namen'; }).join(' | '),
      'Preis (€)': Math.round(etsyGeld(rc.grandtotal) * 100) / 100,
      'Zahlung': 'Etsy',
      'Kundenname': String(rc.name || '').trim().slice(0, 100),
      'E-Mail': String(rc.buyer_email || '').trim().slice(0, 120),
      'Lieferadresse': String(rc.formatted_address || '').split(/\r?\n/).map(function (x) { return x.trim(); })
        .filter(function (x, i) { return x && !(i === 0 && x === String(rc.name || '').trim()); }).join(', ').slice(0, 300),
      'Status': 'Neu',
      'Kanal': 'Etsy',
      'Notiz': (alleSkus ? '' : 'Von Etsy übernommen, Krone noch nicht dem Katalog zugeordnet (Blatt „Etsy-Artikel“). ')
        + (rc.message_from_buyer ? 'Nachricht: ' + String(rc.message_from_buyer).replace(/\s+/g, ' ').trim().slice(0, 300) : ''),
      'Artikelnr.': artikelListe(pos.map(function (x) { return x.sku; })),
      'Kiste': alleSkus ? KANAL_KISTE['Etsy'] : OHNE_LAGER,
      'Plattform-Nr.': String(rc.receipt_id)
    });
    if (alleSkus) lagerAbgleichSicher(nr, bestellungLesen(sheet, kopf, zeile));
    angelegt.push(nr);
  });
  return { ok: true, neu: angelegt.length, bestellnummern: angelegt };
}

// Läuft per Zeitplan alle 15 Minuten (siehe etsyZeitplan). Fehler landen nur im Protokoll.
function etsyAutomatisch() {
  if (etsyStatus() !== 'verbunden') return;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const r = etsyAbruf();
    if (r.neu) Logger.log('Etsy: ' + r.neu + ' neue Bestellung(en) übernommen: ' + r.bestellnummern.join(', '));
  } catch (err) {
    Logger.log('Etsy-Abruf: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

/* Einmalig im Editor ausführen: holt neue Etsy-Bestellungen ab jetzt alle 15 Minuten von selbst.
   Erneut ausführen ist harmlos (der alte Zeitplan wird ersetzt). */
function etsyZeitplan() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'etsyAutomatisch') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('etsyAutomatisch').timeBased().everyMinutes(15).create();
  Logger.log('Etsy-Zeitplan eingerichtet: alle 15 Minuten. Status: ' + etsyStatus());
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

/* ---------------- 6) Zugänge der Admin-Seite: GitHub und Cloudinary ----------------
   Die Geheimnisse bleiben hier. Die Admin-Seite bekommt nur Dateiinhalte bzw. eine Unterschrift für einen Upload. */
const GITHUB_REPO_PFAD = 'wpeterchwarz-collab/kronenwelt.de';
const GITHUB_DATEIEN = ['katalog.json', 'preise.json', 'galerie.json', 'produktfotos.json', 'medien.json'];   // nur diese darf der Admin lesen/schreiben
const CLOUDINARY_CLOUD = 'dw6amyijc';
const CLOUDINARY_PARAMETER = ['public_id', 'overwrite', 'invalidate', 'eager', 'eager_async'];

function githubToken() { return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') || ''; }
function cloudinaryZugang() {
  const p = PropertiesService.getScriptProperties();
  const key = p.getProperty('CLOUDINARY_KEY'), secret = p.getProperty('CLOUDINARY_SECRET');
  return key && secret ? { key: key, secret: secret } : null;
}

function githubAbruf(methode, pfad, inhalt) {
  const t = githubToken();
  if (!t) throw fehler('github_fehlt', 'GitHub-Zugang fehlt: GITHUB_TOKEN in den Skript-Eigenschaften eintragen');
  const opt = { method: methode, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (inhalt) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(inhalt); }
  const r = UrlFetchApp.fetch('https://api.github.com/repos/' + GITHUB_REPO_PFAD + pfad, opt);
  let daten = {};
  try { daten = JSON.parse(r.getContentText()); } catch (e) {}
  return { code: r.getResponseCode(), daten: daten };
}
function githubFehler(r) {
  return r.code === 401 ? fehler('github_token_ungueltig', 'GitHub lehnt das Token ab (abgelaufen oder falsch?)')
    : fehler('github_fehler', 'GitHub: ' + ((r.daten && r.daten.message) || r.code));
}
function githubPfadPruefen(p) {
  if (GITHUB_DATEIEN.indexOf(p) < 0) throw fehler('datei_nicht_erlaubt', 'Diese Datei darf der Admin nicht ändern: ' + p);
}

// art „lesen“ (pfade: [...]) → { dateien: { pfad: { inhalt, sha } | null } }; „schreiben“ (pfad, inhalt, nachricht); „verlauf“
function githubAnfrage(data) {
  if (data.art === 'verlauf') {
    const r = githubAbruf('get', '/commits?per_page=6');
    if (r.code !== 200) throw githubFehler(r);
    return { ok: true, verlauf: (Array.isArray(r.daten) ? r.daten : []).map(function (c) {
      return { text: String((c.commit && c.commit.message) || '').split('\n')[0], datum: c.commit && c.commit.author && c.commit.author.date };
    }) };
  }
  if (data.art === 'lesen') {
    const pfade = Array.isArray(data.pfade) ? data.pfade.slice(0, 10) : [];
    pfade.forEach(githubPfadPruefen);
    const dateien = {};
    pfade.forEach(function (p) {
      const r = githubAbruf('get', '/contents/' + p);
      if (r.code === 404) { dateien[p] = null; return; }
      if (r.code !== 200) throw githubFehler(r);
      const bytes = Utilities.base64Decode(String(r.daten.content || '').replace(/\s/g, ''));
      dateien[p] = { inhalt: Utilities.newBlob(bytes).getDataAsString('UTF-8'), sha: r.daten.sha };
    });
    return { ok: true, dateien: dateien };
  }
  if (data.art === 'schreiben') {
    const p = String(data.pfad || '');
    githubPfadPruefen(p);
    const inhalt = String(data.inhalt == null ? '' : data.inhalt);
    if (!inhalt.trim() || inhalt.length > 2000000) throw fehler('ungueltiger_inhalt', 'Inhalt leer oder zu groß');
    try { JSON.parse(inhalt); } catch (e) { throw fehler('ungueltiger_inhalt', 'Kein gültiges JSON: ' + p); }
    const alt = githubAbruf('get', '/contents/' + p);
    if (alt.code !== 200 && alt.code !== 404) throw githubFehler(alt);
    const body = { message: String(data.nachricht || 'Admin: ' + p + ' aktualisiert').slice(0, 200),
      content: Utilities.base64Encode(inhalt, Utilities.Charset.UTF_8) };
    if (alt.code === 200) body.sha = alt.daten.sha;
    const r = githubAbruf('put', '/contents/' + p, body);
    if (r.code !== 200 && r.code !== 201) throw githubFehler(r);
    return { ok: true };
  }
  throw fehler('unbekannte_art', 'github: art fehlt');
}

// Unterschrift für einen Upload direkt vom Browser zu Cloudinary (das Secret verlässt das Apps Script nie)
function cloudinarySignatur(data) {
  const z = cloudinaryZugang();
  if (!z) throw fehler('cloudinary_fehlt', 'Cloudinary-Zugang fehlt: CLOUDINARY_KEY und CLOUDINARY_SECRET eintragen');
  const ein = data.params || {};
  const params = {};
  Object.keys(ein).forEach(function (k) {
    if (CLOUDINARY_PARAMETER.indexOf(k) < 0) throw fehler('parameter_nicht_erlaubt', 'Nicht erlaubt: ' + k);
    params[k] = String(ein[k]);
  });
  if (!params.public_id || !/^[A-Za-z0-9_\-\/]{1,120}$/.test(params.public_id)) throw fehler('ungueltige_id', 'public_id prüfen');
  params.timestamp = String(Math.floor(Date.now() / 1000));
  const text = Object.keys(params).sort().map(function (k) { return k + '=' + params[k]; }).join('&') + z.secret;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, text, Utilities.Charset.UTF_8);
  const signatur = digest.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  return { ok: true, cloud: CLOUDINARY_CLOUD, api_key: z.key, params: params, signature: signatur };
}

/* Nach dem Update auf 1.8 einmal ausführen: Google fragt ggf. nach der Erlaubnis für Anfragen ins Internet,
   und im Protokoll steht, ob GitHub und Cloudinary eingerichtet sind. */
function zugaengeTesten() {
  if (!githubToken()) Logger.log('GitHub: GITHUB_TOKEN fehlt in den Skript-Eigenschaften.');
  else {
    const r = githubAbruf('get', '/contents/katalog.json');
    Logger.log(r.code === 200 ? 'GitHub: Zugang klappt, katalog.json lesbar.' : 'GitHub: Fehler ' + r.code + ' – ' + ((r.daten && r.daten.message) || ''));
  }
  Logger.log(cloudinaryZugang() ? 'Cloudinary: Zugang ist eingetragen.' : 'Cloudinary: CLOUDINARY_KEY / CLOUDINARY_SECRET fehlen.');
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
  const sl = serienStatus();
  Logger.log(sl === 'fehlt' ? 'Seriennummernliste fehlt noch: SERIENLISTE_ID in den Skript-Eigenschaften eintragen.' : 'Seriennummernliste: zuletzt vergeben ' + sl + '.');
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
