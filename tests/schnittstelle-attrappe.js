// Nachbau der Kronenwelt-Schnittstelle für Tests: echter Code aus apps-script/Code.gs,
// aber mit nachgestellter Tabelle und nachgestellten Google-Diensten.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const KOPF = ['Datum', 'Uhrzeit', 'Bestellnr.', 'Variante', 'Farbe', 'Grösse', 'Personalisierung',
  'Preis (€)', 'Zahlung', 'Kundenname', 'E-Mail', 'Lieferadresse'];

// Nachgestellte Tabelle: zeilen = Anzeige-Werte, Preis zusätzlich als Zahl
function umgebung(zeilen, schluessel = 'GEHEIM123') {
  const daten = [KOPF.slice(), ...zeilen.map(z => z.slice())];
  const sheet = {
    getLastRow: () => daten.length,
    getLastColumn: () => KOPF.length,
    appendRow: r => daten.push(r.map(x => x)),
    getRange: (r, c, h = 1, w = 1) => ({
      getDisplayValues: () => daten.slice(r - 1, r - 1 + h).map(z => z.slice(c - 1, c - 1 + w).map(x =>
        typeof x === 'number' ? x.toFixed(2).replace('.', ',') + ' €' : String(x == null ? '' : x))),
      getValues: () => daten.slice(r - 1, r - 1 + h).map(z => z.slice(c - 1, c - 1 + w)),
      setBackground() {}, setNumberFormat() {}, setValues() {}, setFontColor() {}, setFontWeight() {}
    })
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, getName: () => 'Kronenwelt Bestellungen' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => schluessel, setProperty() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => ({ text: t }) }) },
    Utilities: { sleep() {}, formatDate: () => '07.11.2026', getUuid: () => 'x', computeDigest: () => [] },
    Logger: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { post, daten };
}

module.exports = { umgebung, KOPF };
