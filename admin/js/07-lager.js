// Kronenwelt Admin – Lager: Bestand je Kiste, Buchen, Inventur, Nähliste
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// LAGER
// Bestand = Summe der Lagerbewegungen in der Google-Tabelle, je Artikelnummer und Kiste.
// Kisten kommen von der Schnittstelle (dort ist die Liste), Artikel aus katalog.json.
// Verkäufe und Stornos bucht die Schnittstelle selbst; hier wird genäht, umgelagert, gezählt.
// ============================================================
let lagerDaten = null;              // { kisten, werkstatt, kanalKiste, bestand, mindest, bewegungen }
let lagerFehler = '';
let lagerLaden = null;
let lagerKiste = null;              // null = alle Kisten
let lagerModus = 'bestand';         // bestand | zaehlen | mindest
let lagerEingabe = {};              // Eingaben im Zähl- bzw. Mindestbestand-Modus: { sku: zahl }
const lagerOffen = {};              // aufgeklappte Produkte
let buchung = null;                 // Formular „+ Buchung“
const KISTEN_STANDARD = ['Markt & Webshop', 'Etsy', 'Amazon', 'Werkstatt'];
const KANAL_KISTE_STANDARD = { Webshop: 'Markt & Webshop', Markt: 'Markt & Webshop', Instagram: 'Markt & Webshop', Spende: 'Markt & Webshop', Etsy: 'Etsy', Amazon: 'Amazon' };
const lagerKisten = () => (lagerDaten && lagerDaten.kisten) || KISTEN_STANDARD;
const werkstatt = () => (lagerDaten && lagerDaten.werkstatt) || 'Werkstatt';
const kisteFuerKanal = k => ((lagerDaten && lagerDaten.kanalKiste) || KANAL_KISTE_STANDARD)[k] || '';
function lagerVeraltet() { if (lagerDaten) lagerDaten.veraltet = true; }
// Farbe je Kiste [kräftig, hell]. Neue Kisten bekommen automatisch eine aus der Reserve.
const KISTEN_FARBEN = { 'Markt & Webshop': ['#4d6d71', '#e3ebf1'], 'Etsy': ['#c0622f', '#f9ece7'], 'Amazon': ['#9a6d12', '#f9eeda'], 'Werkstatt': ['#3f7a5c', '#e5f4e4'] };
const KISTEN_RESERVE = [['#6a5acd', '#efedff'], ['#a8434b', '#fbebeb'], ['#3d6f9e', '#e7f1fb'], ['#7a7a7a', '#f0efec']];
function kisteFarbe(k) {
  if (KISTEN_FARBEN[k]) return KISTEN_FARBEN[k];
  const fremde = lagerKisten().filter(x => !KISTEN_FARBEN[x]);
  return KISTEN_RESERVE[Math.max(0, fremde.indexOf(k)) % KISTEN_RESERVE.length];
}
const kisteStil = k => { const [a, b] = kisteFarbe(k); return `--k:${a};--kb:${b}`; };
const kisteTag = k => `<span class="kiste-tag" style="${kisteStil(k)}">${medienEsc(k)}</span>`;
const KISTE_ICON = '<svg viewBox="0 0 24 24"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5"/><path d="M12 12v9"/></svg>';
// Wie viele Artikel fehlen in einer Kiste (unter Mindestbestand oder verkauft, aber nicht da)?
const kisteFehlt = k => Object.keys(lagerArtikel().nachSku).filter(sku => lagerFehlt(sku, k) > 0).length;

// Artikelnummer wie im Shop: Gruppe-Produkt-Merkmal-… (KR-PARTY-ROSA-GR). Zusätze („ + 6 Pets“) zählen nicht.
function artikelnummer(name, farbe, groesse, fuerLager = true) {   // im Admin immer die Lager-Artikelnummer
  const k = KATALOG;
  const p = k && (k.produkte || []).find(x => x.name === name);
  const g = p && (k.gruppen || []).find(x => x.id === p.gruppe);
  if (!g) return '';
  const werte = { farbe, groesse: String(groesse || '').replace(/\s*\+.*$/, '') };
  const teile = [g.kuerzel, p.kuerzel];
  for (const m of g.merkmale || []) {
    const am = ((p.merkmale || {})[m] || []).find(x => x.wert === werte[m]);
    const glob = (((k.merkmale || {})[m] || {}).werte || []).find(x => x.wert === werte[m]);
    const kz = (fuerLager && am && am.lager && am.lager.kuerzel) || (am && am.kuerzel) || (glob && glob.kuerzel);
    if (!am || !kz) return '';
    teile.push(kz);
  }
  return teile.join('-');
}

// Alle Artikel aus dem Katalog: Produkt → Farben × Größen, jeweils mit Artikelnummer und Preis
let _lagerArtikel = null, _lagerArtikelVon = null;
function lagerArtikel() {
  if (_lagerArtikelVon === KATALOG && _lagerArtikel) return _lagerArtikel;
  const produkte = [], nachSku = {};
  ((KATALOG && KATALOG.produkte) || []).forEach(p => {
    const groessen = (p.merkmale.groesse || []).map(g => g.wert);
    // Zeilen im Lager: je Farbe, außer Farben mit „lager“ im Katalog (z. B. Zahlenfarbe) – die liegen zusammen
    const farben = [], vertreter = [];
    (p.merkmale.farbe || []).forEach(f => {
      const n = (f.lager && f.lager.name) || f.wert;
      if (!farben.includes(n)) { farben.push(n); vertreter.push(f.wert); }
    });
    const zeilen = farben.map((n, i) => groessen.map(g => {
      const sku = artikelnummer(p.name, vertreter[i], g, true);
      const preis = ((currentPrices[p.name] || {})[g]) || ((p.merkmale.groesse.find(x => x.wert === g) || {}).preis) || 0;
      if (sku) nachSku[sku] = { sku, produkt: p.name, farbe: n, groesse: g, preis };
      return sku;
    }));
    produkte.push({ name: p.name, farben, groessen, zeilen });
  });
  _lagerArtikel = { produkte, nachSku };
  _lagerArtikelVon = KATALOG;
  return _lagerArtikel;
}
// Lager-Artikelnummer zu einer Zeile der Lagertabelle (Farbe oder Lagerartikel wie „Leo braun“)
function lagerSku(produkt, zeile, groesse) {
  const p = lagerArtikel().produkte.find(x => x.name === produkt);
  const i = p ? p.farben.indexOf(zeile) : -1, j = p ? p.groessen.indexOf(groesse) : -1;
  return i >= 0 && j >= 0 ? p.zeilen[i][j] : '';
}
const artikelName = sku => { const a = lagerArtikel().nachSku[sku]; return a ? a.produkt + ' · ' + a.farbe + ' · ' + a.groesse : sku; };

// Bestand eines Artikels in einer Kiste (kiste = null: alle Kisten zusammen)
function lagerBestand(sku, kiste) {
  const b = (lagerDaten && lagerDaten.bestand[sku]) || {};
  return kiste ? (b[kiste] || 0) : Object.values(b).reduce((n, x) => n + x, 0);
}
const lagerMindest = (sku, kiste) => ((lagerDaten && lagerDaten.mindest[sku]) || {})[kiste] || 0;
// Stück auf Lager (nur positive Bestände) und deren Wert zum Verkaufspreis
function lagerSumme(kiste) {
  return Object.keys(lagerArtikel().nachSku).reduce((n, sku) => n + (kiste ? Math.max(0, lagerBestand(sku, kiste))
    : lagerKisten().reduce((m, k) => m + Math.max(0, lagerBestand(sku, k)), 0)), 0);
}
function lagerWert(kiste) {
  const a = lagerArtikel().nachSku;
  const preis = x => ((currentPrices[x.produkt] || {})[x.groesse]) || x.preis;   // aktuelle Preise aus „Preise“
  return Object.keys(a).reduce((n, sku) => n + preis(a[sku]) * (kiste ? Math.max(0, lagerBestand(sku, kiste))
    : lagerKisten().reduce((m, k) => m + Math.max(0, lagerBestand(sku, k)), 0)), 0);
}
// Fehlt etwas in einer Kiste? (unter Mindestbestand oder verkauft, aber nicht da = negativ)
const lagerFehlt = (sku, kiste) => Math.max(0, lagerMindest(sku, kiste) - lagerBestand(sku, kiste));

// Nähliste: je Artikel und Kiste, was fehlt. Zuerst aus der Werkstatt nachfüllen, den Rest nähen.
function naehliste() {
  if (!lagerDaten) return [];
  const w = werkstatt(), liste = [];
  Object.keys(lagerArtikel().nachSku).forEach(sku => {
    const inWerkstatt = lagerBestand(sku, w);
    let vorrat = Math.max(0, inWerkstatt);
    lagerKisten().filter(k => k !== w).forEach(k => {
      const fehlt = lagerFehlt(sku, k);
      if (!fehlt) return;
      const aus = Math.min(fehlt, vorrat);
      vorrat -= aus;
      liste.push({ sku, kiste: k, fehlt, ausWerkstatt: aus, naehen: fehlt - aus, offen: lagerBestand(sku, k) < 0 });
    });
    // Werkstatt selbst: was nach dem Nachfüllen übrig bleibt, gegen ihren eigenen Mindestbestand
    const rest = Math.min(inWerkstatt, vorrat);
    const fw = Math.max(0, lagerMindest(sku, w) - rest);
    if (fw) liste.push({ sku, kiste: w, fehlt: fw, ausWerkstatt: 0, naehen: fw, offen: inWerkstatt < 0 });
  });
  // Verkaufte, aber fehlende zuerst, dann nach Produkt
  return liste.sort((a, b) => (b.offen - a.offen) || artikelName(a.sku).localeCompare(artikelName(b.sku), 'de'));
}

function ladeLager(neu) {
  if (!apiKonfiguriert() || !KATALOG) { renderLager(); return Promise.resolve(); }
  if (lagerLaden) return lagerLaden;
  if (lagerDaten && !neu && !lagerDaten.veraltet) { renderLager(); return Promise.resolve(); }
  if (!lagerDaten) renderLager(true);
  lagerLaden = schnittstelle('lager').then(r => { lagerUebernehmen(r); lagerFehler = ''; })
    .catch(e => { lagerFehler = apiFehlerText(e); }).then(() => {
      lagerLaden = null;
      renderLager();
      if (document.getElementById('tab-start').style.display !== 'none') { renderTodo(); renderStartZahlen(); }
      if (neu) showStatus(lagerFehler ? lagerFehler : 'Lager aktualisiert ✓', lagerFehler ? 'error' : 'success');
    });
  return lagerLaden;
}
function lagerUebernehmen(r) {
  lagerDaten = { kisten: r.kisten, werkstatt: r.werkstatt, kanalKiste: r.kanalKiste, bestand: r.bestand || {}, mindest: r.mindest || {}, bewegungen: r.bewegungen || [] };
  if (lagerKiste && !lagerDaten.kisten.includes(lagerKiste)) lagerKiste = null;
}

function renderLager(laedt) {
  const box = document.getElementById('lagerInhalt');
  if (!box) return;
  const knopf = document.getElementById('btnBuchung');
  if (knopf) knopf.style.display = apiKonfiguriert() && KATALOG && lagerDaten ? '' : 'none';
  if (!apiKonfiguriert()) {
    box.innerHTML = `<div class="card best-leer"><div class="card-title">Lager verbinden</div>
      <p>Das Lager steht in derselben Google-Tabelle wie die Bestellungen. Dafür braucht der Admin einmalig den Admin-Schlüssel.</p>
      <button class="btn btn-primary" onclick="geheZu('einstellungen')">Zu den Einstellungen</button></div>`;
    return;
  }
  if (!KATALOG) { box.innerHTML = '<div class="card best-leer"><p>Der Produktkatalog (katalog.json) wird noch geladen …</p></div>'; return; }
  if (laedt) { box.innerHTML = '<div class="card best-leer"><p>Lager wird geladen …</p></div>'; return; }
  if (lagerFehler && !lagerDaten) {
    box.innerHTML = `<div class="card best-leer"><div class="card-title">Keine Verbindung</div><p>${medienEsc(lagerFehler)}</p>
      <button class="btn btn-teal" onclick="ladeLager(true)">Nochmal versuchen</button></div>`;
    return;
  }
  if (!lagerDaten) { box.innerHTML = ''; return; }
  const leer = !Object.keys(lagerDaten.bestand).length && !Object.keys(lagerDaten.mindest).length;
  const kisten = lagerKisten(), k = lagerKiste, m = lagerModus;
  const wert = lagerWert(k), stueck = lagerSumme(k);
  const kronen = n => n + (n === 1 ? ' Krone' : ' Kronen');
  const modusName = { bestand: 'Bestand ansehen', zaehlen: 'Zählen', mindest: 'Mindestbestand festlegen' }[m];
  const kachel = kk => {
    const fehlt = kisteFehlt(kk);
    return `<button class="kiste-kachel ${kk === k ? 'active' : ''}" style="${kisteStil(kk)}" data-kiste="${medienEsc(kk)}" onclick="lagerKisteWaehlen(${jsArg(kk)})" aria-pressed="${kk === k}">
      <span class="kk-name">${KISTE_ICON}${medienEsc(kk)}</span>
      <b>${lagerSumme(kk)}<small>Stück</small></b>
      ${fehlt ? `<span class="kk-warn">${fehlt} ${fehlt === 1 ? 'Artikel fehlt' : 'Artikel fehlen'}</span>` : `<span class="kk-sub">${euro(lagerWert(kk))}</span>`}
    </button>`;
  };
  box.innerHTML = `
    <details class="card anleitung" id="lagerAnleitung" ${anleitungOffen(leer) ? 'open' : ''} ontoggle="anleitungMerken(this.open)">
      <summary><span class="i">i</span>So funktioniert das Lager</summary>
      <ol>
        <li>Eine Kiste antippen und <b>Zählen</b> wählen, dann eintragen, was drin liegt.</li>
        <li>Unter <b>Mindestbestand</b> festlegen, wie viele von jeder Krone in der Kiste sein sollen.</li>
        <li>Ab dann buchen Verkäufe im Shop und von Hand automatisch ab. Fehlt etwas, steht es auf der <b>Nähliste</b>.</li>
        <li>Frisch Genähtes, Umlagern oder Geschenke über <b>+ Buchung</b> eintragen.</li>
      </ol>
    </details>
    <div id="lagerNaeh"></div>
    <div class="kisten ${m !== 'bestand' && !k ? 'waehlen' : ''}" id="lagerKisten" role="group" aria-label="Kiste wählen">
      <button class="kiste-kachel alle ${!k ? 'active' : ''}" onclick="lagerKisteWaehlen(null)" aria-pressed="${!k}">
        <span class="kk-name">${KISTE_ICON}Alle Kisten</span>
        <b>${lagerSumme(null)}<small>Stück</small></b><span class="kk-sub">${euro(lagerWert(null))} zum Verkaufspreis</span>
      </button>
      ${kisten.map(kachel).join('')}
    </div>
    <div class="kiste-banner" id="kisteBanner" style="${k ? kisteStil(k) : ''}">
      <div>
        <div class="kb-label">${k ? 'Du arbeitest in der Kiste' : m === 'bestand' ? 'Überblick' : modusName}</div>
        <div class="kb-titel">${k ? medienEsc(k) : m === 'bestand' ? 'Alle Kisten' : 'Welche Kiste?'}</div>
        <div class="lg-wert">${k || m === 'bestand' ? kronen(stueck) + ' · Wert ' + euro(wert) : 'Tippe oben auf eine Kiste.'}</div>
      </div>
      <div class="lg-modus" role="tablist">
        ${[['bestand', 'Bestand'], ['zaehlen', 'Zählen'], ['mindest', 'Mindestbestand']].map(([id, t]) =>
          `<button class="${m === id ? 'active' : ''}" data-modus="${id}" onclick="lagerModusWaehlen('${id}')">${t}</button>`).join('')}
      </div>
    </div>
    ${m === 'bestand' && !k ? `<p class="lg-hinweis">Hier siehst du alle Kisten zusammen. Zum Zählen oder für den Mindestbestand oben eine Kiste antippen.</p>` : ''}
    ${m === 'zaehlen' && k ? `<p class="lg-hinweis">Zähle, was in der Kiste <b>${medienEsc(k)}</b> liegt, und trage die Zahl ein. Gespeichert wird nur, was du änderst. Der Unterschied wird als Inventur gebucht.</p>` : ''}
    ${m === 'mindest' && k ? `<p class="lg-hinweis">So viele Kronen sollen mindestens in der Kiste <b>${medienEsc(k)}</b> liegen. Fällt der Bestand darunter, kommt die Krone auf die Nähliste. 0 = egal.</p>
      <div class="lg-alle">Alle Artikel in ${medienEsc(k)} auf <input type="number" min="0" max="99" id="lgAlleWert" value="1" inputmode="numeric"> <button class="btn btn-outline btn-sm" onclick="lagerAlleSetzen()">setzen</button></div>` : ''}
    <div class="lg-liste ${k ? 'in-kiste' : ''}" id="lagerListe" style="${k ? kisteStil(k) : ''}"></div>
    <div id="lagerLeiste"></div>
    <div class="lg-unten"><section class="card">
      <div class="card-title">Letzte Buchungen</div>
      <ul class="lg-bew" id="lagerBewegungen"></ul>
    </section></div>`;
  renderNaehliste();
  renderLagerListe();
  renderLagerLeiste();
  renderBewegungen();
}

// Anleitung: am Anfang offen, danach so, wie Sara sie zuletzt hatte
function anleitungOffen(leer) {
  try { const v = localStorage.getItem('mkw_lager_anleitung'); if (v) return v === 'auf'; } catch (e) {}
  return leer;
}
function anleitungMerken(offen) { try { localStorage.setItem('mkw_lager_anleitung', offen ? 'auf' : 'zu'); } catch (e) {} }

function lagerKisteWaehlen(k) {
  if (k === lagerKiste) return;
  if (Object.keys(lagerEingabe).length && !confirm('Deine Eingaben für ' + lagerKiste + ' sind noch nicht gespeichert. Verwerfen?')) return;
  lagerEingabe = {};
  lagerKiste = k;
  if (!k) lagerModus = 'bestand';                   // „Alle Kisten“ kann man nur ansehen
  renderLager();
}
function lagerModusWaehlen(m) {
  if (m === lagerModus) return;
  if (Object.keys(lagerEingabe).length && !confirm('Deine Eingaben sind noch nicht gespeichert. Verwerfen?')) return;
  lagerEingabe = {};
  lagerModus = m;
  renderLager();
  if (m !== 'bestand' && !lagerKiste) {                // erst eine Kiste wählen: Kacheln zeigen
    const el = document.getElementById('lagerKisten');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function renderLagerListe() {
  const box = document.getElementById('lagerListe');
  if (!box) return;
  const k = lagerKiste, m = lagerModus;
  if (m !== 'bestand' && !k) {
    box.innerHTML = `<div class="card lg-waehlen">Welche Kiste möchtest du ${m === 'zaehlen' ? 'zählen' : 'einstellen'}?<br>Tippe oben auf eine Kiste.</div>`;
    return;
  }
  box.innerHTML = lagerArtikel().produkte.map(p => {
    const skus = p.zeilen.flat().filter(Boolean);
    const summe = skus.reduce((n, s) => n + (k ? lagerBestand(s, k) : lagerKisten().reduce((x, kk) => x + Math.max(0, lagerBestand(s, kk)), 0)), 0);
    const warn = skus.some(s => k ? lagerFehlt(s, k) : lagerKisten().some(kk => lagerFehlt(s, kk)));
    const offen = lagerOffen[p.name] != null ? lagerOffen[p.name] : m !== 'bestand';
    const zelle = sku => {
      if (!sku) return '<span class="fehlt">–</span>';
      if (m === 'bestand') {
        const n = k ? lagerBestand(sku, k) : lagerBestand(sku, null);
        const min = k ? lagerMindest(sku, k) : 0;
        const fehlt = k ? lagerFehlt(sku, k) : lagerKisten().some(kk => lagerFehlt(sku, kk));
        return `<span class="lg-zelle ${n < 0 ? 'minus' : fehlt ? 'unter' : n === 0 ? 'null' : ''}" title="${medienEsc(artikelName(sku))}">${n < 0 ? '−' + (-n) : n}</span>${min ? `<span class="lg-min">min ${min}</span>` : ''}`;
      }
      const alt = m === 'zaehlen' ? lagerBestand(sku, k) : lagerMindest(sku, k);
      const v = lagerEingabe[sku] != null ? lagerEingabe[sku] : alt;
      return `<input type="number" min="0" max="999" inputmode="numeric" data-sku="${sku}" value="${v}" class="${lagerEingabe[sku] != null && lagerEingabe[sku] !== alt ? 'geaendert' : ''}"
        aria-label="${medienEsc(artikelName(sku))}" onfocus="this.select()" oninput="lagerEingabeSetzen(this)">`;
    };
    return `<details class="lg-produkt" data-produkt="${medienEsc(p.name)}" ${offen ? 'open' : ''} ontoggle="lagerOffen[this.dataset.produkt]=this.open">
      <summary><span>${medienEsc(p.name)}${warn ? '<span class="lg-punkt" title="unter Mindestbestand"></span>' : ''}</span>
        <span class="lg-anzahl">${summe}<small>${k ? 'in ' + medienEsc(k) : 'Stück'}</small></span></summary>
      <div class="lg-tabelle-rahmen"><table class="lg-tabelle">
        <thead><tr><th>Farbe</th>${p.groessen.map(g => `<th>${medienEsc(g)}</th>`).join('')}</tr></thead>
        <tbody>${p.farben.map((f, i) => `<tr><td>${medienEsc(f)}</td>${p.zeilen[i].map(s => `<td>${zelle(s)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </details>`;
  }).join('');
}

function lagerEingabeSetzen(el) {
  const sku = el.dataset.sku;
  const n = el.value === '' ? null : Math.max(0, Math.round(Number(el.value)));
  const alt = lagerModus === 'zaehlen' ? lagerBestand(sku, lagerKiste) : lagerMindest(sku, lagerKiste);
  if (n == null || isNaN(n) || n === alt) delete lagerEingabe[sku]; else lagerEingabe[sku] = n;
  el.classList.toggle('geaendert', lagerEingabe[sku] != null);
  renderLagerLeiste();
}
function lagerAlleSetzen() {
  const n = Math.max(0, Math.round(Number(document.getElementById('lgAlleWert').value) || 0));
  Object.keys(lagerArtikel().nachSku).forEach(sku => { if (n !== lagerMindest(sku, lagerKiste)) lagerEingabe[sku] = n; else delete lagerEingabe[sku]; });
  renderLagerListe();
  renderLagerLeiste();
}

function renderLagerLeiste() {
  const box = document.getElementById('lagerLeiste');
  if (!box) return;
  const n = Object.keys(lagerEingabe).length;
  if (lagerModus === 'bestand' || !lagerKiste) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="lg-leiste" style="${kisteStil(lagerKiste)}">
    <span>${lagerModus === 'zaehlen' ? 'Zählen' : 'Mindestbestand'} in ${kisteTag(lagerKiste)} · ${n ? `<b>${n} ${n === 1 ? 'Änderung' : 'Änderungen'}</b>` : 'noch nichts geändert'}</span>
    <span class="btn-row" style="margin:0">${n ? `<button class="btn btn-outline btn-sm" onclick="lagerEingabe={};renderLager()">Verwerfen</button>
    <button class="btn btn-primary btn-sm" id="lgSpeichern" onclick="lagerSpeichern()">${lagerModus === 'zaehlen' ? 'Zählung speichern' : 'Mindestbestand speichern'}</button>`
      : `<button class="btn btn-outline btn-sm" onclick="lagerModusWaehlen('bestand')">Fertig</button>`}</span></div>`;
}

async function lagerSpeichern() {
  const k = lagerKiste, werte = Object.assign({}, lagerEingabe);
  const knopf = document.getElementById('lgSpeichern');
  if (knopf) knopf.disabled = true;
  showStatus('Wird gespeichert …', 'loading');
  try {
    let r;
    if (lagerModus === 'zaehlen') {
      const artikel = {};
      Object.keys(werte).forEach(s => { artikel[s] = artikelName(s); });
      r = await schnittstelle('inventur', { kiste: k, zaehlung: werte, artikel });
    } else {
      r = await schnittstelle('mindest', { kiste: k, werte });
    }
    lagerUebernehmen(r);
    lagerEingabe = {};
    renderLager();
    showStatus(lagerModus === 'zaehlen' ? 'Zählung gespeichert ✓ ' + r.korrigiert + (r.korrigiert === 1 ? ' Korrektur gebucht.' : ' Korrekturen gebucht.') : 'Mindestbestand gespeichert ✓');
  } catch (e) {
    if (knopf) knopf.disabled = false;
    showStatus(apiFehlerText(e), 'error');
  }
}

function renderNaehliste() {
  const box = document.getElementById('lagerNaeh');
  if (!box) return;
  const nl = naehliste();
  if (!nl.length || lagerModus !== 'bestand') { box.innerHTML = ''; return; }
  const naehen = nl.reduce((n, x) => n + x.naehen, 0);
  box.innerHTML = `<section class="card naeh" id="naehliste">
    <div class="card-title">Nähliste</div>
    <div class="card-sub" style="margin-bottom:8px">${naehen ? naehen + (naehen === 1 ? ' Krone' : ' Kronen') + ' nähen' : 'Nichts zu nähen'}${nl.some(x => x.ausWerkstatt) ? ', der Rest liegt schon in der Werkstatt' : ''}.</div>
    ${nl.slice(0, 40).map(x => `<div class="naeh-zeile" data-sku="${x.sku}" data-kiste="${medienEsc(x.kiste)}">
      <div><div class="naeh-name">${medienEsc(artikelName(x.sku))}</div>
        <div class="naeh-info">${kisteTag(x.kiste)} ${x.offen ? `<b style="color:var(--err)">${-lagerBestand(x.sku, x.kiste)} verkauft, nicht auf Lager</b>` : lagerBestand(x.sku, x.kiste) + ' da, ' + lagerMindest(x.sku, x.kiste) + ' sollen'} · fehlt ${x.fehlt}</div></div>
      <div class="naeh-knoepfe">
        ${x.ausWerkstatt ? `<button class="btn btn-teal btn-sm" onclick="naehUmlagern(${jsArg(x.sku)}, ${jsArg(x.kiste)}, ${x.ausWerkstatt})">${x.ausWerkstatt} aus Werkstatt</button>` : ''}
        ${x.naehen ? `<button class="btn btn-primary btn-sm" onclick="naehGenaeht(${jsArg(x.sku)}, ${jsArg(x.kiste)})">+1 genäht</button>` : ''}
      </div></div>`).join('')}
    ${nl.length > 40 ? `<div class="leise" style="padding-top:8px">und ${nl.length - 40} weitere</div>` : ''}
  </section>`;
}

async function lagerBuchen(buchungen, meldung) {
  showStatus('Wird gebucht …', 'loading');
  try {
    const r = await schnittstelle('buchen', { buchungen });
    lagerUebernehmen(r);
    renderLager();
    showStatus(meldung + ' ✓');
    return true;
  } catch (e) {
    showStatus(e.message === 'ungueltige_buchung' ? 'Die Buchung ist unvollständig. Bitte prüfen.' : apiFehlerText(e), 'error');
    return false;
  }
}
function naehUmlagern(sku, kiste, n) {
  const w = werkstatt(), a = artikelName(sku);
  return lagerBuchen([{ sku, kiste: w, menge: -n, grund: 'Umlagerung', artikel: a, notiz: 'nach ' + kiste },
    { sku, kiste, menge: n, grund: 'Umlagerung', artikel: a, notiz: 'aus ' + w }], n + ' × ' + a + ' nach ' + kiste);
}
function naehGenaeht(sku, kiste) {
  return lagerBuchen([{ sku, kiste, menge: 1, grund: 'Genäht', artikel: artikelName(sku) }], artikelName(sku) + ' genäht');
}

function renderBewegungen() {
  const box = document.getElementById('lagerBewegungen');
  if (!box) return;
  const l = (lagerDaten.bewegungen || []).slice(0, 20);
  box.innerHTML = l.length ? l.map(b => `<li>
      <span class="d">${medienEsc(b.datum)}</span>
      <span>${medienEsc(b.artikel || artikelName(b.sku))}<br><span class="leise">${medienEsc(b.grund)} · ${kisteTag(b.kiste)}${b.nr ? ' · ' + medienEsc(b.nr) : ''}${b.notiz ? ' · ' + medienEsc(b.notiz) : ''}</span></span>
      <span class="m ${b.menge > 0 ? 'plus' : 'minus'}">${b.menge > 0 ? '+' + b.menge : '−' + (-b.menge)}</span></li>`).join('')
    : '<li class="leise" style="display:block">Noch keine Buchungen.</li>';
}

// ---------- „+ Buchung“: genäht, umlagern, ausbuchen ----------
const BUCHUNGSARTEN = [
  { id: 'Genäht', titel: 'Neu genäht', text: 'Fertige Kronen kommen in eine Kiste.' },
  { id: 'Umlagerung', titel: 'Umlagern', text: 'Kronen wandern von einer Kiste in eine andere, z. B. aus der Werkstatt in die Etsy-Kiste.' },
  { id: 'Ausgebucht', titel: 'Ausbuchen', text: 'Kronen verlassen das Lager ohne Verkauf, z. B. Geschenk, Muster oder kaputt.' }
];
function neueBuchungsPosition() {
  const p = lagerArtikel().produkte[0];
  return { variante: p.name, farbe: p.farben[0], groesse: p.groessen[0], menge: 1 };
}
function buchungOeffnen() {
  buchung = { art: 'Genäht', kiste: lagerKiste || werkstatt(), nach: lagerKiste && lagerKiste !== werkstatt() ? lagerKiste : lagerKisten()[0], notiz: '', positionen: [neueBuchungsPosition()] };
  renderBuchung();
  document.getElementById('lagerBuchung').scrollIntoView({ block: 'start' });
}
function buchungFeld(k, v) {
  buchung[k] = v;
  if (k === 'art' && v === 'Umlagerung' && buchung.kiste === buchung.nach) {   // Umlagern: sinnvolle Von/Nach-Kiste
    buchung.kiste = werkstatt();
    buchung.nach = lagerKiste && lagerKiste !== werkstatt() ? lagerKiste : lagerKisten().find(x => x !== werkstatt());
  }
  renderBuchung();
}
function buchungPosFeld(i, k, v) {
  const p = buchung.positionen[i];
  p[k] = k === 'menge' ? Math.max(1, Math.round(Number(v) || 1)) : v;
  if (k === 'variante') { const pr = lagerArtikel().produkte.find(x => x.name === v); p.farbe = pr.farben[0]; p.groesse = pr.groessen[0]; }
  renderBuchung();
}
function renderBuchung() {
  const box = document.getElementById('lagerBuchung');
  if (!box) return;
  if (!buchung) { box.innerHTML = ''; return; }
  const b = buchung, art = BUCHUNGSARTEN.find(x => x.id === b.art);
  const opt = (liste, wert) => liste.map(x => `<option ${x === wert ? 'selected' : ''}>${medienEsc(x)}</option>`).join('');
  const produkte = lagerArtikel().produkte;
  box.innerHTML = `<div class="card bf">
    <div class="card-title">Buchung</div>
    <div class="card-sub">${medienEsc(art.text)}</div>
    <div class="bf-grid">
      <div><label for="lbArt">Was passiert?</label><select id="lbArt" onchange="buchungFeld('art', this.value)">
        ${BUCHUNGSARTEN.map(x => `<option value="${x.id}" ${x.id === b.art ? 'selected' : ''}>${x.titel}</option>`).join('')}</select></div>
      <div><label for="lbKiste">${b.art === 'Genäht' ? 'In Kiste' : b.art === 'Umlagerung' ? 'Von Kiste' : 'Aus Kiste'}</label>
        <select id="lbKiste" onchange="buchungFeld('kiste', this.value)">${opt(lagerKisten(), b.kiste)}</select></div>
      ${b.art === 'Umlagerung' ? `<div><label for="lbNach">Nach Kiste</label><select id="lbNach" onchange="buchungFeld('nach', this.value)">${opt(lagerKisten(), b.nach)}</select></div>` : ''}
      <div class="voll"><label>Kronen</label>
        ${b.positionen.map((p, i) => {
          const pr = produkte.find(x => x.name === p.variante) || produkte[0];
          const sku = lagerSku(p.variante, p.farbe, p.groesse);
          const da = lagerBestand(sku, b.kiste);
          return `<div class="bf-pos lg-pos">
          <div><label>Krone</label><select onchange="buchungPosFeld(${i}, 'variante', this.value)">${opt(produkte.map(x => x.name), p.variante)}</select></div>
          <div><label>Farbe</label><select onchange="buchungPosFeld(${i}, 'farbe', this.value)">${opt(pr.farben, p.farbe)}</select></div>
          <div><label>Größe</label><select onchange="buchungPosFeld(${i}, 'groesse', this.value)">${opt(pr.groessen, p.groesse)}</select></div>
          <div><label>Stück</label><input type="number" min="1" max="500" inputmode="numeric" value="${p.menge}" onchange="buchungPosFeld(${i}, 'menge', this.value)"></div>
          ${b.positionen.length > 1 ? `<button class="x" title="Zeile entfernen" onclick="buchung.positionen.splice(${i},1);renderBuchung()">✕</button>` : '<span></span>'}
          <div class="leise" style="grid-column:1/-1;font-size:12px">${medienEsc(b.kiste)}: ${da} da${b.art !== 'Genäht' && p.menge > da ? ' · <b style="color:var(--err)">mehr als vorhanden</b>' : ''}</div>
        </div>`; }).join('')}
        <button class="btn btn-teal btn-sm" onclick="buchung.positionen.push(neueBuchungsPosition());renderBuchung()">+ weitere Krone</button>
      </div>
      <div class="voll"><label for="lbNotiz">Notiz</label><input id="lbNotiz" type="text" maxlength="200" value="${medienEsc(b.notiz)}" oninput="buchung.notiz=this.value" placeholder="optional, z. B. Geschenk an …"></div>
    </div>
    <div class="btn-row"><button class="btn btn-primary" id="lbSpeichern" onclick="buchungSpeichern()">Buchen</button>
      <button class="btn btn-outline" onclick="buchung=null;renderBuchung()">Abbrechen</button></div>
  </div>`;
}
async function buchungSpeichern() {
  const b = buchung;
  if (b.art === 'Umlagerung' && b.kiste === b.nach) { showStatus('Von- und Nach-Kiste sind gleich.', 'error'); return; }
  const liste = [];
  for (const p of b.positionen) {
    const sku = lagerSku(p.variante, p.farbe, p.groesse), artikel = artikelName(sku);
    if (!sku) { showStatus('Unbekannter Artikel: ' + p.variante + ' ' + p.farbe, 'error'); return; }
    if (b.art === 'Genäht') liste.push({ sku, kiste: b.kiste, menge: p.menge, grund: 'Genäht', artikel, notiz: b.notiz });
    if (b.art === 'Ausgebucht') liste.push({ sku, kiste: b.kiste, menge: -p.menge, grund: 'Ausgebucht', artikel, notiz: b.notiz });
    if (b.art === 'Umlagerung') liste.push({ sku, kiste: b.kiste, menge: -p.menge, grund: 'Umlagerung', artikel, notiz: ('nach ' + b.nach + ' ' + b.notiz).trim() },
      { sku, kiste: b.nach, menge: p.menge, grund: 'Umlagerung', artikel, notiz: ('aus ' + b.kiste + ' ' + b.notiz).trim() });
  }
  const knopf = document.getElementById('lbSpeichern');
  if (knopf) knopf.disabled = true;
  const n = b.positionen.reduce((x, p) => x + p.menge, 0);
  const ok = await lagerBuchen(liste, n + (n === 1 ? ' Krone ' : ' Kronen ') + (b.art === 'Genäht' ? 'eingebucht' : b.art === 'Umlagerung' ? 'umgelagert' : 'ausgebucht'));
  if (ok) { buchung = null; renderBuchung(); } else if (knopf) knopf.disabled = false;
}

// Startseite: die drei neuesten Bestellungen
function renderStartBestellungen() {
  const box = document.getElementById('startBestellungen');
  if (!box) return;
  if (!apiKonfiguriert()) {
    box.innerHTML = '<div class="leise">Noch nicht verbunden. <a href="#einstellungen" onclick="geheZu(\'einstellungen\');return false" style="color:var(--petrol-d)">Jetzt einrichten</a></div>';
    return;
  }
  if (bestellFehler && !bestellungen) { box.innerHTML = `<div class="leise">${medienEsc(bestellFehler)}</div>`; return; }
  if (!bestellungen) { box.innerHTML = '<div class="leise">Wird geladen …</div>'; return; }
  if (!bestellungen.length) { box.innerHTML = '<div class="leise">Noch keine Bestellungen.</div>'; return; }
  box.innerHTML = bestellungen.slice(0, 3).map(b =>
    `<div class="start-best" onclick="oeffneBestellung(${JSON.stringify(b.nr).replace(/"/g, '&quot;')})">
      <span>${medienEsc(b.datum)} · ${medienEsc(b.kunde || b.kanal)} <span class="${statusKlasse(b.status)}">${medienEsc(b.status)}</span><br><small class="leise">${medienEsc(positionen(b).map(x => x.variante).join(', '))}</small></span>
      <span>${euro(b.preis)}</span></div>`).join('') +
    `<div style="margin-top:12px"><button class="schnell-btn" style="width:100%" onclick="geheZu('bestellungen')">Alle Bestellungen</button></div>`;
}
function oeffneBestellung(nr) {
  bestellSuche = '';
  geheZu('bestellungen');
  setTimeout(() => {
    const el = document.querySelector(`.best[data-nr="${CSS.escape(nr)}"]`);
    if (el) { el.open = true; el.scrollIntoView({ block: 'start' }); }
  }, 50);
}

// Letzte Speicherungen aus GitHub (wer hat wann was geändert)
async function ladeVerlauf() {
  const box = document.getElementById('startVerlauf');
  if (!box) return;
  try {
    if ((await zugaengePruefen()).github) {
      const r = await schnittstelle('github', { art: 'verlauf' });
      verlaufZeigen(box, r.verlauf.map(v => ({ commit: { message: v.text, author: { date: v.datum } } })));
      return;
    }
    const token = await getToken();
    const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/commits?per_page=6`, {
      headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) throw new Error(res.status);
    verlaufZeigen(box, await res.json());
  } catch (e) {
    box.innerHTML = '<div class="leise">Verlauf gerade nicht abrufbar.</div>';
  }
}
function verlaufZeigen(box, liste) {
  {
    const wann = iso => {
      const min = Math.round((Date.now() - new Date(iso)) / 60000);
      if (min < 60) return 'vor ' + Math.max(min, 1) + ' Min.';
      if (min < 1440) return 'vor ' + Math.round(min / 60) + ' Std.';
      return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
    };
    box.innerHTML = liste.map(c => {
      const titel = String(c.commit.message || '').split('\n')[0].replace(/^Admin: /, '');
      return `<div class="verlauf-zeile"><span>${medienEsc(titel)}</span><span>${wann(c.commit.author.date)}</span></div>`;
    }).join('') || '<div class="leise">Noch nichts gespeichert.</div>';
  }
}
