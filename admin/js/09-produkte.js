// Kronenwelt Admin – Produkte: Preise, Fotos & Video, Hauptfotos
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// PREISE
// ============================================================
const PREIS_ID = (v, g) => ('price_' + v + '_' + g).replace(/[^a-zA-Z0-9_]/g, '_');
const euroTxt = x => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',') + ' €';
const preisWert = id => { const el = document.getElementById(id); return el ? (parseFloat(el.value) || 0) : 0; };
const preisFeld = (id, wert, extra) =>
  `<span class="preis-feld"><input type="number" step="0.01" min="0" id="${id}" value="${wert}" ${extra || ''}><span>€</span></span>`;

function renderPreise() {
  const grid = document.getElementById('priceGrid');
  const id = PREIS_ID;
  const normal = VARIANTEN_LIST.filter(v => !isZahlVariante(v));
  const zahl   = VARIANTEN_LIST.filter(v => isZahlVariante(v));
  const auf = currentPrices[AUFPREIS_KEY] || {};

  const karteNormal = v => `
    <div class="price-variant">
      <h3>${v}</h3>
      ${groessenFuer(v).map(g => `
        <div class="price-row"><label>${g}</label>${preisFeld(id(v, g), (currentPrices[v] && currentPrices[v][g]) || 0)}</div>
      `).join('')}
    </div>`;

  // Zahlenkronen gibt es nur mit 3, 6 oder 9 Pets: Grundpreis (3 Pets) eingeben, 6 und 9 Pets werden mitgerechnet
  const karteZahl = v => `
    <div class="price-variant zahl">
      <h3>${v}</h3>
      <div class="zahl-tab">
        <div class="kopf">Größe</div><div class="kopf">3 Pets</div><div class="kopf">6 Pets</div><div class="kopf">9 Pets</div>
        ${groessenFuer(v).map(g => `
          <label for="${id(v, g)}">${g}</label>
          ${preisFeld(id(v, g), (currentPrices[v] && currentPrices[v][g]) || 0, 'oninput="zahlPreiseAktualisieren()"')}
          <div class="endpreis" data-v="${medienEsc(v)}" data-g="${g}" data-p="6"></div>
          <div class="endpreis" data-v="${medienEsc(v)}" data-g="${g}" data-p="9"></div>
        `).join('')}
      </div>
    </div>`;

  grid.innerHTML = normal.map(karteNormal).join('') + (zahl.length ? `
    <div class="zahl-block">
      <div class="zahl-kopf">
        <h3>Zahlenkronen</h3>
        <p>Zahlenkronen gibt es nur mit 3, 6 oder 9 Pets. Du gibst den Preis mit 3 Pets ein, die Preise für 6 und 9 Pets ergeben sich aus dem Aufpreis. Der Aufpreis gilt für alle Zahlenkronen.</p>
        <div class="aufpreis-zeile">
          ${AUFPREIS_OPTS.map(o => `<label>Aufpreis ${o} <span class="plus">+</span>${preisFeld(id(AUFPREIS_KEY, o), auf[o] ?? 0, 'oninput="zahlPreiseAktualisieren()"')}</label>`).join('')}
        </div>
      </div>
      <div class="price-grid">${zahl.map(karteZahl).join('')}</div>
    </div>` : '');
  zahlPreiseAktualisieren();
}

function zahlPreiseAktualisieren() {
  document.querySelectorAll('#priceGrid .endpreis').forEach(el => {
    const basis = preisWert(PREIS_ID(el.dataset.v, el.dataset.g));
    el.textContent = euroTxt(basis + preisWert(PREIS_ID(AUFPREIS_KEY, el.dataset.p + ' Pets')));
  });
}

async function savePreise() {
  const id = (v, g) => ('price_' + v + '_' + g).replace(/[^a-zA-Z0-9_]/g, '_');
  // Bestehende Einträge behalten, damit nichts verloren geht, was hier nicht angezeigt wird
  const newPrices = JSON.parse(JSON.stringify(currentPrices));
  VARIANTEN_LIST.forEach(v => {
    newPrices[v] = {};
    groessenFuer(v).forEach(g => {
      const el = document.getElementById(id(v, g));
      newPrices[v][g] = parseFloat(el.value) || 0;
    });
  });
  newPrices[AUFPREIS_KEY] = {};
  AUFPREIS_OPTS.forEach(o => {
    newPrices[AUFPREIS_KEY][o] = parseFloat(document.getElementById(id(AUFPREIS_KEY, o)).value) || 0;
  });

  showStatus('Preise werden gespeichert...', 'loading');
  try {
    if (KATALOG) {
      // Neuesten Katalog holen, nur die Preise ändern – alles andere bleibt, wie es auf GitHub steht
      const kFile = await githubGet('katalog.json');
      const k = JSON.parse(decodeURIComponent(escape(atob(kFile.content))));
      k.produkte.forEach(p => {
        ((p.merkmale || {}).groesse || []).forEach(g => {
          if (newPrices[p.name] && typeof newPrices[p.name][g.wert] === 'number') g.preis = newPrices[p.name][g.wert];
        });
      });
      (((k.optionen || {}).zahlenpets || {}).werte || []).forEach(o => {
        const x = newPrices[AUFPREIS_KEY][o.wert + ' Pets'];
        if (o.wert !== 3 && typeof x === 'number') o.aufpreis = x;
      });
      await githubPut('katalog.json', JSON.stringify(k, null, 2) + '\n', 'Admin: Preise aktualisiert');
      KATALOG = k;
    } else {
      await githubPut('preise.json', JSON.stringify(newPrices, null, 2), 'Admin: Preise aktualisiert');
    }
    currentPrices = newPrices;
    showStatus('Preise gespeichert! Die Website wird in ~1 Minute aktualisiert.');
  } catch(e) {
    showStatus('Fehler: ' + e.message, 'error');
  }
}

// ============================================================
// HILFSFUNKTION
// ============================================================
async function sha1(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// MEHR FOTOS & VIDEO (medien.json)
// ============================================================
// Farbnamen müssen exakt wie im Konfigurator der Website heissen
let MEDIEN_VARIANTEN = {
  'Party':                { slug: 'party',         farben: ['Rosa mit Punkten', 'Grau mit Punkten', 'Mint mit Punkten', 'Lila mit Punkten', 'Petrol mit Punkten', 'Konfetti', 'Weiss/Blau/Grün'] },
  'Einfarbig':            { slug: 'uni',           farben: ['Berry', 'Blau', 'Grün', 'Orange'] },
  'Glitzer':              { slug: 'glitzer',       farben: ['Blau', 'Türkis', 'Rosa', 'Pink', 'Silber', 'Weiss', 'Gold'] },
  'Edel & Wild':          { slug: 'edel',          farben: ['Gold', 'Schwarz', 'Leo Braun', 'Leo Weiss', 'Leopard'] },
  'Zahlenkrone Klassik':  { slug: 'zahl-klassik',  farben: ['Rosa', 'Mint', 'Weiss/bunte Punkte'] },
  'Zahlenkrone Leo':      { slug: 'zahl-leo',      farben: ['Gold / Zahlen schwarz', 'Schwarz / Zahlen gold'] },
  'Zahlenkrone Glitzer':  { slug: 'zahl-glitzer',  farben: ['Zahlen schwarz', 'Zahlen weiss'] },
  'Zahlenkrone Konfetti': { slug: 'zahl-konfetti', farben: ['Zahlenpads Mint', 'Zahlenpads Rosa'] }
};
// Produkt -> { _default: Kollektionsbild, Farbe: fester Name des Hauptfotos } (aus katalog.json)
let PF_MAP = null;
// Kronen, Farben und Foto-Namen aus produktfotos.json übernehmen (gleiche Datei wie der Konfigurator)
function uebernehmeProduktfotos(json) {
  const kronen = Object.keys(json || {}).filter(k => !k.startsWith('_') && json[k] && typeof json[k] === 'object');
  if (!kronen.length) return false;
  const name = id => String(id || '').trim().replace(/\.(jpe?g|png|webp)$/i, '');
  const liste = [{ key: 'mila-hero', label: '⭐ Hero-Bild (Startseite)', variant: 'Startseite', ext: 'png' }];
  kronen.forEach(v => { const d = name(json[v]._default); if (d) liste.push({ key: d, label: '⭐ Kollektion – ' + v, variant: 'Startseite' }); });
  kronen.forEach(v => {
    const proFoto = {};                       // Farben mit demselben Foto zusammenfassen (z.B. Rosa / Pink)
    Object.entries(json[v]).forEach(([f, id]) => {
      if (f === '_default' || !name(id)) return;
      (proFoto[name(id)] = proFoto[name(id)] || []).push(f);
    });
    Object.entries(proFoto).forEach(([id, farben]) => {
      const gleich = id === name(json[v]._default) ? ' (gleiches Foto wie Kollektion)' : '';
      liste.push({ key: id, label: farben.join(' / ') + gleich, variant: v });
    });
  });
  PRODUKT_FOTOS = liste;
  VARIANTEN_LIST = kronen;
  PF_MAP = {};
  kronen.forEach(v => {
    PF_MAP[v] = {};
    Object.entries(json[v]).forEach(([f, id]) => { if (name(id)) PF_MAP[v][f] = name(id); });
  });
  const neu = {};
  kronen.forEach(v => {
    neu[v] = { slug: (MEDIEN_VARIANTEN[v] && MEDIEN_VARIANTEN[v].slug) || medienSlug(v),
               farben: Object.keys(json[v]).filter(f => f !== '_default') };
  });
  MEDIEN_VARIANTEN = neu;
  return true;
}

const MEDIEN_MAX_FOTOS = 5;                       // + Hauptfoto = 6
const MEDIEN_VIDEO_EAGER = 'c_limit,q_auto,w_1280/mp4'; // muss zur Video-URL der Website passen
const medienAuswahl = {};                         // gewählte Farbe je Krone ('_default' = alle Farben)
let medienZiel = null;                            // { v, k } für den laufenden Upload

const clName_ = () => localStorage.getItem('mkw_cl_name') || 'dw6amyijc';
const medienEsc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const medienSlug = t => String(t).toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

function medienEintrag(v, k, anlegen) {
  if (!currentMedien[v]) { if (!anlegen) return null; currentMedien[v] = {}; }
  if (!currentMedien[v][k]) { if (!anlegen) return null; currentMedien[v][k] = { bilder: [], video: '' }; }
  const e = currentMedien[v][k];
  if (!Array.isArray(e.bilder)) e.bilder = [];
  if (typeof e.video !== 'string') e.video = '';
  return e;
}
function medienHatEigene(v, k) {
  const e = medienEintrag(v, k, false);
  return !!(e && (e.bilder.length || e.video));
}

// ------------------------------------------------------------
// HAUPTFOTO (fester Name auf Cloudinary)
// ------------------------------------------------------------
const HERO = { id: 'mila-hero', ext: 'png' };
const ladeZeit = Date.now();
const fotoVersion = {};                           // id -> Zeitpunkt des letzten Uploads (Cache umgehen)
const medienOffen = {};                           // aufgeklappte Kronen merken
const bust = id => fotoVersion[id] || ladeZeit;
const kronenListe = () => Object.keys(MEDIEN_VARIANTEN);
const auswahlVon = v => medienAuswahl[v] || '_default';

// fester Name des Hauptfotos für Krone v und Farbe k ('_default' = Kollektionsbild)
function hauptId(v, k) {
  if (PF_MAP && PF_MAP[v]) return PF_MAP[v][k] || null;
  if (k === '_default') {                         // Fallback ohne produktfotos.json
    const f = PRODUKT_FOTOS.find(p => p.variant === 'Startseite' && p.label === '⭐ Kollektion – ' + v);
    return f ? f.key : null;
  }
  return null;
}
// andere Farben, die dasselbe Hauptfoto benutzen
function teilenFoto(v, k, id) {
  if (!PF_MAP || !PF_MAP[v] || !id) return [];
  return Object.entries(PF_MAP[v]).filter(([f, x]) => f !== k && x === id).map(([f]) => f === '_default' ? 'Kollektionsbild (alle Farben)' : f);
}
const hauptUrl = (id, ext, w) => `https://res.cloudinary.com/${clName_()}/image/upload/c_fill,w_${w},h_${w}/${encodeURI(id)}.${ext || 'jpg'}?t=${bust(id)}`;

function hauptKachel(id, ext, onErsetzen, titel) {
  if (!id) return `<div class="medien-tile haupt ohne-bild"><div class="leer">Kein fester Name hinterlegt – bitte in katalog.json eintragen</div><div class="tag">★ Hauptfoto</div></div>`;
  return `<div class="medien-tile haupt" data-id="${medienEsc(id)}">
      <img src="${hauptUrl(id, ext, 440)}" alt="" onerror="this.parentNode.classList.add('ohne-bild')">
      <div class="leer">Noch kein Hauptfoto</div>
      <div class="tag">★ ${titel || 'Hauptfoto'}</div>
      <button class="ersetzen" onclick="${onErsetzen}">Hauptfoto ersetzen</button>
    </div>`;
}
// Nur noch ein Hinweis, wenn mehrere Farben dasselbe Hauptfoto benutzen (Ersetzen ändert alle)
function hauptWarnung(id, extra) {
  if (!id || !extra) return '';
  return `<div class="fv-teilt">${extra}</div>`;
}

function renderStart() {
  const box = document.getElementById('fvStart');
  if (!box) return;
  box.innerHTML = `
    <details class="fv-krone" ${medienOffen.__start ? 'open' : ''} ontoggle="medienOffen.__start=this.open">
      <summary>
        <img class="fv-sum-img" src="${hauptUrl(HERO.id, HERO.ext, 104)}" alt="" onerror="this.style.visibility='hidden'">
        <div class="fv-sum-txt"><div class="fv-sum-name">Startseite</div><div class="fv-sum-meta">Hero-Bild ganz oben im Shop</div></div>
        <span class="fv-sum-chev">▼</span>
      </summary>
      <div class="fv-body">
        <div class="medien-hint" style="margin-top:14px">Am besten ein freigestelltes PNG (Hund ohne Hintergrund). Es wird nicht verkleinert.</div>
        <div class="medien-row">${hauptKachel(HERO.id, HERO.ext, "hauptWaehle('__hero')", 'Hero-Bild')}</div>
        ${hauptWarnung(HERO.id)}
      </div>
    </details>`;
}

function renderMedien() {
  renderStart();
  const list = document.getElementById('medienList');
  if (!list) return;
  const cl = clName_();
  list.innerHTML = kronenListe().map((v, vi) => {
    const info = MEDIEN_VARIANTEN[v];
    const k = auswahlVon(v);
    const e = medienEintrag(v, k, false) || { bilder: [], video: '' };
    const alle = currentMedien[v] || {};

    // Zusammenfassung für die zugeklappte Zeile
    let nFotos = 0, nVideo = 0, nFarben = 0;
    Object.entries(alle).forEach(([f, x]) => {
      if (!x) return;
      nFotos += (x.bilder || []).length; if (x.video) nVideo++;
      if (f !== '_default' && ((x.bilder || []).length || x.video)) nFarben++;
    });
    const meta = [info.farben.length + ' Farben', nFotos + ' weitere Fotos', nVideo ? nVideo + (nVideo > 1 ? ' Videos' : ' Video') : 'kein Video']
      .concat(nFarben ? [nFarben + ' mit eigenen Fotos'] : []).join(' · ');
    const kollektion = hauptId(v, '_default');

    const optionen = ['_default', ...info.farben].map(f => {
      const name = f === '_default' ? 'Alle Farben (Kollektionsbild)' : f;
      const stern = medienHatEigene(v, f) ? ' ★' : '';
      return `<option value="${medienEsc(f)}" ${f === k ? 'selected' : ''}>${medienEsc(name + stern)}</option>`;
    }).join('');

    const hid = hauptId(v, k);
    const teilt = teilenFoto(v, k, hid);
    const extra = teilt.length ? `Dasselbe Hauptfoto gilt auch für ${medienEsc(teilt.join(', '))}. Ersetzen ändert es dort mit.` : '';

    let hint = '';
    if (k !== '_default' && !e.bilder.length) hint = 'Diese Farbe hat keine eigenen weiteren Fotos – im Shop werden die von „Alle Farben“ gezeigt.';
    if (k !== '_default' && !e.video) hint += (hint ? ' ' : '') + 'Ohne eigenes Video wird das Video von „Alle Farben“ gezeigt.';

    const tiles = e.bilder.map((id, i) => `
      <div class="medien-tile">
        <img src="https://res.cloudinary.com/${cl}/image/upload/c_fill,w_220,h_220/${encodeURI(id)}.jpg" alt="" loading="lazy"
          onerror="this.style.opacity=0.2">
        <div class="tag">Foto ${i + 2}</div>
        <div class="acts">
          ${hid ? `<button class="stern" title="Als Hauptfoto verwenden (tauscht mit dem jetzigen)" onclick="alsHauptfoto(${vi},${i})">★</button>` : ''}
          ${i > 0 ? `<button title="Nach vorne" onclick="medienVerschieben(${vi},${i})">◀</button>` : ''}
          <button title="Entfernen" onclick="medienEntfernen(${vi},${i})">✕</button>
        </div>
      </div>`).join('');
    const addFoto = e.bilder.length < MEDIEN_MAX_FOTOS
      ? `<button class="medien-add" onclick="medienWaehle(${vi},'foto')"><span>📸</span>Foto hinzufügen<small style="font-weight:400">${e.bilder.length} / ${MEDIEN_MAX_FOTOS}</small></button>` : '';
    const video = e.video
      ? `<div class="medien-tile">
          <img src="https://res.cloudinary.com/${cl}/video/upload/so_0,c_fill,w_220,h_220/${encodeURI(e.video)}.jpg" alt="" onerror="this.style.opacity=0.2">
          <div class="play">▶</div><div class="tag">Video</div>
          <div class="acts"><button title="Video entfernen" onclick="medienEntfernen(${vi},'video')">✕</button></div>
        </div>`
      : `<button class="medien-add" onclick="medienWaehle(${vi},'video')"><span>🎬</span>Video hinzufügen</button>`;

    return `
      <details class="fv-krone" ${medienOffen[v] ? 'open' : ''} data-vi="${vi}" ontoggle="medienOffen[kronenListe()[this.dataset.vi]]=this.open">
        <summary>
          ${kollektion ? `<img class="fv-sum-img" src="${hauptUrl(kollektion, 'jpg', 104)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<div class="fv-sum-img"></div>'}
          <div class="fv-sum-txt"><div class="fv-sum-name">${medienEsc(v)}</div><div class="fv-sum-meta">${medienEsc(meta)}</div></div>
          <span class="fv-sum-chev">▼</span>
        </summary>
        <div class="fv-body">
          <div class="fv-farbe">
            <label for="fvFarbe${vi}">Farbe</label>
            <select id="fvFarbe${vi}" onchange="medienAuswahl[kronenListe()[${vi}]]=this.value;renderMedien()">${optionen}</select>
          </div>
          ${hint ? `<div class="medien-hint">${medienEsc(hint)}</div>` : ''}
          <div class="medien-row">${hauptKachel(hid, 'jpg', `hauptWaehle(${vi})`)}${tiles}${addFoto}${video}</div>
          ${hauptWarnung(hid, extra)}
        </div>
      </details>`;
  }).join('');
}

// ---- Hauptfoto hochladen (überschreibt den festen Namen) ----
let hauptZiel = null;
function hauptWaehle(vi) {
  if (vi === '__hero') hauptZiel = { ...HERO, label: 'Hero-Bild' };
  else {
    const v = kronenListe()[vi], k = auswahlVon(v);
    hauptZiel = { id: hauptId(v, k), ext: 'jpg', label: v + (k === '_default' ? '' : ' – ' + k), teilt: teilenFoto(v, k, hauptId(v, k)) };
  }
  if (!hauptZiel.id) { showStatus('Für diese Farbe ist kein fester Foto-Name hinterlegt.', 'error'); return; }
  if (hauptZiel.teilt && hauptZiel.teilt.length &&
      !confirm('Dieses Hauptfoto gilt auch für: ' + hauptZiel.teilt.join(', ') + '.\nEs wird dort ebenfalls ersetzt. Weiter?')) return;
  const inp = document.getElementById('hauptFotoInput');
  inp.value = ''; inp.click();
}

async function hauptUpload(input) {
  const file = input.files[0]; const ziel = hauptZiel;
  if (!file || !ziel) return;
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) { showStatus('Nur JPG, PNG oder WebP Fotos erlaubt!', 'error'); return; }
  if (file.size > 20 * 1024 * 1024) { showStatus('Foto ist zu groß! Maximal 20 MB.', 'error'); return; }
  if (!medienKey()) return;
  try {
    showStatus('Hauptfoto wird vorbereitet...', 'loading');
    const datei = ziel.ext === 'png' ? file : await medienVerkleinern(file);   // PNG (freigestellt) unverändert lassen
    await cloudinaryUpload(datei, { public_id: ziel.id, overwrite: 'true', invalidate: 'true' }, 'image',
      pct => showStatus('Hauptfoto wird hochgeladen... ' + pct + ' %', 'loading'));
    fotoVersion[ziel.id] = Date.now();
    renderMedien();
    showStatus('Hauptfoto „' + ziel.label + '“ ersetzt ✓ – im Shop in wenigen Minuten überall sichtbar.');
  } catch(err) {
    showStatus('Upload Fehler: ' + err.message, 'error');
  }
}

// ---- weiteres Foto zum Hauptfoto machen: tauscht die beiden Fotos ----
async function alsHauptfoto(vi, i) {
  const v = kronenListe()[vi], k = auswahlVon(v);
  const e = medienEintrag(v, k, false); if (!e || !e.bilder[i]) return;
  const hid = hauptId(v, k); if (!hid) return;
  const teilt = teilenFoto(v, k, hid);
  if (teilt.length && !confirm('Das Hauptfoto gilt auch für: ' + teilt.join(', ') + '.\nEs wird dort ebenfalls getauscht. Weiter?')) return;
  if (!medienKey()) return;
  const cl = clName_(), neuesHaupt = e.bilder[i];
  try {
    // 1) bisheriges Hauptfoto als weiteres Foto sichern
    showStatus('Bisheriges Hauptfoto wird gesichert...', 'loading');
    let altKopie = null;
    try {
      const d = await cloudinaryUpload(`https://res.cloudinary.com/${cl}/image/upload/${encodeURI(hid)}.jpg`,
        { public_id: medienNeueId(v, k, 'foto') }, 'image');
      altKopie = d.public_id;
    } catch(err) {
      if (!confirm('Das bisherige Hauptfoto konnte nicht gesichert werden (vielleicht gibt es noch keins).\nTrotzdem fortfahren? Es geht dann verloren.')) { showStatus('Abgebrochen.', 'error'); return; }
    }
    // 2) gewähltes Foto unter dem festen Namen speichern
    showStatus('Neues Hauptfoto wird gespeichert...', 'loading');
    await cloudinaryUpload(`https://res.cloudinary.com/${cl}/image/upload/${encodeURI(neuesHaupt)}.jpg`,
      { public_id: hid, overwrite: 'true', invalidate: 'true' }, 'image');
    fotoVersion[hid] = Date.now();
    // 3) in der Liste: altes Hauptfoto an die Stelle des neuen
    if (altKopie) e.bilder[i] = altKopie; else e.bilder.splice(i, 1);
    renderMedien();
    await medienSpeichern('Admin: Hauptfoto ' + v + (k === '_default' ? '' : ' ' + k) + ' getauscht');
    showStatus(altKopie ? 'Getauscht ✓ – das alte Hauptfoto ist jetzt Foto ' + (i + 2) + '.' : 'Neues Hauptfoto gespeichert ✓');
  } catch(err) {
    showStatus('Fehler beim Tauschen: ' + err.message, 'error');
  }
}

function medienWaehle(vi, typ) {
  const v = kronenListe()[vi];
  medienZiel = { v, k: auswahlVon(v) };
  const inp = document.getElementById(typ === 'video' ? 'medienVideoInput' : 'medienFotoInput');
  inp.value = '';
  inp.click();
}

function medienKey() {
  if (serverZugang && serverZugang.cloudinary) return { server: true };
  const key = localStorage.getItem('mkw_cl_key') || '', secret = localStorage.getItem('mkw_cl_secret') || '';
  if (!key || !secret) { showStatus('Bitte zuerst Cloudinary API Key & Secret in den Einstellungen eintragen!', 'error'); return null; }
  return { key, secret };
}
function medienNeueId(v, k, typ) {
  const info = MEDIEN_VARIANTEN[v];
  return info.slug + (k === '_default' ? '' : '-' + medienSlug(k)) + (typ === 'video' ? '-video' : '') + '-' + Date.now().toString(36);
}

// Signierter Upload zu Cloudinary mit Fortschrittsanzeige
async function cloudinaryUpload(file, params, resourceType, onProgress) {
  const zug = medienKey(); if (!zug) throw new Error('Cloudinary-Zugang fehlt');
  let p, apiKey, signatur;
  if (zug.server) {                                       // ab 1.8: das Apps Script unterschreibt, das Secret bleibt dort
    const r = await schnittstelle('cloudinary', { params });
    p = r.params; apiKey = r.api_key; signatur = r.signature;
  } else {
    p = { ...params, timestamp: Math.floor(Date.now() / 1000).toString() };
    apiKey = zug.key;
    signatur = await sha1(Object.keys(p).sort().map(k => k + '=' + p[k]).join('&') + zug.secret);
  }
  const form = new FormData();
  form.append('file', file);
  Object.entries(p).forEach(([k, val]) => form.append(k, val));
  form.append('api_key', apiKey);
  form.append('signature', signatur);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${clName_()}/${resourceType}/upload`);
    xhr.upload.onprogress = ev => { if (ev.lengthComputable && onProgress) onProgress(Math.round(ev.loaded / ev.total * 100)); };
    xhr.onload = () => {
      let data = {}; try { data = JSON.parse(xhr.responseText); } catch(e) {}
      if (data.public_id) resolve(data); else reject(new Error((data.error && data.error.message) || 'Upload fehlgeschlagen (' + xhr.status + ')'));
    };
    xhr.onerror = () => reject(new Error('Keine Verbindung zu Cloudinary'));
    xhr.send(form);
  });
}

// Fotos vor dem Hochladen auf max. 1600 px verkleinern (schnellere Website)
function medienVerkleinern(file, max = 1600) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const f = Math.min(1, max / Math.max(img.width, img.height));
      if (f === 1 && file.size < 600 * 1024) { URL.revokeObjectURL(url); resolve(file); return; }
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => resolve(b || file), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function medienUploadFoto(input) {
  const file = input.files[0]; const ziel = medienZiel;
  if (!file || !ziel) return;
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) { showStatus('Nur JPG, PNG oder WebP Fotos erlaubt!', 'error'); return; }
  if (file.size > 20 * 1024 * 1024) { showStatus('Foto ist zu groß! Maximal 20 MB.', 'error'); return; }
  if (!medienKey()) return;
  const e = medienEintrag(ziel.v, ziel.k, true);
  if (e.bilder.length >= MEDIEN_MAX_FOTOS) { showStatus('Maximal ' + MEDIEN_MAX_FOTOS + ' weitere Fotos pro Krone/Farbe.', 'error'); return; }
  try {
    showStatus('Foto wird vorbereitet...', 'loading');
    const klein = await medienVerkleinern(file);
    const id = medienNeueId(ziel.v, ziel.k, 'foto');
    const data = await cloudinaryUpload(klein, { public_id: id }, 'image', pct => showStatus('Foto wird hochgeladen... ' + pct + ' %', 'loading'));
    e.bilder.push(data.public_id);
    renderMedien();
    await medienSpeichern('Admin: Foto für ' + ziel.v + ' hinzugefügt');
  } catch(err) {
    showStatus('Upload Fehler: ' + err.message, 'error');
  }
}

async function medienUploadVideo(input) {
  const file = input.files[0]; const ziel = medienZiel;
  if (!file || !ziel) return;
  const okTyp = /^video\/(mp4|quicktime|webm)$/.test(file.type) || /\.(mp4|mov|webm)$/i.test(file.name);
  if (!okTyp) { showStatus('Bitte ein MP4- oder MOV-Video wählen!', 'error'); return; }
  if (file.size > 100 * 1024 * 1024) { showStatus('Video ist zu groß! Maximal 100 MB – bitte kürzen.', 'error'); return; }
  if (!medienKey()) return;
  try {
    const id = medienNeueId(ziel.v, ziel.k, 'video');
    const data = await cloudinaryUpload(file,
      { public_id: id, eager: MEDIEN_VIDEO_EAGER, eager_async: 'true' }, 'video',
      pct => showStatus('Video wird hochgeladen... ' + pct + ' %', 'loading'));
    const e = medienEintrag(ziel.v, ziel.k, true);
    e.video = data.public_id;
    renderMedien();
    await medienSpeichern('Admin: Video für ' + ziel.v + ' hinzugefügt');
    showStatus('Video gespeichert! Cloudinary bereitet es noch kurz auf – in ~1–2 Minuten ist es im Shop.');
  } catch(err) {
    showStatus('Upload Fehler: ' + err.message, 'error');
  }
}

function medienVerschieben(vi, i) {
  const v = kronenListe()[vi], k = auswahlVon(v);
  const e = medienEintrag(v, k, false); if (!e || i < 1) return;
  [e.bilder[i - 1], e.bilder[i]] = [e.bilder[i], e.bilder[i - 1]];
  renderMedien();
  medienSpeichern('Admin: Fotoreihenfolge ' + v + ' geändert');
}
function medienEntfernen(vi, i) {
  const v = kronenListe()[vi], k = auswahlVon(v);
  const e = medienEintrag(v, k, false); if (!e) return;
  if (!confirm(i === 'video' ? 'Video wirklich entfernen?' : 'Foto wirklich entfernen?')) return;
  if (i === 'video') e.video = ''; else e.bilder.splice(i, 1);
  if (!e.bilder.length && !e.video && k !== '_default') delete currentMedien[v][k];
  renderMedien();
  medienSpeichern('Admin: ' + (i === 'video' ? 'Video' : 'Foto') + ' bei ' + v + ' entfernt');
}

let medienSpeichernLaeuft = Promise.resolve();
function medienSpeichern(msg) {
  // nacheinander speichern, damit sich zwei schnelle Änderungen nicht überholen
  medienSpeichernLaeuft = medienSpeichernLaeuft.then(async () => {
    showStatus('Wird gespeichert...', 'loading');
    try {
      await githubPut('medien.json', JSON.stringify(currentMedien, null, 2), msg || 'Admin: Fotos & Videos aktualisiert');
      showStatus('Gespeichert! Die Website zeigt es in ~1 Minute.');
    } catch(e) {
      showStatus('Fehler beim Speichern: ' + e.message, 'error');
    }
  });
  return medienSpeichernLaeuft;
}
