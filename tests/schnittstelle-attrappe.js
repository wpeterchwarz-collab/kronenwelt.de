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
      setValue: v => setze(r, c, v),
      setValues: vs => vs.forEach((z, i) => z.forEach((v, j) => setze(r + i, c + j, v))),
      setBackground() {}, setNumberFormat() {}, setFontColor() {}, setFontWeight() {}
    })
  };
}

// zeilen = Werte wie in der Tabelle (Preis als Zahl); kopf = Kopfzeile (Standard: die 12 alten Spalten)
// blaetter = weitere Blätter { Name: [Zeilen inkl. Kopf] }, z. B. Lagerbewegungen; kaputt = Blätter, in die nicht geschrieben werden kann
function umgebung(zeilen, schluessel = 'GEHEIM123', { kopf = KOPF, blaetter = {}, kaputt = [] } = {}) {
  const daten = [kopf.slice(), ...zeilen.map(z => z.slice())];
  const mails = [];
  const tabellen = { Bestellungen: daten };
  Object.keys(blaetter).forEach(n => { tabellen[n] = blaetter[n].map(z => z.slice()); });
  const sheets = {};
  const holen = n => tabellen[n] ? (sheets[n] = sheets[n] || blattAttrappe(tabellen[n], n === 'Bestellungen', kaputt.includes(n))) : null;
  const ss = {
    getSheetByName: holen,
    insertSheet: n => { tabellen[n] = []; return holen(n); },
    getName: () => 'Kronenwelt Bestellungen'
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => schluessel, setProperty() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => ({ text: t }) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: m => mails.push(m), getRemainingDailyQuota: () => 100 },
    Utilities: {
      sleep() {}, getUuid: () => 'x', computeDigest: () => [],
      formatDate: (d, tz, f) => f === 'HH:mm' ? '10:15' : f === 'yyyyMMdd' ? '20261107' : '07.11.2026'
    },
    Logger: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  // blatt('Lagerbewegungen') = Zeilen des Blatts (inkl. Kopf) oder undefined, wenn es (noch) nicht existiert
  return { post, daten, mails, blatt: n => tabellen[n] };
}

module.exports = { umgebung, KOPF };
