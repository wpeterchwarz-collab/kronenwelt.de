// Nachbau der Kronenwelt-Schnittstelle für Tests: echter Code aus apps-script/Code.gs,
// aber mit nachgestellter Tabelle und nachgestellten Google-Diensten (Sheets, Mail, Sperre).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const KOPF = ['Datum', 'Uhrzeit', 'Bestellnr.', 'Variante', 'Farbe', 'Grösse', 'Personalisierung',
  'Preis (€)', 'Zahlung', 'Kundenname', 'E-Mail', 'Lieferadresse'];

// Ein nachgestelltes Tabellenblatt. geld = Zahlen werden wie Preise angezeigt ("17,00 €")
function blattAttrappe(daten, geld, kaputt) {
  const anzeige = x => typeof x === 'number' ? (geld ? x.toFixed(2).replace('.', ',') + ' €' : String(x)) : String(x == null ? '' : x);
  const zelle = (r, c) => (daten[r - 1] || [])[c - 1];
  const setze = (r, c, v) => { while (daten.length < r) daten.push([]); const z = daten[r - 1]; while (z.length < c) z.push(''); z[c - 1] = v; };
  const block = (r, c, h, w, f) => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => f(zelle(r + i, c + j))));
  return {
    getLastRow: () => daten.length,
    getLastColumn: () => Math.max(0, ...daten.map(z => { let n = z.length; while (n && (z[n - 1] === '' || z[n - 1] == null)) n--; return n; })),
    appendRow: r => { if (kaputt) throw new Error('Blatt gesperrt'); daten.push(r.slice()); },
    setFrozenRows() {},
    getRange: (r, c, h = 1, w = 1) => ({
      getDisplayValues: () => block(r, c, h, w, anzeige),
      getValues: () => block(r, c, h, w, x => x == null ? '' : x),
      getDisplayValue: () => anzeige(zelle(r, c)),
      setValue: v => { if (kaputt) throw new Error('Blatt gesperrt'); setze(r, c, v); },
      setValues: vs => { if (kaputt) throw new Error('Blatt gesperrt'); vs.forEach((z, i) => z.forEach((v, j) => setze(r + i, c + j, v))); },
      setBackground() {}, setNumberFormat() {}, setFontColor() {}, setFontWeight() {}
    })
  };
}

// zeilen = Werte wie in der Tabelle (Preis als Zahl); kopf = Kopfzeile (Standard: die 12 alten Spalten)
// blaetter = weitere Blätter { Name: [Zeilen inkl. Kopf] }, z. B. Lagerbewegungen; kaputt = Blätter, in die nicht geschrieben werden kann
function umgebung(zeilen, schluessel = 'GEHEIM123', { kopf = KOPF, blaetter = {}, kaputt = [], paypal = null, eigenschaften = {}, katalogText = null, serienliste = null } = {}) {
  // paypal = { orders: { ID: PayPal-Antwort }, falsch: true (Anmeldung scheitert) } → PAYPAL_CLIENT_ID/SECRET sind gesetzt
  // serienliste = Zeilen von Saras GPSR-Liste (inkl. Kopf) → eigene Tabelle, SERIENLISTE_ID ist gesetzt
  const props = Object.assign({ ADMIN_SCHLUESSEL: schluessel }, paypal ? { PAYPAL_CLIENT_ID: 'CID', PAYPAL_SECRET: 'GEHEIM' } : {},
    serienliste ? { SERIENLISTE_ID: 'SERIEN-ID' } : {}, eigenschaften);
  const serienDaten = serienliste ? serienliste.map(z => z.slice()) : null;
  const serienSheet = serienDaten ? blattAttrappe(serienDaten, false, kaputt.includes('Serienliste')) : null;
  const abrufe = [];
  const KATALOG_TEXT = katalogText || fs.readFileSync(path.join(__dirname, '..', 'katalog.json'), 'utf8');
  const cache = {};
  const antwortVon = (code, obj) => ({ getResponseCode: () => code, getContentText: () => typeof obj === 'string' ? obj : JSON.stringify(obj) });
  const fetchAttrappe = (url, opt = {}) => {
    abrufe.push({ url, opt });
    if (url === 'https://kronenwelt.de/katalog.json') return antwortVon(200, KATALOG_TEXT);
    if (/\/v1\/oauth2\/token$/.test(url)) return paypal && !paypal.falsch ? antwortVon(200, { access_token: 'TOKEN', expires_in: 32400 }) : antwortVon(401, { error: 'invalid_client' });
    const m = /\/v2\/checkout\/orders\/([^/]+)$/.exec(url);
    if (m) {
      if (opt.headers.Authorization !== 'Bearer TOKEN') return antwortVon(401, {});
      const o = paypal && paypal.orders && paypal.orders[decodeURIComponent(m[1])];
      return o ? antwortVon(200, o) : antwortVon(404, { name: 'RESOURCE_NOT_FOUND' });
    }
    throw new Error('Unerwarteter Abruf: ' + url);
  };
  const daten = [kopf.slice(), ...zeilen.map(z => z.slice())];
  const mails = [];
  const tabellen = { Bestellungen: daten };
  Object.keys(blaetter).forEach(n => { tabellen[n] = blaetter[n].map(z => z.slice()); });
  const sheets = {};
  const holen = n => tabellen[n] ? (sheets[n] = sheets[n] || blattAttrappe(tabellen[n], n === 'Bestellungen', kaputt.includes(n))) : null;
  const ss = {
    getSheetByName: holen,
    insertSheet: n => { tabellen[n] = []; return holen(n); },
    getSheets: () => [holen('Bestellungen')],
    getName: () => 'Kronenwelt Bestellungen'
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss,
      openById: id => { if (id !== 'SERIEN-ID' || !serienSheet) throw new Error('Datei nicht gefunden'); return { getSheets: () => [serienSheet] }; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] == null ? null : props[k], setProperty: (k, v) => { props[k] = v; } }) },
    UrlFetchApp: { fetch: fetchAttrappe },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => ({ text: t }) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: m => mails.push(m), getRemainingDailyQuota: () => 100 },
    Utilities: {
      sleep() {}, getUuid: () => 'x', computeDigest: () => [], base64Encode: t => Buffer.from(t).toString('base64'),
      formatDate: (d, tz, f) => f === 'HH:mm' ? '10:15' : f === 'yyyyMMdd' ? '20261107' : f === 'yyyy' ? '2026' : '07.11.2026'
    },
    Logger: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  // blatt('Lagerbewegungen') = Zeilen des Blatts (inkl. Kopf) oder undefined, wenn es (noch) nicht existiert
  return { post, daten, mails, blatt: n => tabellen[n], abrufe, serien: serienDaten };
}

// Antwort von PayPal auf GET /v2/checkout/orders/{id} für eine abgeschlossene Zahlung
function paypalZahlung(betrag, { status = 'COMPLETED', capture = 'COMPLETED', waehrung = 'EUR' } = {}) {
  const amount = { currency_code: waehrung, value: Number(betrag).toFixed(2) };
  return { status, purchase_units: [{ amount, payments: { captures: [{ status: capture, amount }] } }] };
}

module.exports = { umgebung, KOPF, paypalZahlung };
