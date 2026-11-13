// Kronenwelt Admin – Bestellungen: Liste, Status, Versand, Bestellung von Hand, MK-Nummern
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// BESTELLUNGEN (nur lesen; Status, Versand und Bestellungen von Hand folgen in 1.4 / 1.6)
// ============================================================
let bestellungen = null;            // zuletzt geladene Liste (neueste zuerst)
let bestellFehler = '';
let bestellSuche = '';
let bestellLaden = null;

function ladeBestellungen(neu) {
  if (!apiKonfiguriert()) { bestellungen = null; bestellFehler = ''; renderBestellungen(); renderStartBestellungen(); return Promise.resolve(); }
  if (bestellLaden) return bestellLaden;
  if (bestellungen && !neu) { renderBestellungen(); return Promise.resolve(); }
  if (!bestellungen) renderBestellungen(true);
  bestellLaden = schnittstelle('bestellungen').then(r => {
    bestellungen = r.bestellungen || []; bestellFehler = '';
  }).catch(e => { bestellFehler = apiFehlerText(e); }).then(() => {
    bestellLaden = null;
    if (neu) neuHinweisWeg();
    renderBestellungen();
    bestellungenAktualisiert();
    renderStartBestellungen();
    if (document.getElementById('tab-start').style.display !== 'none') renderTodo();
    if (neu) showStatus(bestellFehler ? bestellFehler : 'Bestellungen aktualisiert ✓', bestellFehler ? 'error' : 'success');
  });
  return bestellLaden;
}

// Mehrere Kronen stehen in einer Zeile ("Party, Glitzer" / Personalisierung "MILA | LUNA") → einzelne Positionen
function positionen(b) {
  const teile = (t, trenner) => String(t || '').split(trenner).map(x => x.trim());
  const v = teile(b.variante, ', '), f = teile(b.farbe, ', '), g = teile(b.groesse, ', '), p = teile(b.personalisierung, ' | ');
  if (v.length > 1 && v.length === f.length && v.length === g.length) {
    return v.map((x, i) => ({ variante: x, farbe: f[i], groesse: g[i], pers: p.length === v.length ? p[i] : '' }));
  }
  return [{ variante: b.variante, farbe: b.farbe, groesse: b.groesse, pers: b.personalisierung }];
}
const persText = t => !t || t === 'ohne Namen' ? 'ohne Namen' : '„' + t + '“';
const euro = x => (Math.round((x || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' €';
function datumTeile(d) {               // "01.10.2026" → { tag: '1.', monat: 'Okt' }
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(d || '');
  if (!m) return { tag: '–', monat: '' };
  const mon = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][+m[2] - 1];
  return { tag: +m[1] + '.', monat: mon + (String(new Date().getFullYear()) === m[3] ? '' : ' ' + m[3].slice(2)) };
}

function renderBestellungen(laedt) {
  const box = document.getElementById('bestInhalt');
  if (!box) return;
  const knopf = document.getElementById('btnNeueBestellung');
  if (knopf) knopf.style.display = apiKonfiguriert() ? '' : 'none';
  if (!apiKonfiguriert()) {
    box.innerHTML = `<div class="card best-leer">
      <div class="card-title">Bestellungen verbinden</div>
      <p>Damit hier die Bestellungen aus der Google-Tabelle erscheinen, braucht der Admin einmalig den Admin-Schlüssel aus dem Apps Script.</p>
      <button class="btn btn-primary" onclick="geheZu('einstellungen')">Zu den Einstellungen</button></div>`;
    return;
  }
  if (laedt) { box.innerHTML = '<div class="card best-leer"><p>Bestellungen werden geladen …</p></div>'; return; }
  if (bestellFehler && !bestellungen) {
    box.innerHTML = `<div class="card best-leer"><div class="card-title">Keine Verbindung</div><p>${medienEsc(bestellFehler)}</p>
      <button class="btn btn-teal" onclick="ladeBestellungen(true)">Nochmal versuchen</button></div>`;
    return;
  }
  box.innerHTML = `
    <div class="best-werkzeug2">
      <div class="best-filter" id="bestFilterLeiste" role="tablist"></div>
      <input class="best-suche" id="bestSuche" type="search" placeholder="Suchen: Name, Nr., Krone, Ort …"
        value="${medienEsc(bestellSuche)}" oninput="bestellSuche=this.value;renderBestellListe()">
    </div>
    <div class="best-summe" id="bestSumme"></div>
    <div class="best-liste" id="bestListe"></div>`;
  renderBestellListe();
}

// Status und Kanäle. Neue Kanäle oder Zahlarten = ein Eintrag hier.
const STATUS_LISTE = ['Neu', 'In Arbeit', 'Versendet', 'Übergeben', 'Storniert'];
const KANAELE = ['Etsy', 'Amazon', 'Markt', 'Instagram', 'Webshop', 'Spende', 'Sonstiges'];   // Spende = verschenkt/gesponsert, 0 €
const ZAHLARTEN = ['Etsy', 'Amazon', 'Bar', 'Karte (SumUp)', 'PayPal', 'Überweisung', 'Keine (Spende)'];
const ZAHLART_JE_KANAL = { Etsy: 'Etsy', Amazon: 'Amazon', Markt: 'Bar', Webshop: 'PayPal', Instagram: 'PayPal', Spende: 'Keine (Spende)' };
const SONSTIGES = 'Sonstiges (freie Bezeichnung)';           // Zahlen-Sets, Sonderanfertigungen, Kooperationen – ohne Lager
const FILTER = [
  { id: 'offen', titel: 'Offen', passt: b => b.status === 'Neu' || b.status === 'In Arbeit' },
  { id: 'erledigt', titel: 'Erledigt', passt: b => b.status === 'Versendet' || b.status === 'Übergeben' },
  { id: 'storniert', titel: 'Storniert', passt: b => b.status === 'Storniert' },
  { id: 'alle', titel: 'Alle', passt: () => true }
];
let bestellFilter = null;                 // null = automatisch: „Offen“, wenn es offene gibt
const bestellOffen = {};                  // aufgeklappte Bestellungen (nach Nr.)
const statusKlasse = st => 'status status-' + String(st || '').toLowerCase().replace('ü', 'ue').replace(/\s+/g, '-');
const bestellungNachNr = nr => (bestellungen || []).find(b => b.nr === nr);
const jsArg = x => JSON.stringify(x).replace(/"/g, '&quot;');

function renderBestellListe() {
  const alle = bestellungen || [];
  const q = bestellSuche.trim().toLowerCase();
  const filterId = bestellFilter || (alle.some(FILTER[0].passt) ? 'offen' : 'alle');
  const f = FILTER.find(x => x.id === filterId) || FILTER[3];
  const gesucht = q ? alle.filter(b => [b.nr, b.kunde, b.email, b.adresse, b.variante, b.farbe, b.personalisierung, b.datum, b.kanal, b.sendungsnummer, b.notiz]
    .join(' ').toLowerCase().includes(q)) : alle;
  const treffer = q ? gesucht : gesucht.filter(f.passt);          // Suche geht immer über alle
  const jahr = String(new Date().getFullYear());
  const imJahr = alle.filter(b => (b.datum || '').endsWith(jahr) && b.status !== 'Storniert');
  const summe = l => l.reduce((n, b) => n + (b.preis || 0), 0);

  const fbox = document.getElementById('bestFilterLeiste');
  if (fbox) fbox.innerHTML = q ? '' : FILTER.map(x =>
    `<button class="${x.id === filterId ? 'active' : ''}" data-filter="${x.id}" onclick="bestellFilter='${x.id}';renderBestellListe()">${x.titel}<span>${alle.filter(x.passt).length}</span></button>`).join('');
  const s = document.getElementById('bestSumme');
  if (s) s.textContent = q
    ? treffer.length + ' von ' + alle.length + ' Bestellungen · ' + euro(summe(treffer))
    : jahr + ': ' + imJahr.length + (imJahr.length === 1 ? ' Bestellung' : ' Bestellungen') + ' für ' + euro(summe(imJahr));
  const liste = document.getElementById('bestListe');
  if (!liste) return;
  if (!treffer.length) {
    liste.innerHTML = `<div class="card best-leer"><p>${q ? 'Keine Bestellung passt zur Suche.' : f.id === 'offen' ? 'Keine offenen Bestellungen. Alles erledigt!' : 'Hier ist nichts.'}</p></div>`;
    return;
  }
  // Unter „Offen“ nach Arbeitsschritt gruppieren: erst Neues, dann Angefangenes
  if (!q && f.id === 'offen') {
    const gruppen = [['Neu', 'noch nicht angefangen'], ['In Arbeit', 'fertig machen und versenden']];
    liste.innerHTML = gruppen.map(([st, text]) => {
      const l = treffer.filter(b => b.status === st);
      return l.length ? `<div class="best-gruppe"><b>${st}</b> ${l.length} · ${text}</div>` + l.map(bestellKarte).join('') : '';
    }).join('');
    return;
  }
  liste.innerHTML = treffer.map(bestellKarte).join('');
}

// Werktage (Mo–Fr) seit dem Bestelldatum
function werktageSeit(datum) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(datum || '');
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]), heute = new Date();
  heute.setHours(0, 0, 0, 0);
  let n = 0;
  for (let x = new Date(d); x < heute; ) { x.setDate(x.getDate() + 1); if (x.getDay() % 6 !== 0 && x <= heute) n++; }
  return n;
}
const LIEFERZEIT_WARNUNG = 4;          // ab so vielen Werktagen rot (Shop verspricht 5–6 Werktage Lieferzeit)
const versandOffen = {};               // „Jetzt versenden“ bei neuen Bestellungen aufgeklappt
async function adresseKopieren(nr) {
  const b = bestellungNachNr(nr);
  if (!b) return;
  const text = [b.kunde, ...String(b.adresse || '').split(/,\s*/)].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(text); showStatus('Adresse kopiert ✓'); }
  catch (e) { showStatus('Kopieren ging nicht. Bitte von Hand markieren.', 'error'); }
}

function bestellKarte(b) {
  const d = datumTeile(b.datum), pos = positionen(b);
  const offen = b.status === 'Neu' || b.status === 'In Arbeit';
  const markt = b.kanal === 'Markt';
  const mailMoeglich = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email || '');
  const nr = jsArg(b.nr), id = medienEsc(b.nr);
  const kanalStil = typeof kisteStil === 'function' && kisteFuerKanal(b.kanal) ? kisteStil(kisteFuerKanal(b.kanal)) : '';
  const posZeile = x => medienEsc(x.variante + ' · ' + x.farbe + ' · ' + x.groesse) + (x.pers && x.pers !== 'ohne Namen' ? ' <em>„' + medienEsc(x.pers) + '“</em>' : '');
  const wt = offen ? werktageSeit(b.datum) : null;
  const alter = wt == null ? '' : `<div class="best-alter ${wt >= LIEFERZEIT_WARNUNG && !markt ? 'warn' : ''}">${wt === 0 ? 'heute bestellt'
    : 'seit ' + wt + (wt === 1 ? ' Werktag' : ' Werktagen') + ' offen'}${wt >= LIEFERZEIT_WARNUNG && !markt ? ' · bitte bald versenden' : ''}</div>`;

  // Schritte: Webshop/Etsy/Amazon = Bestellt → In Arbeit → Versendet; Markt = Bestellt → Übergeben
  const stufen = markt ? ['Bestellt', 'Übergeben'] : ['Bestellt', 'In Arbeit', 'Versendet'];
  const stand = b.status === 'Neu' ? 1 : b.status === 'In Arbeit' ? (markt ? 1 : 2) : 99;
  const schritte = b.status === 'Storniert' ? '' : `<ol class="schritte" aria-label="Fortschritt">${stufen.map((t, i) =>
    `<li class="${i < stand ? 'fertig' : i === stand ? 'jetzt' : ''}"><span></span>${t}</li>`).join('')}</ol>`;
  const versandBox = `
      <div class="versand-box">
        <label class="titel" for="sn-${id}">DHL-Sendungsnummer</label>
        <input type="text" id="sn-${id}" placeholder="z. B. 0034 0434 …" autocomplete="off" autocapitalize="characters">
        ${mailMoeglich ? `<label class="haken"><input type="checkbox" id="mail-${id}" ${b.kanal === 'Webshop' ? 'checked' : ''}>
          <span>Versandmail mit Sendungsverfolgung an ${medienEsc(b.email)} schicken${b.kanal !== 'Webshop' ? ` <span class="leise">(${medienEsc(b.kanal)} schickt meist selbst eine Mail)</span>` : ''}</span></label>`
          : '<div class="leise">Keine E-Mail-Adresse hinterlegt, es geht keine Versandmail raus.</div>'}
        ${serienFelder(b, pos)}
        <div class="aktion-zeile"><button class="btn btn-primary" onclick="versendenKlick(${nr})">Als versendet markieren</button>
          ${b.kanal === 'Spende' ? `<button class="btn btn-outline" onclick="uebergebenKlick(${nr})">Persönlich übergeben</button>` : ''}</div>
      </div>`;
  // Zahlung: PRÜFEN = verdächtig (nicht versenden, bevor in PayPal nachgesehen), NICHT GEPRÜFT = Prüfung lief nicht
  const zg = b.zahlungGeprueft || '';
  const zPruefen = /^PRÜFEN/.test(zg), zOffen = /^NICHT GEPRÜFT/.test(zg), zOk = /^OK/.test(zg);
  const zahlungBox = zPruefen && b.status !== 'Storniert' ? `<div class="zahlung-warnung"><b>⚠ Zahlung prüfen:</b> ${medienEsc(zg.replace(/^PRÜFEN:\s*/, ''))}.<br>
      Bitte erst in PayPal nachsehen, ob das Geld wirklich da ist, bevor du nähst oder versendest.
      <div><button class="btn btn-outline btn-sm" onclick="zahlungKlick(${nr})">Nochmal prüfen</button></div></div>`
    : zOffen ? `<div class="zahlung-warnung grau"><b>Zahlung noch nicht geprüft</b> (${medienEsc(zg.replace(/^NICHT GEPRÜFT:\s*/, ''))}).
      <div><button class="btn btn-outline btn-sm" onclick="zahlungKlick(${nr})">Jetzt prüfen</button></div></div>` : '';
  let naechster = '';
  if (b.status === 'Storniert') naechster = '<div class="schritt-text"><b>Storniert.</b> Die Kronen sind wieder im Lager. Unter „Weitere Aktionen“ lässt sich das rückgängig machen.</div>';
  else if (markt && offen) naechster = `<div class="schritt-text"><b>Nächster Schritt:</b> Krone übergeben.</div>
      ${serienFelder(b, pos)}
      <div class="aktion-zeile"><button class="btn btn-primary btn-sm" onclick="uebergebenKlick(${nr})">Übergeben</button>
      ${b.status === 'Neu' ? `<button class="btn btn-teal btn-sm" onclick="statusKlick(${nr}, 'In Arbeit')">In Arbeit nehmen</button>` : ''}</div>`;
  else if (b.status === 'Neu') naechster = `<div class="schritt-text"><b>Nächster Schritt:</b> ${pos.length > 1 ? pos.length + ' Kronen' : 'Krone'} nähen bzw. fertig machen.</div>
      <div class="aktion-zeile"><button class="btn btn-primary btn-sm" onclick="statusKlick(${nr}, 'In Arbeit')">In Arbeit nehmen</button>
        ${versandOffen[b.nr] ? '' : `<button class="btn btn-teal btn-sm" onclick="versandOffen[${nr}]=true;bestellOffen[${nr}]=true;renderBestellListe()">Schon fertig? Jetzt versenden</button>`}</div>
      ${versandOffen[b.nr] ? versandBox : ''}`;
  else if (b.status === 'In Arbeit') naechster = `<div class="schritt-text"><b>Nächster Schritt:</b> verpacken und versenden.</div>${versandBox}`;
  else if (b.status === 'Versendet') naechster = `<div class="schritt-text"><b>Versendet</b> am ${medienEsc(b.versendetAm || '–')}${b.sendungsnummer
      ? ` · <a href="https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encodeURIComponent(b.sendungsnummer)}" target="_blank" rel="noopener">${medienEsc(b.sendungsnummer)} ↗</a>`
      : ' · ohne Sendungsnummer'}${/Versandmail/.test(b.notiz || '') ? ' · Versandmail ist raus' : ''}</div>`;
  else if (b.status === 'Übergeben') naechster = '<div class="schritt-text"><b>Übergeben.</b> Erledigt.</div>';

  return `<details class="best ${b.status === 'Storniert' ? 'storniert' : ''}" data-nr="${id}" ${bestellOffen[b.nr] ? 'open' : ''} ontoggle="bestellOffen[this.dataset.nr]=this.open">
      <summary>
        <div class="best-datum"><b>${d.tag}</b><span>${medienEsc(d.monat)}</span></div>
        <div><div class="best-kunde">${istUngesehen(b) ? '<span class="frisch-punkt" title="Neu seit deinem letzten Besuch"></span>' : ''}${medienEsc(b.kunde || 'ohne Namen')} <span class="${statusKlasse(b.status)}">${medienEsc(b.status)}</span><span class="best-kanal" style="${kanalStil}">${medienEsc(b.kanal)}</span>${zPruefen && b.status !== 'Storniert' ? '<span class="badge-pruefen">Zahlung prüfen</span>' : ''}</div>
          <div class="best-pos">${pos.map(posZeile).join('<br>')}</div>${alter}</div>
        <div class="best-betrag">${euro(b.preis)}<small>${pos.length > 1 ? pos.length + ' Kronen' : medienEsc(b.zahlung || '')}</small></div>
      </summary>
      <div class="best-body">
        <div class="best-schritt">${zahlungBox}${schritte}${naechster}</div>
        <dl class="best-details">
          <div class="best-artikel was-naehen"><dt>${offen ? 'Was zu tun ist' : 'Artikel'}</dt><dd><ul>${pos.map(x => `<li>${medienEsc(x.variante)} · ${medienEsc(x.farbe)} · ${medienEsc(x.groesse)} · <em>${medienEsc(persText(x.pers))}</em></li>`).join('')}</ul></dd></div>
          <div><dt>Lieferadresse</dt><dd>${b.adresse ? medienEsc(b.kunde) + '<br>' + medienEsc(b.adresse).replace(/, /g, '<br>')
            + `<br><button class="kopier-knopf" onclick="adresseKopieren(${nr})">Adresse kopieren</button>` : '–'}</dd></div>
          <div><dt>Kontakt</dt><dd>${b.email ? `<a href="mailto:${medienEsc(b.email)}?subject=${encodeURIComponent('Deine Bestellung ' + b.nr)}">${medienEsc(b.email)}</a>` : '–'}</dd></div>
          <div><dt>Bestellung</dt><dd>${medienEsc(b.nr)}<br>${medienEsc(b.datum)}${b.uhrzeit ? ' um ' + medienEsc(b.uhrzeit) + ' Uhr' : ''} · ${medienEsc(b.kanal)}${b.plattformNr ? '<br>' + medienEsc(b.kanal) + '-Nr. ' + medienEsc(b.plattformNr) : ''}${b.artikel && b.kiste ? '<br><span class="leise">Lager: ' + medienEsc(b.kiste === 'nicht vom Lager' ? 'nicht vom Lager' : 'aus Kiste ' + b.kiste) + '</span>' : ''}</dd></div>
          ${b.seriennummern ? `<div><dt>MK-Nummern</dt><dd><span class="serien-zeile">${b.seriennummern.split(/\s*,\s*/).map(x => `<span class="mk">${medienEsc(x)}</span>`).join('')}</span>
            <button class="kopier-knopf" onclick="textKopieren(${jsArg(b.seriennummern)}, 'MK-Nummern kopiert ✓')">Kopieren</button>${b.rechnungsnr ? '<br><span class="leise">Rechnung ' + medienEsc(b.rechnungsnr) + '</span>' : ''}</dd></div>` : ''}
          <div><dt>Zahlung</dt><dd>${medienEsc(b.zahlung || '–')} · ${euro(b.preis)}${zOk ? '<br><span class="zahlung-ok">✓ bei PayPal bestätigt</span>' : ''}${b.paypalId ? '<br><span class="leise">PayPal ' + medienEsc(b.paypalId) + '</span>' : ''}</dd></div>
          ${b.notiz ? `<div class="best-artikel"><dt>Notiz</dt><dd>${medienEsc(b.notiz)}</dd></div>` : ''}
        </dl>
        <details class="best-mehr"><summary>Weitere Aktionen</summary>
          <div class="aktion-zeile"><label class="leise" for="st-${id}">Status von Hand setzen:</label>
            <select id="st-${id}" aria-label="Status ändern" onchange="statusKlick(${nr}, this.value)">
              ${STATUS_LISTE.map(st => `<option ${st === b.status ? 'selected' : ''}>${st}</option>`).join('')}
            </select></div>
          <div class="leise" style="font-size:12px">Zum Beispiel, um eine versehentliche Änderung zurückzunehmen. „Storniert“ bucht die Kronen zurück ins Lager.</div>
          <div class="aktion-zeile" style="margin-top:10px"><label class="leise" for="re2-${id}">Rechnungsnummer:</label>
            <input type="text" id="re2-${id}" value="${medienEsc(b.rechnungsnr || '')}" placeholder="z. B. aus Papierkram" style="max-width:200px;padding:7px 9px;border:1px solid var(--line2);border-radius:2px;font-size:15px">
            <button class="btn btn-outline btn-sm" onclick="rechnungKlick(${nr})">Speichern</button></div>
        </details>
      </div>
    </details>`;
}

// Ergebnis der Schnittstelle in die Liste übernehmen und Ansicht auffrischen
function bestellungErsetzen(neu) {
  lagerVeraltet();                                  // Verkauf/Storno hat das Lager verändert
  const i = (bestellungen || []).findIndex(b => b.nr === neu.nr);
  if (i >= 0) bestellungen[i] = neu; else (bestellungen = bestellungen || []).unshift(neu);
  renderBestellListe();
  renderStartBestellungen();
  if (document.getElementById('tab-start').style.display !== 'none') { renderTodo(); renderStartMonat(); }
  bestellungenAktualisiert();
}

async function statusKlick(nr, status) {
  const b = bestellungNachNr(nr);
  if (!b || b.status === status) return;
  if (status === 'Storniert') { stornoDialog(nr); return; }
  await statusSpeichern(nr, status, {});
}

async function statusSpeichern(nr, status, extra) {
  const b = bestellungNachNr(nr);
  showStatus(extra.mail ? 'Wird storniert und Mail wird gesendet …' : 'Status wird gespeichert …', 'loading');
  try {
    const r = await schnittstelle('status', Object.assign({ nr, zeile: b.zeile, status }, extra));
    bestellOffen[nr] = true;
    bestellungErsetzen(r.bestellung);
    showStatus(nr + ': ' + status + ' ✓' + (r.mail ? ' Mail an ' + b.email + ' ist raus.' : '') + (r.lagerFehler ? ' (Lager konnte nicht gebucht werden)' : '')
      + (r.serienFehler ? ' (Hinweis in der Seriennummernliste konnte nicht gesetzt werden)' : ''), r.lagerFehler || r.serienFehler ? 'error' : 'success');
    return true;
  } catch (e) {
    if (serienFehler(nr, e)) return false;
    renderBestellListe();
    showStatus(e.message === 'keine_email' ? 'Bei dieser Bestellung ist keine gültige E-Mail-Adresse hinterlegt.' : apiFehlerText(e), 'error');
    return false;
  }
}

// ---------- Stornieren: Fenster mit Grund, Mail an den Kunden (optional) und Vorschau ----------
const STORNO_GRUENDE = [
  { id: 'wunsch', titel: 'Auf Wunsch des Kunden', satz: nr => 'wie gewünscht haben wir deine Bestellung ' + nr + ' storniert.', mail: true, geld: true },
  { id: 'fertigung', titel: 'Kann nicht gefertigt werden', satz: nr => 'leider können wir deine Bestellung ' + nr + ' nicht wie gewünscht fertigen und haben sie deshalb storniert. Das tut uns sehr leid.', mail: true, geld: true },
  { id: 'zahlung', titel: 'Zahlung nicht eingegangen', satz: nr => 'leider ist die Zahlung für deine Bestellung ' + nr + ' bei uns nicht eingegangen. Deshalb haben wir die Bestellung storniert.', mail: true, geld: false },
  { id: 'test', titel: 'Testbestellung', satz: nr => 'deine Bestellung ' + nr + ' war eine Testbestellung und ist storniert.', mail: false, geld: true },
  { id: 'anders', titel: 'Anderer Grund', satz: nr => 'wir haben deine Bestellung ' + nr + ' storniert.', mail: true, geld: true }
];
let storno = null;
function stornoText(b, s) {
  const g = STORNO_GRUENDE.find(x => x.id === s.grund);
  const ueber = /paypal/i.test(b.zahlung || '') ? ' über PayPal' : b.zahlung ? ' über ' + b.zahlung : '';
  const geld = !g.geld ? '' : s.erstattet
    ? 'Den Betrag von ' + euro(b.preis) + ' haben wir dir' + ueber + ' zurückgezahlt. Je nach Bank siehst du ihn in wenigen Tagen auf deinem Konto.'
    : 'Den Betrag von ' + euro(b.preis) + ' erstatten wir dir in den nächsten Tagen' + ueber + '.';
  const vorname = String(b.kunde || '').trim().split(/\s+/)[0];
  return ['Hallo' + (vorname ? ' ' + vorname : '') + ',', g.satz(b.nr), geld,
    'Wenn du Fragen hast, antworte einfach auf diese Mail oder schreib uns per WhatsApp.', 'Liebe Grüße\nSara'].filter(Boolean).join('\n\n');
}
function stornoDialog(nr) {
  const b = bestellungNachNr(nr);
  const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email || '');
  const plattform = b.kanal === 'Etsy' || b.kanal === 'Amazon';
  storno = { nr, grund: 'wunsch', mail: mailOk && !plattform && b.kanal !== 'Markt', erstattet: false, text: '', bearbeitet: false };
  storno.text = stornoText(b, storno);
  renderStornoDialog();
}
function stornoFeld(k, v) {
  const b = bestellungNachNr(storno.nr);
  storno[k] = v;
  if (k === 'grund') { const g = STORNO_GRUENDE.find(x => x.id === v); if (!g.mail) storno.mail = false; }
  if (!storno.bearbeitet) storno.text = stornoText(b, storno);
  renderStornoDialog();
}
function stornoSchliessen() { storno = null; const d = document.getElementById('stornoDialog'); if (d) d.remove(); renderBestellListe(); }
function renderStornoDialog() {
  const b = bestellungNachNr(storno.nr), s = storno;
  const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email || '');
  let d = document.getElementById('stornoDialog');
  if (!d) { d = document.createElement('div'); d.id = 'stornoDialog'; d.className = 'dlg'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); document.body.appendChild(d); }
  const hinweisPlattform = b.kanal === 'Etsy' || b.kanal === 'Amazon' ? ` <span class="leise">(${medienEsc(b.kanal)} informiert den Kunden meist selbst)</span>` : '';
  d.innerHTML = `<div class="dlg-box">
    <h2>Bestellung stornieren?</h2>
    <div class="dlg-sub">${medienEsc(b.nr)} · ${medienEsc(b.kunde || 'ohne Namen')} · ${euro(b.preis)}<br>Die Kronen werden automatisch zurück ins Lager gebucht.</div>
    <label class="feld" for="stGrund">Grund</label>
    <select id="stGrund" onchange="stornoFeld('grund', this.value)">${STORNO_GRUENDE.map(g => `<option value="${g.id}" ${g.id === s.grund ? 'selected' : ''}>${g.titel}</option>`).join('')}</select>
    ${/paypal/i.test(b.zahlung || '') ? `<label class="haken"><input type="checkbox" id="stErstattet" ${s.erstattet ? 'checked' : ''} onchange="stornoFeld('erstattet', this.checked)">
      <span>Das Geld ist bei PayPal schon zurückgezahlt</span></label>` : ''}
    <label class="haken"><input type="checkbox" id="stMail" ${s.mail ? 'checked' : ''} ${mailOk ? '' : 'disabled'} onchange="stornoFeld('mail', this.checked)">
      <span>${mailOk ? 'Kunde per E-Mail informieren an <b>' + medienEsc(b.email) + '</b>' + hinweisPlattform : 'Keine E-Mail-Adresse hinterlegt, es geht keine Mail raus'}</span></label>
    ${s.mail ? `<div class="dlg-mail"><label class="feld" for="stText">Text der Mail (du kannst ihn ändern)</label>
      <textarea id="stText" oninput="storno.text=this.value;storno.bearbeitet=true">${medienEsc(s.text)}</textarea>
      <div class="leise" style="font-size:12px;margin-top:6px">Betreff: „Deine Bestellung ${medienEsc(b.nr)} wurde storniert“. Darunter stehen automatisch Bestellnummer, Betrag und die Kronen.</div></div>` : ''}
    <div class="dlg-knoepfe">
      <button class="btn btn-outline" onclick="stornoSchliessen()">Abbrechen</button>
      <button class="btn btn-stornieren" id="stOk" onclick="stornoBestaetigen()">${s.mail ? 'Stornieren und Mail senden' : 'Stornieren ohne Mail'}</button>
    </div></div>`;
  const f = d.querySelector(s.mail ? '#stText' : '#stGrund');
  if (f && document.activeElement === document.body) f.focus({ preventScroll: true });
}
async function stornoBestaetigen() {
  const s = storno;
  if (s.mail && !s.text.trim()) { showStatus('Bitte einen Text für die Mail eingeben.', 'error'); return; }
  document.getElementById('stOk').disabled = true;
  const ok = await statusSpeichern(s.nr, 'Storniert', s.mail ? { mail: true, nachricht: s.text.trim() } : {});
  if (ok) stornoSchliessen(); else document.getElementById('stOk').disabled = false;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && storno) stornoSchliessen(); });

async function zahlungKlick(nr) {
  const b = bestellungNachNr(nr);
  if (!b) return;
  showStatus('Zahlung wird bei PayPal geprüft …', 'loading');
  try {
    const r = await schnittstelle('zahlung', { nr, zeile: b.zeile });
    bestellOffen[nr] = true;
    bestellungErsetzen(r.bestellung);
    const z = r.bestellung.zahlungGeprueft || '';
    showStatus(/^OK/.test(z) ? 'Zahlung bestätigt ✓' : z, /^OK/.test(z) ? 'success' : 'error');
  } catch (e) {
    showStatus(apiFehlerText(e), 'error');
  }
}

async function versendenKlick(nr) {
  const b = bestellungNachNr(nr);
  if (!b) return;
  if (/^PRÜFEN/.test(b.zahlungGeprueft || '') && !confirm('Die Zahlung dieser Bestellung ist nicht bestätigt:\n' + b.zahlungGeprueft.replace(/^PRÜFEN:\s*/, '') + '\n\nHast du in PayPal nachgesehen und willst trotzdem versenden?')) return;
  const sn = (document.getElementById('sn-' + nr) || {}).value || '';
  const mailEl = document.getElementById('mail-' + nr);
  const mail = !!(mailEl && mailEl.checked);
  const nummer = sn.replace(/\s+/g, '').toUpperCase();
  if (nummer && !/^[A-Z0-9]{8,40}$/.test(nummer)) { showStatus('Die Sendungsnummer sieht nicht richtig aus. Bitte prüfen.', 'error'); return; }
  const serien = serienAusFormular(nr);                  // erst die MK-Nummern prüfen, dann nachfragen
  if (serien === null) return;
  if (!nummer && !confirm('Ohne Sendungsnummer als versendet markieren?')) return;
  showStatus(mail ? 'Wird gespeichert und Versandmail verschickt …' : 'Wird gespeichert …', 'loading');
  try {
    const r = await schnittstelle('versenden', Object.assign({ nr, zeile: b.zeile, sendungsnummer: nummer, mail }, serien));
    bestellOffen[nr] = true;
    serienVorschlaege = {};                              // Nummern sind verbraucht
    bestellungErsetzen(r.bestellung);
    showStatus((r.mail ? 'Versendet ✓ Versandmail an ' + r.bestellung.email + ' ist raus.' : 'Als versendet markiert ✓')
      + (r.bestellung.seriennummern ? ' MK-Nummern: ' + r.bestellung.seriennummern : ''));
  } catch (e) {
    if (serienFehler(nr, e)) return;
    showStatus(e.message === 'keine_email' ? 'Keine gültige E-Mail-Adresse bei dieser Bestellung.'
      : e.message === 'ungueltige_sendungsnummer' ? 'Die Sendungsnummer sieht nicht richtig aus. Bitte prüfen.' : apiFehlerText(e), 'error');
  }
}

// ---------- MK-Seriennummern (GPSR): je Krone eine Nummer beim Versenden/Übergeben ----------
let serienVorschlaege = {};                              // { nr: ['MK-2025-310', …] }
let serienAus = false;                                   // Liste nicht eingerichtet → Felder ausblenden
let serienLaedt = {};
function serienFelder(b, pos) {
  if (serienAus) return '';
  const id = medienEsc(b.nr), v = serienVorschlaege[b.nr];
  if (!v && !serienLaedt[b.nr]) { serienLaedt[b.nr] = true; setTimeout(() => serienLaden(b.nr, pos.length), 0); }
  return `<div class="serien" id="serien-${id}">
    <label class="titel">MK-Nummern für den Beileger</label>
    <div class="serien-felder">${pos.map((x, i) => `<label class="serien-feld">${medienEsc(x.variante)}${x.pers && x.pers !== 'ohne Namen' ? ' „' + medienEsc(x.pers) + '“' : ''}
      <input type="text" id="mk-${id}-${i}" value="${medienEsc(v ? v[i] || '' : '')}" placeholder="${v ? '' : 'wird geladen …'}" autocomplete="off" autocapitalize="characters"></label>`).join('')}</div>
    <label class="haken"><input type="checkbox" id="mkan-${id}" checked><span>In die Seriennummernliste eintragen</span></label>
    <label class="serien-feld" style="max-width:260px">Rechnungsnummer (optional)<input type="text" id="re-${id}" value="${medienEsc(b.rechnungsnr || '')}" autocomplete="off"></label>
  </div>`;
}
async function serienLaden(nr, anzahl) {
  try {
    const r = await schnittstelle('seriennummern', { anzahl });
    serienVorschlaege[nr] = r.nummern;
    (r.nummern || []).forEach((n, i) => { const el = document.getElementById('mk-' + nr + '-' + i); if (el && !el.value) el.value = n; });
  } catch (e) {
    if (e.message === 'serienliste_fehlt' || e.message === 'unbekannte_aktion') { serienAus = true; document.querySelectorAll('.serien').forEach(x => x.remove()); }
  } finally { serienLaedt[nr] = false; }
}
// { seriennummern, rechnungsnr } aus den Feldern; null = Eingabe fehlerhaft (Meldung ist schon da)
function serienAusFormular(nr) {
  const box = document.getElementById('serien-' + nr);
  if (!box) return {};
  const re = (document.getElementById('re-' + nr) || {}).value || '';
  if (!document.getElementById('mkan-' + nr).checked) return { rechnungsnr: re.trim() };
  const l = [...box.querySelectorAll('input[id^="mk-"]')].map(x => x.value.trim().toUpperCase());
  if (l.some(x => !/^MK-\d{4}-\d{3,}$/.test(x))) { showStatus('Bitte bei jeder Krone eine MK-Nummer eintragen (z. B. MK-2026-310) oder den Haken „In die Seriennummernliste eintragen“ entfernen.', 'error'); return null; }
  if (new Set(l).size !== l.length) { showStatus('Eine MK-Nummer steht doppelt.', 'error'); return null; }
  return { seriennummern: l, rechnungsnr: re.trim() };
}
// Nummer schon vergeben: freie Nummern einsetzen und Bescheid geben
function serienFehler(nr, e) {
  if (e.message !== 'seriennummer_vergeben') return false;
  const v = (e.daten && e.daten.vorschlag) || [];
  serienVorschlaege[nr] = v;
  v.forEach((n, i) => { const el = document.getElementById('mk-' + nr + '-' + i); if (el) el.value = n; });
  showStatus('Diese MK-Nummer ist schon vergeben. Ich habe die nächsten freien eingesetzt, bitte prüfen und nochmal klicken.', 'error');
  return true;
}
async function uebergebenKlick(nr) {
  const serien = serienAusFormular(nr);
  if (serien === null) return;
  const ok = await statusSpeichern(nr, 'Übergeben', serien);
  if (ok) serienVorschlaege = {};
}
// Rechnungsnummer nachtragen (auch in Saras Seriennummernliste)
async function rechnungKlick(nr) {
  const b = bestellungNachNr(nr);
  const re = (document.getElementById('re2-' + nr) || {}).value || '';
  showStatus('Wird gespeichert …', 'loading');
  try {
    const r = await schnittstelle('rechnung', { nr, zeile: b.zeile, rechnungsnr: re.trim() });
    bestellOffen[nr] = true;
    bestellungErsetzen(r.bestellung);
    showStatus('Rechnungsnummer gespeichert ✓' + (r.inListe ? ' Auch in der Seriennummernliste.' : ''));
  } catch (e) { showStatus(apiFehlerText(e), 'error'); }
}
async function textKopieren(t, meldung) {
  try { await navigator.clipboard.writeText(t); showStatus(meldung); } catch (e) { showStatus('Kopieren ging nicht. Bitte von Hand markieren.', 'error'); }
}

// ---------- Bestellung von Hand (Etsy, Amazon, Markt, …) ----------
let formular = null;
const heuteIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function neuePosition() {
  const v = kronenListe()[0];
  return { variante: v, farbe: MEDIEN_VARIANTEN[v].farben[0], groesse: groessenFuer(v)[0], pets: 3, pers: '', preis: null };
}
function positionsPreis(p) {
  if (p.variante === SONSTIGES) return 0;
  const basis = (currentPrices[p.variante] || {})[p.groesse] || 0;
  const auf = isZahlVariante(p.variante) && p.pets !== 3 ? ((currentPrices[AUFPREIS_KEY] || {})[p.pets + ' Pets'] || 0) : 0;
  return Math.round((basis + auf) * 100) / 100;
}
function formularOeffnen() {
  formular = { kanal: 'Etsy', kiste: kisteFuerKanal('Etsy'), datum: heuteIso(), zahlung: 'Etsy', status: 'Neu', kunde: '', email: '', adresse: '', notiz: '', positionen: [neuePosition()],
    plattformNr: '', direkt: false, sendung: '', mk: [], mkEintragen: true, rechnungsnr: '' };
  renderFormular();
  document.getElementById('bestFormular').scrollIntoView({ block: 'start' });
}
function formularSchliessen() { formular = null; renderFormular(); }
function formularFeld(k, v) {
  formular[k] = v;
  if (k === 'kanal') {
    formular.zahlung = ZAHLART_JE_KANAL[v] || formular.zahlung;
    formular.status = v === 'Markt' ? 'Übergeben' : 'Neu';
    formular.kiste = kisteFuerKanal(v);
    renderFormular();
  }
}
function positionFeld(i, k, v) {
  const p = formular.positionen[i];
  p[k] = k === 'pets' ? +v : k === 'preis' ? (v === '' ? null : parseFloat(String(v).replace(',', '.'))) : v;
  if (k === 'variante' && v === SONSTIGES) { p.farbe = ''; p.groesse = ''; p.pets = 3; p.preis = null; p.bezeichnung = p.bezeichnung || ''; }
  else if (k === 'variante') { p.farbe = MEDIEN_VARIANTEN[v].farben[0]; p.groesse = groessenFuer(v)[0]; p.pets = 3; p.preis = null; }
  if (k === 'groesse' || k === 'pets') p.preis = null;                 // Preis neu aus der Preisliste
  renderFormular();
}
function renderFormular() {
  const box = document.getElementById('bestFormular');
  if (!box) return;
  if (!formular) { box.innerHTML = ''; return; }
  const f = formular;
  const opt = (liste, wert) => liste.map(x => `<option ${x === wert ? 'selected' : ''}>${medienEsc(x)}</option>`).join('');
  const preis = p => f.kanal === 'Spende' ? 0 : p.preis != null && !isNaN(p.preis) ? p.preis : positionsPreis(p);
  const summe = f.positionen.reduce((n, p) => n + preis(p), 0);
  box.innerHTML = `<div class="card bf">
    <div class="card-title">Bestellung von Hand</div>
    <div class="card-sub">Für Verkäufe über Etsy, Amazon oder auf dem Markt. Sie landen in derselben Tabelle wie die Webshop-Bestellungen.</div>
    <div class="bf-grid">
      <div><label for="bfKanal">Kanal</label><select id="bfKanal" onchange="formularFeld('kanal', this.value)">${opt(KANAELE, f.kanal)}</select></div>
      <div><label for="bfDatum">Datum</label><input id="bfDatum" type="date" value="${f.datum}" onchange="formularFeld('datum', this.value)"></div>
      ${f.kanal === 'Etsy' || f.kanal === 'Amazon' ? `<div class="voll"><label for="bfPlattformNr">Bestellnummer bei ${medienEsc(f.kanal)}</label>
        <input id="bfPlattformNr" type="text" value="${medienEsc(f.plattformNr)}" oninput="formular.plattformNr=this.value" placeholder="${f.kanal === 'Amazon' ? 'z. B. 302-1234567-1234567' : 'z. B. 3456789012'}"></div>` : ''}
      <div class="voll"><label>Kronen</label>
        ${f.positionen.map((p, i) => p.variante === SONSTIGES ? `<div class="bf-pos">
          <div><label>Krone</label><select onchange="positionFeld(${i}, 'variante', this.value)">${opt(kronenListe().concat([SONSTIGES]), p.variante)}</select></div>
          <div style="grid-column:span 4"><label>Bezeichnung</label><input type="text" maxlength="60" value="${medienEsc(p.bezeichnung || '')}" placeholder="z. B. Zahlen-Set 1–9 oder Halloween-Sonderanfertigung" oninput="formular.positionen[${i}].bezeichnung=this.value"></div>
          <div><label>Preis €</label><input type="number" step="0.01" min="0" value="${preis(p)}" ${f.kanal === 'Spende' ? 'disabled title="Spende: 0 €"' : ''} onchange="positionFeld(${i}, 'preis', this.value)"></div>
          ${f.positionen.length > 1 ? `<button class="x" title="Entfernen" onclick="formular.positionen.splice(${i},1);renderFormular()">✕</button>` : '<span></span>'}
        </div>` : `<div class="bf-pos">
          <div><label>Krone</label><select onchange="positionFeld(${i}, 'variante', this.value)">${opt(kronenListe().concat([SONSTIGES]), p.variante)}</select></div>
          <div><label>Farbe</label><select onchange="positionFeld(${i}, 'farbe', this.value)">${opt(MEDIEN_VARIANTEN[p.variante].farben, p.farbe)}</select></div>
          <div><label>Größe</label><select onchange="positionFeld(${i}, 'groesse', this.value)">${opt(groessenFuer(p.variante), p.groesse)}</select></div>
          <div><label>Pets</label>${isZahlVariante(p.variante)
            ? `<select onchange="positionFeld(${i}, 'pets', this.value)">${[3, 6, 9].map(n => `<option value="${n}" ${n === p.pets ? 'selected' : ''}>${n}</option>`).join('')}</select>`
            : '<select disabled><option>–</option></select>'}</div>
          <div><label>${isZahlVariante(p.variante) ? 'Zahlen' : 'Name'}</label><input type="text" maxlength="20" value="${medienEsc(p.pers)}" placeholder="${isZahlVariante(p.variante) ? '1 2 3' : 'ohne Namen'}" oninput="formular.positionen[${i}].pers=this.value"></div>
          <div><label>Preis €</label><input type="number" step="0.01" min="0" value="${preis(p)}" ${f.kanal === 'Spende' ? 'disabled title="Spende: 0 €"' : ''} onchange="positionFeld(${i}, 'preis', this.value)"></div>
          ${f.positionen.length > 1 ? `<button class="x" title="Krone entfernen" onclick="formular.positionen.splice(${i},1);renderFormular()">✕</button>` : '<span></span>'}
        </div>`).join('')}
        <button class="btn btn-teal btn-sm" onclick="formular.positionen.push(neuePosition());formular.direkt ? formularDirekt(true) : renderFormular()">+ weitere Krone</button>
      </div>
      <div><label for="bfKunde">${f.kanal === 'Spende' ? 'Beschenkt / gesponsert an' : 'Kundenname'}</label><input id="bfKunde" type="text" value="${medienEsc(f.kunde)}" oninput="formular.kunde=this.value" placeholder="${f.kanal === 'Markt' ? 'optional' : ''}"></div>
      <div><label for="bfEmail">E-Mail</label><input id="bfEmail" type="email" value="${medienEsc(f.email)}" oninput="formular.email=this.value" placeholder="optional"></div>
      <div class="voll"><label for="bfAdresse">Lieferadresse</label><textarea id="bfAdresse" oninput="formular.adresse=this.value" placeholder="${f.kanal === 'Markt' ? 'bei Übergabe auf dem Markt nicht nötig' : 'Straße, PLZ Ort'}">${medienEsc(f.adresse)}</textarea></div>
      <div><label for="bfZahlung">Zahlung</label><select id="bfZahlung" onchange="formularFeld('zahlung', this.value)">${opt(ZAHLARTEN, f.zahlung)}</select></div>
      ${f.direkt ? '' : `<div><label for="bfStatus">Status</label><select id="bfStatus" onchange="formularFeld('status', this.value)">${opt(STATUS_LISTE.filter(x => x !== 'Storniert'), f.status)}</select></div>`}
      <div class="voll"><label for="bfKiste">Vom Lager abbuchen</label><select id="bfKiste" onchange="formularFeld('kiste', this.value)">
        ${lagerKisten().map(k => `<option value="${medienEsc(k)}" ${k === f.kiste ? 'selected' : ''}>aus Kiste ${medienEsc(k)}</option>`).join('')}
        <option value="" ${!f.kiste ? 'selected' : ''}>nicht vom Lager (auf Bestellung genäht)</option></select></div>
      <div class="voll"><label for="bfNotiz">Notiz</label><input id="bfNotiz" type="text" value="${medienEsc(f.notiz)}" oninput="formular.notiz=this.value" placeholder="${f.kanal === 'Spende' ? 'z. B. Tombola Tierheim Bruchsal, Gewinnspiel Instagram' : 'z. B. Weihnachtsmarkt Bretten'}"></div>
    </div>
    <div class="bf-summe"><span class="leise" style="font-family:var(--f-sans);font-size:13px;margin-right:8px">Summe</span><span id="bfSumme">${euro(summe)}</span></div>
    <label class="haken" style="margin-top:14px"><input type="checkbox" id="bfDirekt" ${f.direkt ? 'checked' : ''} onchange="formularDirekt(this.checked)">
      <span><b>${f.kanal === 'Markt' ? 'Schon übergeben' : f.kanal === 'Spende' ? 'Schon verschenkt' : 'Schon verschickt'}</b> – gleich ${f.kanal === 'Markt' ? 'als übergeben' : f.kanal === 'Spende' ? 'als erledigt (mit Sendungsnummer: versendet, sonst: übergeben)' : 'als versendet'} speichern, mit MK-Nummern</span></label>
    ${f.direkt ? `<div class="versand-box">
      ${f.kanal === 'Markt' ? '' : `<label class="titel" for="bfSendung">DHL-Sendungsnummer</label>
      <input type="text" id="bfSendung" value="${medienEsc(f.sendung)}" oninput="formular.sendung=this.value" placeholder="optional" autocomplete="off" autocapitalize="characters">`}
      ${serienAus ? '' : `<div class="serien"><label class="titel">MK-Nummern für den Beileger</label>
        <div class="serien-felder">${f.positionen.map((p, i) => `<label class="serien-feld">${medienEsc(p.variante)}${p.pers ? ' „' + medienEsc(p.pers) + '“' : ''}
          <input type="text" id="bfMk-${i}" value="${medienEsc(f.mk[i] || '')}" placeholder="${f.mk.length ? '' : 'wird geladen …'}" oninput="formular.mk[${i}]=this.value" autocomplete="off" autocapitalize="characters"></label>`).join('')}</div>
        <label class="haken"><input type="checkbox" id="bfMkAn" ${f.mkEintragen ? 'checked' : ''} onchange="formular.mkEintragen=this.checked"><span>In die Seriennummernliste eintragen</span></label></div>`}
      <label class="serien-feld" style="max-width:260px">Rechnungsnummer (optional)<input type="text" id="bfRechnung" value="${medienEsc(f.rechnungsnr)}" oninput="formular.rechnungsnr=this.value" autocomplete="off"></label>
    </div>` : ''}
    <div class="btn-row"><button class="btn btn-primary" id="bfSpeichern" onclick="formularSpeichern()">${f.direkt ? (f.kanal === 'Markt' ? 'Speichern als übergeben' : f.kanal === 'Spende' ? 'Speichern als verschenkt' : 'Speichern als versendet') : 'Bestellung speichern'}</button>
      <button class="btn btn-outline" onclick="formularSchliessen()">Abbrechen</button></div>
  </div>`;
}
// „Schon verschickt“: MK-Nummern für alle Kronen vorschlagen
async function formularDirekt(an) {
  formular.direkt = an;
  renderFormular();
  if (!an || serienAus) return;
  try {
    const r = await schnittstelle('seriennummern', { anzahl: formular.positionen.length });
    if (!formular || !formular.direkt) return;
    formular.mk = r.nummern.slice(0, formular.positionen.length);
    renderFormular();
  } catch (e) {
    if (e.message === 'serienliste_fehlt' || e.message === 'unbekannte_aktion') { serienAus = true; renderFormular(); }
  }
}
async function formularSpeichern() {
  const f = formular;
  const preis = p => f.kanal === 'Spende' ? 0 : p.preis != null && !isNaN(p.preis) ? p.preis : positionsPreis(p);
  if (f.kanal !== 'Markt' && !f.kunde.trim()) { showStatus('Bitte den Kundennamen eintragen.', 'error'); return; }
  const [jj, mm, tt] = (f.datum || heuteIso()).split('-');
  const daten = {
    kanal: f.kanal, kiste: f.kiste || '', datum: tt + '.' + mm + '.' + jj, zahlung: f.zahlung, status: f.status,
    kunde: f.kunde.trim(), email: f.email.trim(), adresse: f.adresse.trim().replace(/\s*\n\s*/g, ', '), notiz: f.notiz.trim(),
    positionen: f.positionen.map(p => p.variante === SONSTIGES ? { variante: (p.bezeichnung || '').trim() || 'Sonstiges', farbe: '', groesse: '', pers: '', sku: '' } : ({ variante: p.variante, farbe: p.farbe, sku: artikelnummer(p.variante, p.farbe, p.groesse),
      groesse: p.groesse + (isZahlVariante(p.variante) ? ' + ' + p.pets + ' Pets' : ''),
      pers: isZahlVariante(p.variante) && p.pers.trim() ? 'Zahlen ' + p.pers.trim() : p.pers.trim() })),
    preis: Math.round(f.positionen.reduce((n, p) => n + preis(p), 0) * 100) / 100,
    plattformNr: (f.plattformNr || '').trim()
  };
  const ohneText = f.positionen.find(p => p.variante === SONSTIGES && !(p.bezeichnung || '').trim());
  if (ohneText) { showStatus('Bitte bei „Sonstiges“ eine Bezeichnung eintragen.', 'error'); return; }
  if (f.direkt) {
    const sendung = (f.sendung || '').replace(/\s+/g, '').toUpperCase();
    if (sendung && !/^[A-Z0-9]{8,40}$/.test(sendung)) { showStatus('Die Sendungsnummer sieht nicht richtig aus. Bitte prüfen.', 'error'); return; }
    Object.assign(daten, { direkt: true, sendungsnummer: sendung, rechnungsnr: (f.rechnungsnr || '').trim() });
    if (!serienAus && f.mkEintragen) {
      const l = f.positionen.map((p, i) => String(f.mk[i] || '').trim().toUpperCase());
      if (l.some(x => !/^MK-\d{4}-\d{3,}$/.test(x))) { showStatus('Bitte bei jeder Krone eine MK-Nummer eintragen (z. B. MK-2026-310) oder den Haken „In die Seriennummernliste eintragen“ entfernen.', 'error'); return; }
      if (new Set(l).size !== l.length) { showStatus('Eine MK-Nummer steht doppelt.', 'error'); return; }
      daten.seriennummern = l;
    }
  }
  const knopf = document.getElementById('bfSpeichern');
  if (knopf) knopf.disabled = true;
  showStatus('Bestellung wird gespeichert …', 'loading');
  try {
    const r = await schnittstelle('anlegen', daten);
    formular = null; renderFormular();
    bestellOffen[r.bestellung.nr] = true;
    bestellFilter = 'alle';
    bestellungErsetzen(r.bestellung);
    serienVorschlaege = {};
    showStatus('Bestellung ' + r.bestellung.nr + ' gespeichert ✓' + (r.bestellung.seriennummern ? ' MK-Nummern: ' + r.bestellung.seriennummern : '')
      + (r.lagerFehler ? ' Das Lager konnte nicht gebucht werden.' : ''), r.lagerFehler ? 'error' : 'success');
  } catch (e) {
    if (knopf) knopf.disabled = false;
    if (e.message === 'seriennummer_vergeben') {
      formular.mk = (e.daten && e.daten.vorschlag) || [];
      renderFormular();
      showStatus('Diese MK-Nummer ist schon vergeben. Ich habe die nächsten freien eingesetzt, bitte prüfen und nochmal speichern.', 'error');
      return;
    }
    showStatus(e.message === 'ungueltige_sendungsnummer' ? 'Die Sendungsnummer sieht nicht richtig aus. Bitte prüfen.' : apiFehlerText(e), 'error');
  }
}
