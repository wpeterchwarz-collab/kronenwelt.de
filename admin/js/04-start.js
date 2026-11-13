// Kronenwelt Admin – Startseite
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// START: Übersicht
// ============================================================
let fotoPruefung = null;                      // Ergebnis der Hauptfoto-Prüfung (einmal pro Laden)
let fotoPruefungLaeuft = 0;                   // Nummer der laufenden Prüfung (ältere Ergebnisse verwerfen)
let datenGeladen = false;
function renderUebersicht() {
  const d = document.getElementById('startDatum');
  if (d) d.textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const v = document.getElementById('adminVersion');
  if (v) v.textContent = 'Admin ' + ADMIN_VERSION + ' · Neu: ' + ADMIN_NEU;

  renderStartZahlen();
  renderStartBestellungen();
  if (!bestellungen && apiKonfiguriert()) ladeBestellungen();
  if (!lagerDaten && !lagerLaden && !lagerFehler && apiKonfiguriert() && KATALOG) ladeLager();
  renderTodo();
  if (datenGeladen && !fotoPruefung && !fotoPruefungLaeuft) pruefeHauptfotos().then(() => renderTodo());
  ladeVerlauf();
}

function renderStartZahlen() {
  const kronen = kronenListe();
  let farben = 0, artikel = 0, fotos = 0, videos = 0;
  kronen.forEach(k => {
    const info = MEDIEN_VARIANTEN[k]; farben += info.farben.length;
    artikel += info.farben.length * groessenFuer(k).length;
    Object.values(currentMedien[k] || {}).forEach(e => { if (e) { fotos += (e.bilder || []).length; if (e.video) videos++; } });
  });
  const z = [[kronen.length, 'Produkte'], [farben, 'Farben'], [artikel, 'Artikel'], [fotos, 'weitere Fotos'], [videos, videos === 1 ? 'Video' : 'Videos'], [(currentGalerie || []).length, 'Galerie']];
  if (lagerDaten && KATALOG) z.splice(3, 0, [lagerSumme(null), 'auf Lager']);
  document.getElementById('startZahlen').innerHTML = z.map(([n, t]) => `<div class="zahl"><b>${n}</b><span>${t}</span></div>`).join('');
}

function renderTodo() {
  const box = document.getElementById('startTodo');
  if (!box) return;
  const punkte = [];
  // 0) Neue und angefangene Bestellungen
  if (bestellungen) {
    const neu = bestellungen.filter(b => b.status === 'Neu').length;
    const arbeit = bestellungen.filter(b => b.status === 'In Arbeit').length;
    if (neu) punkte.push({ stufe: 'wichtig', titel: neu === 1 ? '1 neue Bestellung' : neu + ' neue Bestellungen', text: 'Tippen, um sie anzusehen und zu bearbeiten.', bestellungen: true });
    if (arbeit) punkte.push({ stufe: '', titel: arbeit === 1 ? '1 Bestellung in Arbeit' : arbeit + ' Bestellungen in Arbeit', text: 'Versenden, sobald sie fertig sind.', bestellungen: true });
  }
  // 0a) Zahlung nicht bestätigt (offene Bestellungen)
  if (bestellungen) {
    const verdacht = bestellungen.filter(b => /^PRÜFEN/.test(b.zahlungGeprueft || '') && (b.status === 'Neu' || b.status === 'In Arbeit')).length;
    if (verdacht) punkte.unshift({ stufe: 'wichtig', bestellungen: true,
      titel: verdacht === 1 ? '1 Bestellung: Zahlung prüfen' : verdacht + ' Bestellungen: Zahlung prüfen',
      text: 'PayPal hat den Betrag nicht bestätigt. Erst nachsehen, dann nähen.' });
  }
  // 0b) Nähliste: Kronen unter Mindestbestand oder schon verkauft, aber nicht auf Lager
  if (lagerDaten && KATALOG) {
    const nl = naehliste(), naehen = nl.reduce((n, x) => n + x.naehen, 0), umlagern = nl.reduce((n, x) => n + x.ausWerkstatt, 0);
    if (naehen || umlagern) punkte.push({ stufe: nl.some(x => x.offen) ? 'wichtig' : '', lager: true,
      titel: 'Nähliste: ' + [naehen ? naehen + (naehen === 1 ? ' Krone nähen' : ' Kronen nähen') : '', umlagern ? umlagern + ' aus der Werkstatt nachfüllen' : ''].filter(Boolean).join(', '),
      text: nl.some(x => x.offen) ? 'Darunter schon verkaufte Kronen, die nicht auf Lager waren.' : 'Kisten unter Mindestbestand. Tippen für die Liste.' });
  }
  // 1) Hauptfotos, die bei Cloudinary fehlen (wichtig: Lücke im Shop)
  if (fotoPruefung) fotoPruefung.fehlt.forEach(f => punkte.push({
    stufe: 'wichtig', titel: 'Hauptfoto fehlt: ' + f.v + (f.k === '_default' ? '' : ' – ' + f.k),
    text: 'Im Shop erscheint hier kein Foto. Tippen, um es hochzuladen.', ziel: f.v, farbe: f.k }));
  // 2) Produkte ohne weitere Fotos bzw. ohne Video
  kronenListe().forEach(k => {
    const alle = currentMedien[k] || {};
    const nFotos = Object.values(alle).reduce((n, e) => n + ((e && e.bilder) || []).length, 0);
    const hatVideo = Object.values(alle).some(e => e && e.video);
    if (!nFotos) punkte.push({ stufe: '', titel: k + ': noch keine weiteren Fotos', text: 'Kunden sehen nur das Hauptfoto.', ziel: k });
    else if (!hatVideo) punkte.push({ stufe: '', titel: k + ': noch kein Video', text: 'Ein kurzes Video zeigt die Krone in Bewegung.', ziel: k });
  });
  if (!fotoPruefung) punkte.unshift({ stufe: 'leise', titel: 'Hauptfotos werden geprüft …', text: '' });
  if (!punkte.length) { box.innerHTML = '<div class="todo"><span class="todo-punkt ok"></span><div><div class="todo-titel">Alles erledigt</div><div class="todo-text">Jedes Produkt hat Fotos und ein Video.</div></div></div>'; return; }
  box.innerHTML = punkte.slice(0, 8).map((p, i) => `
    <button class="todo" ${p.bestellungen ? `onclick="bestellFilter='offen';geheZu('bestellungen')"` : p.lager ? `onclick="lagerModus='bestand';geheZu('lager')"` : p.ziel ? `onclick="oeffneProduktFotos(${JSON.stringify(p.ziel).replace(/"/g, '&quot;')}, ${JSON.stringify(p.farbe || '').replace(/"/g, '&quot;')})"` : 'disabled'}>
      <span class="todo-punkt ${p.stufe}" ${p.stufe === 'leise' ? 'style="background:var(--line2)"' : ''}></span>
      <div><div class="todo-titel">${medienEsc(p.titel)}</div>${p.text ? `<div class="todo-text">${medienEsc(p.text)}</div>` : ''}</div>
    </button>`).join('') + (punkte.length > 8 ? `<div class="leise" style="padding-top:8px">und ${punkte.length - 8} weitere</div>` : '');
}

// Vom Start direkt zur Fotokarte des Produkts springen (aufgeklappt, Farbe gewählt)
function oeffneProduktFotos(v, farbe) {
  medienOffen[v] = true;
  if (farbe) medienAuswahl[v] = farbe;
  geheZu('medien');
  renderMedien();
  const vi = kronenListe().indexOf(v);
  const el = document.querySelector(`.fv-krone[data-vi="${vi}"]`);
  if (el) el.scrollIntoView({ block: 'start' });
}

// Prüft per Vorschaubild, ob jedes feste Hauptfoto bei Cloudinary existiert
function pruefeHauptfotos() {
  const liste = [];
  kronenListe().forEach(v => ['_default', ...MEDIEN_VARIANTEN[v].farben].forEach(k => {
    const id = hauptId(v, k);
    if (id && !liste.some(x => x.id === id)) liste.push({ v, k, id });
  }));
  const laden = x => new Promise(res => {
    const img = new Image();
    const t = setTimeout(() => res(true), 8000);           // langsames Netz: nicht als fehlend melden
    img.onload = () => { clearTimeout(t); res(true); };
    img.onerror = () => { clearTimeout(t); res(false); };
    img.src = hauptUrl(x.id, 'jpg', 40);
  });
  const nr = ++fotoPruefungLaeuft;
  return Promise.all(liste.map(laden)).then(ok => {
    if (nr !== fotoPruefungLaeuft) return;           // inzwischen neu geladen
    const fehlt = liste.filter((x, i) => !ok[i]);
    // Fehlt mehr als die Hälfte, liegt es eher am Netz als an den Fotos → nichts melden
    fotoPruefung = { fehlt: fehlt.length > liste.length / 2 ? [] : fehlt };
    fotoPruefungLaeuft = 0;
  });
}
