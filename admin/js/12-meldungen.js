// Kronenwelt Admin – Neue Bestellungen melden: Zähler an „Bestellungen“, Titel, App-Symbol, regelmäßiger Abgleich
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

const ABGLEICH_MS = 120000;                  // alle 2 Minuten nachsehen, solange der Admin offen und sichtbar ist
let letzterAbgleich = 0;
let abgleichLaeuft = false;

// „Neu seit deinem letzten Besuch“: höchste Bestellnummer, die Sara auf der Bestellseite schon gesehen hat
const GESEHEN_KEY = 'mkw_gesehen_bis';
let gesehenAnzeige = null;                   // Stand beim Öffnen der Bestellseite (damit die Punkte dort sichtbar bleiben)
const gesehenLesen = () => { try { return localStorage.getItem(GESEHEN_KEY); } catch (e) { return null; } };
const gesehenSchreiben = nr => { try { if (nr) localStorage.setItem(GESEHEN_KEY, nr); } catch (e) {} };
const hoechsteNr = liste => (liste || []).reduce((m, b) => b.nr && String(b.nr) > m ? String(b.nr) : m, '');
const aufBestellseite = () => { const t = document.getElementById('tab-bestellungen'); return !!t && t.style.display !== 'none'; };
function istUngesehen(b) {
  const g = aufBestellseite() ? gesehenAnzeige : gesehenLesen();
  return !!g && b.status === 'Neu' && String(b.nr) > g;
}
function gesehenBeimOeffnen() { gesehenAnzeige = gesehenLesen(); }

// Nach jedem Laden/Ändern der Bestellungen
function bestellungenAktualisiert() {
  letzterAbgleich = Date.now();
  if (!bestellungen) return;
  if (gesehenLesen() == null) gesehenSchreiben(hoechsteNr(bestellungen) || 'KW-0');   // erster Start: nichts als neu markieren
  if (aufBestellseite()) gesehenSchreiben(hoechsteNr(bestellungen));
  bestellZaehler(bestellungen);
}

function bestellZaehler(liste) {
  const neu = (liste || []).filter(b => b.status === 'Neu').length;
  const pruefen = (liste || []).some(b => /^PRÜFEN/.test(b.zahlungGeprueft || '') && (b.status === 'Neu' || b.status === 'In Arbeit'));
  const el = document.getElementById('navZahlBestellungen');
  if (el) {
    el.hidden = !neu && !pruefen;
    el.textContent = neu || '!';
    el.classList.toggle('rot', pruefen);
    el.title = (neu ? neu + (neu === 1 ? ' neue Bestellung' : ' neue Bestellungen') : '') + (pruefen ? (neu ? ', ' : '') + 'Zahlung prüfen' : '');
  }
  document.title = (neu ? '(' + neu + ') ' : '') + 'Kronenwelt Admin';
  try { if (navigator.setAppBadge) { if (neu) navigator.setAppBadge(neu); else navigator.clearAppBadge(); } } catch (e) {}
}

// Abgleich mit der Tabelle. Auf der Bestellseite wird nichts umgebaut (dort tippt Sara vielleicht gerade), sondern ein Hinweis gezeigt.
async function bestellAbgleich() {
  if (abgleichLaeuft || bestellLaden || !bestellungen || !apiKonfiguriert() || !_sessionPw) return;
  if (document.visibilityState === 'hidden') return;
  abgleichLaeuft = true;
  letzterAbgleich = Date.now();
  try {
    let r;
    try { r = await schnittstelle('bestellungen'); } catch (e) { return; }
    const liste = r.bestellungen || [];
    if (JSON.stringify(liste) === JSON.stringify(bestellungen)) return;
    const bekannt = new Set(bestellungen.map(b => b.nr));
    const frisch = liste.filter(b => !bekannt.has(b.nr));
    if (aufBestellseite()) {
      if (frisch.length) neuHinweis(frisch.length);
      bestellZaehler(liste);
    } else {
      bestellungen = liste;
      renderBestellungen();
      renderStartBestellungen();
      if (document.getElementById('tab-start').style.display !== 'none') { renderTodo(); renderStartMonat(); }
      bestellungenAktualisiert();
    }
    if (frisch.length) showStatus(frisch.length === 1
      ? 'Neue Bestellung: ' + (frisch[0].kunde || frisch[0].kanal) + ' · ' + positionen(frisch[0]).map(x => x.variante).join(', ')
      : frisch.length + ' neue Bestellungen eingegangen');
  } finally {
    abgleichLaeuft = false;
  }
}

function neuHinweis(n) {
  const el = document.getElementById('bestNeuHinweis');
  if (!el) return;
  el.innerHTML = `<span><b>${n === 1 ? 'Eine neue Bestellung' : n + ' neue Bestellungen'}</b> ist eingegangen.</span>
    <button class="btn btn-primary btn-sm" onclick="neuHinweisWeg();ladeBestellungen(true)">Anzeigen</button>`;
  el.style.display = 'flex';
}
function neuHinweisWeg() { const el = document.getElementById('bestNeuHinweis'); if (el) el.style.display = 'none'; }

setInterval(() => { if (Date.now() - letzterAbgleich >= ABGLEICH_MS - 1000) bestellAbgleich(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - letzterAbgleich > 30000) bestellAbgleich();   // zurück in die App
});
