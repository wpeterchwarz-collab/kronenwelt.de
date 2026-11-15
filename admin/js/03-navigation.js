// Kronenwelt Admin – Bereiche, Navigation und Adresszeile
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// NAVIGATION
// Jeder Bereich ist ein Eintrag in BEREICHE. Ein neuer Bereich (z. B. Bestellungen, Lager)
// = ein neuer Eintrag hier + ein <div id="tab-…" class="content">. Navigation, Unterreiter
// und Adresszeile (#produkte/medien) bauen sich daraus von selbst.
// ============================================================
const ADMIN_VERSION = '1.12';
const ADMIN_NEU = 'Neuer Knopf „Versenden + Rechnung“: markiert als versendet, schreibt die Rechnung fest und öffnet gleich den Druck.';

// Shops: jede Bestellung gehört zu einem Shop (Farbe in Listen). Ein weiterer Shop = ein Eintrag hier.
// etsy = Name des Etsy-Shops, so wie er in der Spalte „Shop“ steht; der erste Shop ist der Standard (Webshop, Amazon, Markt …)
const SHOPS = [
  { id: 'kronenwelt', name: "Mila's Kronenwelt", kurz: 'Kronenwelt', farbe: '#e3bfc4', etsy: 'MilasKronenwelt' },
  { id: 'sternenstaub', name: 'Sternenstaubhandmade', kurz: 'Sternenstaub', farbe: '#b9a5cf', etsy: 'Sternenstaubhandmade' }
];
function shopVon(b) {
  const s = String((b && b.shop) || '').toLowerCase().replace(/\s+/g, '');
  return SHOPS.find(x => s && (x.etsy.toLowerCase() === s || x.name.toLowerCase().replace(/\s+/g, '') === s)) || SHOPS[0];
}
// ---------- Filter nach Shop und Kanal (gemeinsam für Bestellungen und Rechnungen) ----------
// Die Auswahl gilt in beiden Listen: wer „Sternenstaub“ wählt, sieht dort nur dessen Bestellungen und Rechnungen.
let shopFilter = '';                          // '' = alle Shops, sonst SHOPS[].id
let kanalFilter = '';                         // '' = alle Kanäle, sonst z. B. 'Etsy'
const KANAL_REIHENFOLGE = ['Etsy', 'Webshop', 'Amazon', 'Markt', 'Instagram', 'Spende', 'Sonstiges'];
const filterAktiv = () => !!(shopFilter || kanalFilter);
function filterPasst(x, shopFn, kanalFn) {
  return (!shopFilter || shopFn(x).id === shopFilter) && (!kanalFilter || kanalFn(x) === kanalFilter);
}
// basis = Liste vor dem Shop-/Kanal-Filter (Zahlen an den Knöpfen); neuZeichnen = JS, das danach läuft
function filterLeisteHtml(basis, shopFn, kanalFn, neuZeichnen) {
  const mitKanal = basis.filter(x => !kanalFilter || kanalFn(x) === kanalFilter);
  // „Alle Shops“ ohne Zahl (sonst liest sich „Alle Shops 3“ wie „3 Shops“); bei den Shops = Anzahl Bestellungen bzw. Rechnungen
  const chip = (id, inhalt, n) => `<button type="button" class="shop-chip ${shopFilter === id ? 'active' : ''}" aria-pressed="${shopFilter === id}"
    onclick="shopFilter='${id}';${neuZeichnen}">${inhalt}${n == null ? '' : `<span class="anzahl" title="${n} ${n === 1 ? 'Eintrag' : 'Einträge'}">${n}</span>`}</button>`;
  const vorhanden = new Set(basis.map(kanalFn));
  if (kanalFilter) vorhanden.add(kanalFilter);
  const kanaele = [...vorhanden].filter(Boolean).sort((a, b) => (KANAL_REIHENFOLGE.indexOf(a) + 99) % 99 - (KANAL_REIHENFOLGE.indexOf(b) + 99) % 99 || a.localeCompare(b));
  return `<div class="filter-leiste" role="group" aria-label="Nach Shop und Kanal filtern">
    ${chip('', 'Alle Shops', null)}
    ${SHOPS.map(s => chip(s.id, `<span class="shop-punkt" style="background:${s.farbe}" aria-hidden="true"></span>${medienEsc(s.kurz)}`,
      mitKanal.filter(x => shopFn(x).id === s.id).length)).join('')}
    <select class="kanal-wahl ${kanalFilter ? 'active' : ''}" aria-label="Kanal" onchange="kanalFilter=this.value;${neuZeichnen}">
      <option value="">Alle Kanäle</option>${kanaele.map(k => `<option ${k === kanalFilter ? 'selected' : ''}>${medienEsc(k)}</option>`).join('')}</select>
    ${filterAktiv() ? `<button type="button" class="filter-weg" onclick="shopFilter='';kanalFilter='';${neuZeichnen}">Filter zurücksetzen</button>` : ''}
  </div>`;
}

const shopPunkt = b => { const s = shopVon(b); return `<span class="shop-punkt" style="background:${s.farbe}" title="${medienEsc(s.name)}" aria-label="${medienEsc(s.name)}" role="img"></span>`; };
const ICON = {
  start:    '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/></svg>',
  bestellungen: '<svg viewBox="0 0 24 24"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5"/><path d="M12 12v9"/></svg>',
  rechnungen: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h7M9 16h7"/></svg>',
  lager:    '<svg viewBox="0 0 24 24"><path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-9h10v9"/><path d="M7 16h10"/></svg>',
  produkte: '<svg viewBox="0 0 24 24"><path d="M3 7l5 5 4-7 4 7 5-5-2 12H5z"/><path d="M5 19h14"/></svg>',
  galerie:  '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  einstellungen: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};
const BEREICHE = [
  { id: 'start',         titel: 'Heute',         seiten: [{ id: 'start' }] },
  { id: 'bestellungen',  titel: 'Bestellungen',  seiten: [{ id: 'bestellungen' }] },
  { id: 'rechnungen',    titel: 'Rechnungen',    seiten: [{ id: 'rechnungen' }] },
  { id: 'lager',         titel: 'Lager',         seiten: [{ id: 'lager' }] },
  { id: 'produkte',      titel: 'Produkte',      seiten: [{ id: 'preise', titel: 'Preise' }, { id: 'medien', titel: 'Fotos & Video' }, { id: 'galerie', titel: 'Galerie' }] },
  { id: 'einstellungen', titel: 'Einstellungen', seiten: [{ id: 'einstellungen' }] }
];
const bereichVon = seite => BEREICHE.find(b => b.seiten.some(s => s.id === seite)) || BEREICHE[0];
const letzteSeite = {};                       // je Bereich die zuletzt offene Unterseite

function baueNavigation() {
  document.getElementById('hauptNav').innerHTML = BEREICHE.map(b =>
    `<button class="nav-item" data-nav="${b.id}" onclick="geheZu('${b.id}')">${ICON[b.id] || ''}<span>${b.titel}</span>${b.id === 'bestellungen' ? '<span class="nav-zahl" id="navZahlBestellungen" hidden></span>' : ''}</button>`).join('');
}

// Ziel: Bereich ('produkte') oder Unterseite ('medien')
function geheZu(ziel, ohneVerlauf) {
  const bereich = BEREICHE.find(b => b.id === ziel) || bereichVon(ziel);
  const seite = bereich.seiten.some(s => s.id === ziel) ? ziel : (letzteSeite[bereich.id] || bereich.seiten[0].id);
  letzteSeite[bereich.id] = seite;
  document.querySelectorAll('[id^="tab-"]').forEach(t => t.style.display = t.id === 'tab-' + seite ? 'block' : 'none');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.nav === bereich.id));
  const sub = document.getElementById('subNav');
  const mitUnter = bereich.seiten.length > 1;
  sub.classList.toggle('show', mitUnter);
  sub.innerHTML = mitUnter ? bereich.seiten.map(s =>
    `<button class="subnav-item ${s.id === seite ? 'active' : ''}" role="tab" data-seite="${s.id}" onclick="geheZu('${s.id}')">${medienEsc(s.titel)}</button>`).join('') : '';
  const hash = '#' + bereich.id + (mitUnter ? '/' + seite : '');
  if (!ohneVerlauf && location.hash !== hash) history.pushState(null, '', hash);
  window.scrollTo(0, 0);
  if (seite === 'start') renderUebersicht();
  if (seite === 'bestellungen') { gesehenBeimOeffnen(); ladeBestellungen(); if (bestellungen) bestellungenAktualisiert(); }
  if (seite === 'lager') ladeLager();
  if (seite === 'rechnungen') ladeRechnungen();
}
// Alter Name, falls irgendwo noch benutzt
function showTab(name) { geheZu(name); }

function seiteAusAdresse() {
  const [b, s] = location.hash.replace('#', '').split('/');
  geheZu(s || b || 'start', true);
}
window.addEventListener('popstate', seiteAusAdresse);
