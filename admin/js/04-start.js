// Kronenwelt Admin – Startseite
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// START: Übersicht
// ============================================================
let fotoPruefung = null;                      // Ergebnis der Hauptfoto-Prüfung (einmal pro Laden)
let fotoPruefungLaeuft = 0;                   // Nummer der laufenden Prüfung (ältere Ergebnisse verwerfen)
let datenGeladen = false;
const KLEINUNTERNEHMER_GRENZE = 25000;        // § 19 UStG: Umsatz im Vorjahr höchstens 25.000 € (seit 2025)
const KLEINUNTERNEHMER_LAUFEND = 100000;      // … und im laufenden Jahr höchstens 100.000 €

function renderUebersicht() {
  const d = document.getElementById('startDatum');
  if (d) d.textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const v = document.getElementById('adminVersion');
  if (v) v.textContent = 'Admin ' + ADMIN_VERSION + ' · Neu: ' + ADMIN_NEU;

  renderStartZahlen();
  renderStartBestellungen();
  renderStartMonat();
  if (!bestellungen && apiKonfiguriert()) ladeBestellungen();
  if (!lagerDaten && !lagerLaden && !lagerFehler && apiKonfiguriert() && KATALOG) ladeLager();
  renderTodo();
  if (datenGeladen && !fotoPruefung && !fotoPruefungLaeuft) pruefeHauptfotos().then(() => renderTodo());
  ladeVerlauf();
}

// Katalogzahlen (unter „Shop pflegen“)
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

// ---------- Kennzahlen aus der Bestelltabelle ----------
// "13.11.2026" → { jahr: 2026, monat: 11 }
function datumJM(d) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(d || '');
  return m ? { jahr: +m[3], monat: +m[2] } : null;
}
// Umsatz zählt ohne Storno und ohne Spenden; Spenden werden extra gezählt (Kronen)
function startStatistik(liste, heute) {
  heute = heute || new Date();
  const j = heute.getFullYear(), m = heute.getMonth() + 1;
  const vor = m === 1 ? { jahr: j - 1, monat: 12 } : { jahr: j, monat: m - 1 };
  const leer = () => ({ umsatz: 0, anzahl: 0, kronen: 0, spenden: 0, kanaele: {} });
  const monat = leer(), vormonat = leer(), jahr = leer();
  (liste || []).forEach(b => {
    if (b.status === 'Storniert') return;
    const dm = datumJM(b.datum);
    if (!dm) return;
    const ziele = [];
    if (dm.jahr === j) ziele.push(jahr);
    if (dm.jahr === j && dm.monat === m) ziele.push(monat);
    if (dm.jahr === vor.jahr && dm.monat === vor.monat) ziele.push(vormonat);
    const n = positionen(b).length;
    ziele.forEach(z => {
      if (b.kanal === 'Spende') { z.spenden += n; return; }
      const p = Number(b.preis) || 0;
      z.umsatz += p; z.anzahl++; z.kronen += n;
      z.kanaele[b.kanal || 'Sonstiges'] = (z.kanaele[b.kanal || 'Sonstiges'] || 0) + p;
    });
  });
  const runden = x => Math.round(x * 100) / 100;
  [monat, vormonat, jahr].forEach(z => { z.umsatz = runden(z.umsatz); Object.keys(z.kanaele).forEach(k => { z.kanaele[k] = runden(z.kanaele[k]); }); });
  return { jahr: j, monat, vormonat, jahresumsatz: jahr };
}
const euroKurz = x => (Math.round(x) === x ? String(x) : x.toFixed(2).replace('.', ',')).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';

function renderStartMonat() {
  const box = document.getElementById('startMonat');
  if (!box) return;
  const titel = document.getElementById('startMonatTitel');
  if (titel) titel.textContent = new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  if (!apiKonfiguriert()) { box.innerHTML = '<div class="leise">Sobald die Bestelltabelle verbunden ist, stehen hier Umsatz und Bestellungen.</div>'; return; }
  if (!bestellungen) { box.innerHTML = `<div class="leise">${bestellFehler ? medienEsc(bestellFehler) : 'Wird geladen …'}</div>`; return; }
  const s = startStatistik(bestellungen);
  const mo = s.monat, vm = s.vormonat;
  const trend = (jetzt, vorher, fmt) => {
    if (!vorher) return '<span class="trend">Vormonat: –</span>';
    const d = jetzt - vorher;
    return `<span class="trend ${d > 0 ? 'hoch' : d < 0 ? 'runter' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} Vormonat ${fmt(vorher)}</span>`;
  };
  const zahlen = `<div class="monat-zahlen">
    <div><b>${euroKurz(mo.umsatz)}</b><span>Umsatz</span>${trend(mo.umsatz, vm.umsatz, euroKurz)}</div>
    <div><b>${mo.anzahl}</b><span>${mo.anzahl === 1 ? 'Bestellung' : 'Bestellungen'}</span>${trend(mo.anzahl, vm.anzahl, String)}</div>
    <div><b>${mo.kronen}</b><span>Kronen verkauft</span>${mo.spenden ? `<span class="trend">+ ${mo.spenden} verschenkt</span>` : ''}</div>
  </div>`;
  const kan = Object.entries(mo.kanaele).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...kan.map(k => k[1]));
  const kanaele = kan.length ? `<div class="kanal-balken">${kan.map(([k, w]) =>
    `<span>${medienEsc(k)}</span><span class="bar"><i style="width:${Math.max(2, Math.round(w / max * 100))}%"></i></span><span class="wert">${euroKurz(w)}</span>`).join('')}</div>`
    : '<div class="leise" style="margin-bottom:14px">Diesen Monat noch kein Verkauf.</div>';
  const ju = s.jahresumsatz.umsatz, anteil = ju / KLEINUNTERNEHMER_GRENZE;
  const stufe = anteil >= 1 ? 'drueber' : anteil >= 0.8 ? 'knapp' : '';
  const grenze = `<div class="grenze ${stufe}"><b>Umsatz ${s.jahr}: ${euroKurz(ju)}</b> von ${euroKurz(KLEINUNTERNEHMER_GRENZE)}
    <div class="bar"><i style="width:${Math.min(100, Math.round(anteil * 100))}%"></i></div>
    <span class="leise">${anteil >= 1
      ? `Über ${euroKurz(KLEINUNTERNEHMER_GRENZE)}: Ab ${s.jahr + 1} gilt die Kleinunternehmerregelung voraussichtlich nicht mehr. Bitte mit dem Steuerberater sprechen.`
      : `Kleinunternehmerregelung: Bleibt der Umsatz ${s.jahr} unter ${euroKurz(KLEINUNTERNEHMER_GRENZE)}, gilt sie auch ${s.jahr + 1}.${anteil >= 0.8 ? ' Es wird knapp.' : ''}`}
    Laut Bestelltabelle, ohne Storno und Spenden.</span></div>`;
  box.innerHTML = zahlen + kanaele + grenze;
}

// ---------- Jetzt wichtig (nur, was zu tun ist) ----------
function startPunkte() {
  const punkte = [];
  if (bestellungen) {
    const offen = b => b.status === 'Neu' || b.status === 'In Arbeit';
    const verdacht = bestellungen.filter(b => /^PRÜFEN/.test(b.zahlungGeprueft || '') && offen(b)).length;
    if (verdacht) punkte.push({ stufe: 'wichtig', bestellungen: true,
      titel: verdacht === 1 ? '1 Bestellung: Zahlung prüfen' : verdacht + ' Bestellungen: Zahlung prüfen',
      text: 'PayPal hat den Betrag nicht bestätigt. Erst nachsehen, dann nähen.' });
    const neu = bestellungen.filter(b => b.status === 'Neu');
    if (neu.length) punkte.push({ stufe: 'wichtig', titel: neu.length === 1 ? '1 neue Bestellung' : neu.length + ' neue Bestellungen',
      text: '', bestellungen: true, liste: neu });
    const arbeit = bestellungen.filter(b => b.status === 'In Arbeit');
    if (arbeit.length) punkte.push({ stufe: '', titel: arbeit.length === 1 ? '1 Bestellung wartet auf Versand' : arbeit.length + ' Bestellungen warten auf Versand',
      text: '', bestellungen: true, liste: arbeit });
  }
  if (lagerDaten && KATALOG) {
    const nl = naehliste(), naehen = nl.reduce((n, x) => n + x.naehen, 0), umlagern = nl.reduce((n, x) => n + x.ausWerkstatt, 0);
    if (naehen || umlagern) punkte.push({ stufe: nl.some(x => x.offen) ? 'wichtig' : '', lager: true,
      titel: 'Nähliste: ' + [naehen ? naehen + (naehen === 1 ? ' Krone nähen' : ' Kronen nähen') : '', umlagern ? umlagern + ' aus der Werkstatt nachfüllen' : ''].filter(Boolean).join(', '),
      text: nl.some(x => x.offen) ? 'Darunter schon verkaufte Kronen, die nicht auf Lager waren.' : 'Kisten unter Mindestbestand. Tippen für die Liste.' });
  }
  // Fehlendes Hauptfoto = Lücke im Shop → wichtig
  if (fotoPruefung) fotoPruefung.fehlt.forEach(f => punkte.push({
    stufe: 'wichtig', titel: 'Hauptfoto fehlt: ' + f.v + (f.k === '_default' ? '' : ' – ' + f.k),
    text: 'Im Shop erscheint hier kein Foto. Tippen, um es hochzuladen.', ziel: f.v, farbe: f.k }));
  return punkte;
}
// Fotos und Videos: schön, aber nicht dringend → „Shop pflegen“
function pflegePunkte() {
  const punkte = [];
  kronenListe().forEach(k => {
    const alle = currentMedien[k] || {};
    const nFotos = Object.values(alle).reduce((n, e) => n + ((e && e.bilder) || []).length, 0);
    const hatVideo = Object.values(alle).some(e => e && e.video);
    if (!nFotos) punkte.push({ stufe: '', titel: k + ': noch keine weiteren Fotos', text: 'Kunden sehen nur das Hauptfoto.', ziel: k });
    else if (!hatVideo) punkte.push({ stufe: '', titel: k + ': noch kein Video', text: 'Ein kurzes Video zeigt die Krone in Bewegung.', ziel: k });
  });
  return punkte;
}
function todoHtml(p) {
  const klick = p.bestellungen ? `onclick="bestellFilter='offen';geheZu('bestellungen')"` : p.lager ? `onclick="lagerModus='bestand';geheZu('lager')"`
    : p.ziel ? `onclick="oeffneProduktFotos(${jsArg(p.ziel)}, ${jsArg(p.farbe || '')})"` : 'disabled';
  const liste = (p.liste || []).slice(0, 5).map(b => {
    const wt = werktageSeit(b.datum), warn = wt != null && wt >= LIEFERZEIT_WARNUNG && b.kanal !== 'Markt';
    return `<button class="todo-best" onclick="oeffneBestellung(${jsArg(b.nr)})">
      <span>${istUngesehen(b) ? '<span class="frisch-punkt" title="Neu seit deinem letzten Besuch"></span>' : ''}${medienEsc(b.kunde || b.kanal)} <small>· ${medienEsc(positionen(b).map(x => x.variante).join(', '))} · ${medienEsc(b.kanal)}</small></span>
      <span class="alter ${warn ? 'warn' : ''}">${wt == null ? '' : wt === 0 ? 'heute' : wt + (wt === 1 ? ' Werktag' : ' Werktage')}</span></button>`;
  }).join('') + ((p.liste || []).length > 5 ? `<div class="leise" style="padding:4px 0 0 21px">und ${p.liste.length - 5} weitere</div>` : '');
  return `<button class="todo" ${klick}>
      <span class="todo-punkt ${p.stufe}" ${p.stufe === 'leise' ? 'style="background:var(--line2)"' : ''}></span>
      <div><div class="todo-titel">${medienEsc(p.titel)}</div>${p.text ? `<div class="todo-text">${medienEsc(p.text)}</div>` : ''}</div>
    </button>` + liste;
}
function renderTodo() {
  const box = document.getElementById('startTodo');
  if (!box) return;
  const punkte = startPunkte();
  if (!fotoPruefung && datenGeladen) punkte.push({ stufe: 'leise', titel: 'Hauptfotos werden geprüft …', text: '' });
  box.innerHTML = punkte.length ? punkte.map(todoHtml).join('')
    : `<div class="todo"><span class="todo-punkt ok"></span><div><div class="todo-titel">Alles erledigt 🎉</div><div class="todo-text">${bestellungen ? 'Keine offenen Bestellungen, nichts zu nähen.' : 'Bestellungen werden geladen …'}</div></div></div>`;
  // Shop pflegen
  const pflege = pflegePunkte();
  const pBox = document.getElementById('startPflege');
  if (pBox) pBox.innerHTML = pflege.length ? pflege.map(todoHtml).join('') : '<div class="leise">Jedes Produkt hat Fotos und ein Video.</div>';
  const pZahl = document.getElementById('startPflegeZahl');
  if (pZahl) pZahl.textContent = pflege.length ? pflege.length + (pflege.length === 1 ? ' Hinweis' : ' Hinweise') : '';
  renderStartLage();
}
// Eine Zeile unter „Hallo Sara“: die Lage auf einen Blick
function renderStartLage() {
  const el = document.getElementById('startLage');
  if (!el) return;
  if (!bestellungen) { el.textContent = ''; return; }
  const neu = bestellungen.filter(b => b.status === 'Neu').length, arbeit = bestellungen.filter(b => b.status === 'In Arbeit').length;
  const naehen = lagerDaten && KATALOG ? naehliste().reduce((n, x) => n + x.naehen, 0) : 0;
  const teile = [neu ? `<b>${neu} ${neu === 1 ? 'neue Bestellung' : 'neue Bestellungen'}</b>` : '', arbeit ? arbeit + ' ' + (arbeit === 1 ? 'wartet' : 'warten') + ' auf Versand' : '',
    naehen ? naehen + (naehen === 1 ? ' Krone' : ' Kronen') + ' nähen' : ''].filter(Boolean);
  el.innerHTML = teile.length ? teile.join(' · ') : 'Alles erledigt 🎉';
}
function verkaufErfassen() {
  geheZu('bestellungen');
  formularOeffnen();
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
