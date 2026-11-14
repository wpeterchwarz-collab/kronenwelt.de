// Kronenwelt Admin – Bereiche, Navigation und Adresszeile
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// NAVIGATION
// Jeder Bereich ist ein Eintrag in BEREICHE. Ein neuer Bereich (z. B. Bestellungen, Lager)
// = ein neuer Eintrag hier + ein <div id="tab-…" class="content">. Navigation, Unterreiter
// und Adresszeile (#produkte/medien) bauen sich daraus von selbst.
// ============================================================
const ADMIN_VERSION = '1.4';
const ADMIN_NEU = 'Etsy-Bestellungen kommen von selbst; „+ Bestellung“ ist jetzt für Amazon, Markt und Instagram gedacht und verhindert doppelte Etsy-Einträge.';
const ICON = {
  start:    '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/></svg>',
  bestellungen: '<svg viewBox="0 0 24 24"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5"/><path d="M12 12v9"/></svg>',
  lager:    '<svg viewBox="0 0 24 24"><path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-9h10v9"/><path d="M7 16h10"/></svg>',
  produkte: '<svg viewBox="0 0 24 24"><path d="M3 7l5 5 4-7 4 7 5-5-2 12H5z"/><path d="M5 19h14"/></svg>',
  galerie:  '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  einstellungen: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};
const BEREICHE = [
  { id: 'start',         titel: 'Start',         seiten: [{ id: 'start' }] },
  { id: 'bestellungen',  titel: 'Bestellungen',  seiten: [{ id: 'bestellungen' }] },
  { id: 'lager',         titel: 'Lager',         seiten: [{ id: 'lager' }] },
  { id: 'produkte',      titel: 'Produkte',      seiten: [{ id: 'preise', titel: 'Preise' }, { id: 'medien', titel: 'Fotos & Video' }] },
  { id: 'galerie',       titel: 'Galerie',       seiten: [{ id: 'galerie' }] },
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
}
// Alter Name, falls irgendwo noch benutzt
function showTab(name) { geheZu(name); }

function seiteAusAdresse() {
  const [b, s] = location.hash.replace('#', '').split('/');
  geheZu(s || b || 'start', true);
}
window.addEventListener('popstate', seiteAusAdresse);
