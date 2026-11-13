// Kronenwelt Admin – Statusleiste, GitHub-Dateien, Laden der Daten, Katalog
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// STATUS
// ============================================================
let statusTimer;
function showStatus(msg, type = 'success') {
  const bar = document.getElementById('statusBar');
  document.getElementById('statusText').textContent = msg;
  document.getElementById('statusIcon').textContent = type === 'success' ? '✅' : type === 'error' ? '❌' : '⏳';
  bar.className = 'status-bar show ' + type;
  clearTimeout(statusTimer);
  if (type !== 'loading') statusTimer = setTimeout(() => bar.classList.remove('show'), 3500);
}

// ============================================================
// GITHUB API
// ============================================================
// Ab Schnittstelle 1.8 liest und speichert das Apps Script (Token liegt dort). Sonst wie bisher direkt mit dem Token im Browser.
let githubVorrat = {};
async function githubVorladen(pfade) {
  try {
    if (!(await zugaengePruefen()).github) return;
    Object.assign(githubVorrat, (await schnittstelle('github', { art: 'lesen', pfade })).dateien);
  } catch (e) { githubVorrat = {}; }
}
async function githubGet(path) {
  if ((await zugaengePruefen()).github) {
    let d;
    if (path in githubVorrat) { d = githubVorrat[path]; delete githubVorrat[path]; }
    else d = (await schnittstelle('github', { art: 'lesen', pfade: [path] })).dateien[path];
    if (!d) throw new Error('GitHub Fehler: 404');
    return { sha: d.sha, content: btoa(unescape(encodeURIComponent(d.inhalt))) };
  }
  const token = await getToken();
  const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`, {
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!res.ok) throw new Error('GitHub Fehler: ' + res.status);
  return res.json();
}

async function githubPut(path, content, message) {
  if ((await zugaengePruefen()).github) {
    try { return await schnittstelle('github', { art: 'schreiben', pfad: path, inhalt: content, nachricht: message }); }
    catch (e) { throw new Error(e.message === 'github_token_ungueltig' ? 'GitHub lehnt das Token im Apps Script ab (abgelaufen?). Bitte ein neues GITHUB_TOKEN eintragen.' : (e.daten && e.daten.text) || e.message); }
  }
  const token = await getToken();

  // Aktuelle SHA holen
  let sha = '';
  try {
    const current = await githubGet(path);
    sha = current.sha;
  } catch(e) {}

  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    ...(sha ? { sha } : {})
  };

  const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'GitHub Fehler');
  }
  return res.json();
}

// ============================================================
// DATEN LADEN
// ============================================================
async function loadCurrentData() {
  showStatus('Daten werden geladen...', 'loading');
  try {
    await githubVorladen(['katalog.json', 'galerie.json', 'medien.json']);   // ab 1.8: ein Abruf für alles
    // Produktkatalog laden (Kronen, Farben, Größen, Preise, Hauptfotos)
    try {
      const kFile = await githubGet('katalog.json');
      KATALOG = JSON.parse(decodeURIComponent(escape(atob(kFile.content))));
      if (!Array.isArray(KATALOG.produkte) || !KATALOG.produkte.length) throw new Error('leer');
      currentPrices = preiseAusKatalog(KATALOG);
      uebernehmeProduktfotos(fotosAusKatalog(KATALOG));
    } catch(e) {
      KATALOG = null;
      console.log('katalog.json nicht gefunden, nutze preise.json / produktfotos.json');
    }

    // Alter Stand (nur ohne katalog.json): Preise aus preise.json
    if (!KATALOG) try {
      const preiseFile = await githubGet('preise.json');
      currentPrices = { ...currentPrices, ...JSON.parse(decodeURIComponent(escape(atob(preiseFile.content)))) };
    } catch(e) {
      console.log('preise.json nicht gefunden, nutze Standard-Preise');
    }

    // Galerie aus galerie.json laden
    try {
      const galerieFile = await githubGet('galerie.json');
      currentGalerie = JSON.parse(decodeURIComponent(escape(atob(galerieFile.content))));
    } catch(e) {
      currentGalerie = [];
    }

    // Alter Stand (nur ohne katalog.json): Kronen & Farben aus produktfotos.json
    if (!KATALOG) try {
      const pfFile = await githubGet('produktfotos.json');
      uebernehmeProduktfotos(JSON.parse(decodeURIComponent(escape(atob(pfFile.content)))));
    } catch(e) {
      console.log('produktfotos.json nicht gefunden, nutze eingebaute Liste');
    }

    // Weitere Fotos & Videos aus medien.json laden
    try {
      const medienFile = await githubGet('medien.json');
      currentMedien = JSON.parse(decodeURIComponent(escape(atob(medienFile.content)))) || {};
    } catch(e) {
      currentMedien = {};
    }

    renderPreise();
    renderGalerie();
    renderMedien();
    fotoPruefung = null; fotoPruefungLaeuft = 0; datenGeladen = true;
    if (document.getElementById('tab-start').style.display !== 'none') renderUebersicht();
    if (document.getElementById('tab-lager').style.display !== 'none') ladeLager();
    showStatus('Daten geladen ✓');
  } catch(e) {
    showStatus('Fehler beim Laden: ' + e.message, 'error');
    renderPreise();
    renderGalerie();
    renderMedien();
  }
}

// ============================================================
// KATALOG (katalog.json)
// ============================================================
// Preise in der bekannten Form { Krone: { Gross: 15, … }, 'Zahlenpets Aufpreis': { '6 Pets': 3, … } }
function preiseAusKatalog(k) {
  const out = {};
  k.produkte.forEach(p => {
    out[p.name] = {};
    ((p.merkmale || {}).groesse || []).forEach(g => { out[p.name][g.wert] = g.preis; });
  });
  const pets = ((k.optionen || {}).zahlenpets || {}).werte || [];
  out[AUFPREIS_KEY] = {};
  pets.forEach(o => { if (o.wert !== 3) out[AUFPREIS_KEY][o.wert + ' Pets'] = o.aufpreis; });
  return out;
}
// Hauptfotos in der Form von produktfotos.json { Krone: { _default: 'id', Farbe: 'id' } }
function fotosAusKatalog(k) {
  const out = {};
  k.produkte.forEach(p => {
    out[p.name] = { _default: p.hauptfoto };
    ((p.merkmale || {}).farbe || []).forEach(f => { out[p.name][f.wert] = f.foto; });
  });
  return out;
}
const katalogProdukt = v => KATALOG ? KATALOG.produkte.find(p => p.name === v) : null;
