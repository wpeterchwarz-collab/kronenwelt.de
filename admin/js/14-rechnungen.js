// Kronenwelt Admin – Rechnungen: schreiben, festschreiben, drucken / als PDF speichern, stornieren (ersetzt Papierkram)
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// RECHNUNGEN
// Die Schnittstelle vergibt die Nummer (ab R-01272) und schreibt die Rechnung ins Blatt „Rechnungen“. Danach wird
// sie nie mehr geändert. Korrigieren = stornieren (Stornorechnung <Nr>-S) und eine neue Rechnung schreiben.
// Gedruckt wird hier im Browser aus genau den gespeicherten Daten; „Als PDF speichern“ im Druckfenster ergibt das PDF.
// ============================================================
let rechnungen = null;                                   // Liste von der Schnittstelle (neueste zuerst)
let rechnungInfo = { naechste: '', absender: {}, kleinbetrag: 250 };
let rechnungFehler = '';
let entwurf = null;                                      // Rechnung in Arbeit (noch ohne Nummer)
let rechnungLaeuft = false;
let rechnungFilter = { jahr: String(new Date().getFullYear()), status: '', suche: '' };
let zahlungFormFuer = '';                                // Rechnungsnummer, bei der „Als bezahlt markieren“ offen ist
let menueFuer = '';
let papierkram = [];                                     // alte Rechnungen aus Papierkram (nur nachschlagen)
let papierkramOrdner = false;                            // Drive-Ordner mit den Original-PDFs eingetragen?
let listeMax = 200;                                      // so viele Zeilen zeigen, „Weitere anzeigen“ für mehr
const alleRechnungen = () => (rechnungen || []).concat(papierkram);                                      // Rechnungsnummer, deren ⋮-Menü offen ist

const ZAHLUNGSARTEN = ['Überweisung', 'PayPal', 'Etsy Payments', 'Amazon', 'Bar', 'Karte (SumUp)'];
const RECHNUNG_STATUS = ['Offen', 'Überfällig', 'Bezahlt', 'Storniert'];

const RECHNUNG_19 = 'Gemäß § 19 UStG wird aufgrund der Kleinunternehmerregelung keine Umsatzsteuer erhoben.';
const RECHNUNG_LOGO = `<svg viewBox="0 0 200 200" width="110" height="110" xmlns="http://www.w3.org/2000/svg" aria-label="Sternenstaub Handmade">
  <defs><path id="reBogenOben" d="M 32,104 A 68,68 0 0 1 168,104"/><path id="reBogenUnten" d="M 52,104 A 48,48 0 0 0 148,104"/></defs>
  <circle cx="100" cy="100" r="94" fill="none" stroke="#9b8f88" stroke-width="1.2"/>
  <text font-family="Arial, Helvetica, sans-serif" font-size="17" letter-spacing="3.5" fill="#6f6560"><textPath href="#reBogenOben" startOffset="50%" text-anchor="middle">STERNENSTAUB</textPath></text>
  <polygon points="100.0,64.0 109.4,91.1 138.0,91.6 115.2,108.9 123.5,136.4 100.0,120.0 76.5,136.4 84.8,108.9 62.0,91.6 90.6,91.1" fill="#d6c0b5"/>
  <text font-family="Arial, Helvetica, sans-serif" font-size="8" letter-spacing="2.5" fill="#6f6560"><textPath href="#reBogenUnten" startOffset="50%" text-anchor="middle">HANDMADE</textPath></text>
</svg>`;

const rEsc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rBetrag = x => (Math.round((x || 0) * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rMenge = x => (Math.round((x || 0) * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rHeute = () => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear(); };
const rDatumPlus = (t, tage) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t || ''); if (!m) return '';
  const d = new Date(+m[3], +m[2] - 1, +m[1] + tage);
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
};
const rSumme = pos => Math.round(pos.reduce((s, p) => s + Math.round((parseFloat(p.menge) || 0) * (parseFloat(p.preis) || 0) * 100), 0)) / 100;
const isoZuDatum = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; };
const datumZuIso = d => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };

// Zahlungsstatus wie in Papierkram: Storno-Belege, stornierte, bezahlte, überfällige und offene Rechnungen
function rStatus(r) {
  if (r.art === 'Storno') return 'Storno';
  if (r.storniertDurch) return 'Storniert';
  if (r.bezahltAm) return 'Bezahlt';
  const f = datumZuIso(r.faellig || rDatumPlus(r.datum, 14));
  return f && f < datumZuIso(rHeute()) ? 'Überfällig' : 'Offen';
}
const rStatusBadge = st => `<span class="re-status re-st-${({ 'Überfällig': 'ueberfaellig' })[st] || st.toLowerCase()}">${medienEsc(st)}</span>`;

async function ladeRechnungen(neu) {
  if (!apiKonfiguriert()) { renderRechnungen(); return; }
  if (rechnungen && !neu) { renderRechnungen(); return; }
  try {
    const r = await schnittstelle('rechnungen');
    rechnungen = r.rechnungen || [];
    papierkramSetzen(r.papierkram);
    papierkramOrdner = !!r.papierkramOrdner;
    rechnungInfo = { naechste: r.naechste, absender: r.absender || {}, kleinbetrag: r.kleinbetrag || 250 };
    rechnungFehler = '';
  } catch (e) {
    rechnungFehler = e.message === 'unbekannte_aktion' ? 'Das Apps Script kennt Rechnungen noch nicht. Bitte Code.gs ab Version 1.12 bereitstellen.' : apiFehlerText(e);
  }
  renderRechnungen();
}

// ---------- Entwurf aus einer Bestellung ----------
function rechnungEmpfaenger(b) {
  const zeilen = String(b.adresse || '').split(/\n|,\s*/).map(x => x.trim()).filter(Boolean);
  if (zeilen.length && /^(DE|Deutschland|Germany)$/i.test(zeilen[zeilen.length - 1])) zeilen.pop();
  if (b.kunde && (!zeilen.length || zeilen[0].toLowerCase() !== b.kunde.trim().toLowerCase())) zeilen.unshift(b.kunde.trim());
  return zeilen.join('\n');
}
function rechnungBetreff(b) {
  if (b.kanal === 'Etsy' && b.plattformNr) return 'Nr. ' + b.plattformNr + ' über Etsy' + (b.shop ? ' (' + b.shop + ')' : '');
  if (b.kanal === 'Amazon' && b.plattformNr) return 'Bestellnummer: # ' + b.plattformNr;
  return 'Bestellung ' + b.nr;
}
function rechnungZahlungstext(b) {
  const am = b.datum ? ' am ' + b.datum : '';
  if (b.kanal === 'Etsy') return 'Bezahlt über Etsy Payments' + am;
  if (b.kanal === 'Amazon') return 'Bezahlt über Amazon' + am;
  if (b.kanal === 'Webshop') return 'Bezahlt per ' + (b.zahlung || 'PayPal') + am;
  return b.zahlung ? 'Bezahlt (' + b.zahlung + ')' + am : '';
}
// Wie wurde die Bestellung bezahlt? (leer = unbekannt, dann bleibt die Rechnung offen)
function rechnungZahlungsart(b) {
  if (b.kanal === 'Etsy') return 'Etsy Payments';
  if (b.kanal === 'Amazon') return 'Amazon';
  if (b.kanal === 'Webshop') return b.zahlung || 'PayPal';
  return b.zahlung || '';
}
function rechnungPositionenAus(b) {
  const pos = positionen(b);
  const liste = pos.map(p => {
    const teile = [p.farbe, p.groesse ? 'Größe ' + p.groesse : ''].filter(Boolean).join(', ');
    let text = (p.variante && p.variante !== SONSTIGES ? 'Handgemachte Hundekrone ' + p.variante : 'Handgemachter Artikel') + (teile ? ', ' + teile : '');
    if (p.pers && p.pers !== 'ohne Namen') text += '\nPersonalisierung: ' + p.pers;
    const katalog = typeof currentPrices !== 'undefined' ? ((currentPrices[p.variante] || {})[p.groesse] || 0) : 0;
    return { text, menge: 1, preis: pos.length === 1 ? b.preis : katalog };
  });
  const diff = Math.round((b.preis - rSumme(liste)) * 100) / 100;
  if (Math.abs(diff) >= 0.01) liste.push({ text: diff > 0 ? 'Versand / Aufpreis' : 'Rabatt', menge: 1, preis: diff });
  return liste;
}
function rechnungAusBestellung(nr) {
  const b = (bestellungen || []).find(x => x.nr === nr);
  if (!b) return;
  entwurf = {
    bestellnr: b.nr, bestellPreis: b.preis, datum: rHeute(), leistungsdatum: b.versendetAm || b.datum || rHeute(),
    betreff: rechnungBetreff(b), empfaenger: rechnungEmpfaenger(b), positionen: rechnungPositionenAus(b),
    hinweis: rechnungZahlungstext(b), seriennummern: b.seriennummern || '', zahlungsart: rechnungZahlungsart(b)
  };
  entwurf.faellig = rDatumPlus(entwurf.datum, 14);
  entwurf.bezahltAm = entwurf.zahlungsart ? (b.datum || rHeute()) : '';
  geheZu('rechnungen');
}
function rechnungNeu() {
  entwurf = { bestellnr: '', bestellPreis: null, datum: rHeute(), leistungsdatum: rHeute(), betreff: '', empfaenger: '',
    positionen: [{ text: '', menge: 1, preis: 0 }], hinweis: 'Bitte überweisen Sie den Betrag bis zum ' + rDatumPlus(rHeute(), 14) + ' auf das unten angegebene Konto.', seriennummern: '',
    faellig: rDatumPlus(rHeute(), 14), bezahltAm: '', zahlungsart: '' };
  renderRechnungen();
  const f = document.getElementById('reEmpfaenger'); if (f) f.focus();
}
// Fällig-Datum ändern; steht noch der Standard-Überweisungstext im Hinweis, zieht das Datum dort mit
function entwurfFaellig(iso) {
  const neu = isoZuDatum(iso);
  const alt = 'Bitte überweisen Sie den Betrag bis zum ' + entwurf.faellig + ' ';
  if (neu && entwurf.hinweis.startsWith(alt)) {
    entwurf.hinweis = 'Bitte überweisen Sie den Betrag bis zum ' + neu + ' ' + entwurf.hinweis.slice(alt.length);
    const h = document.getElementById('reHinweis'); if (h) h.value = entwurf.hinweis;
  }
  entwurf.faellig = neu;
}
function entwurfZahlung(art) {
  entwurf.zahlungsart = art;
  entwurf.bezahltAm = art ? (entwurf.bezahltAm || rHeute()) : '';
  renderRechnungen();
}
function rechnungVerwerfen() {
  if (entwurf && !confirm('Entwurf verwerfen?')) return;
  entwurf = null; renderRechnungen();
}

// ---------- Ansicht ----------
function renderRechnungen() {
  const box = document.getElementById('reInhalt');
  if (!box) return;
  const knopf = document.getElementById('btnNeueRechnung');
  if (knopf) knopf.style.display = apiKonfiguriert() && !entwurf ? '' : 'none';
  if (!apiKonfiguriert()) { box.innerHTML = '<div class="card leise">Zuerst unter „Einstellungen“ die Verbindung zur Google-Tabelle einrichten.</div>'; return; }
  if (rechnungFehler) { box.innerHTML = `<div class="card leise">⚠ ${medienEsc(rechnungFehler)}</div>`; return; }
  if (!rechnungen) { box.innerHTML = '<div class="card leise">Wird geladen …</div>'; return; }
  box.innerHTML = (entwurf ? entwurfHtml() : '') + listeHtml();
  if (entwurf) entwurfSummeZeigen();
}

function entwurfHtml() {
  const e = entwurf;
  const feld = (id, label, wert, typ, extra) => `<label class="re-feld">${label}<input type="${typ || 'text'}" id="${id}" value="${medienEsc(wert)}" ${extra || ''}></label>`;
  return `<div class="card re-entwurf" id="reEntwurf">
    <div class="card-title">Neue Rechnung</div>
    <div class="leise" style="margin:-4px 0 10px">Bekommt beim Festschreiben die Nummer ${medienEsc(rechnungInfo.naechste || '')}.</div>
    ${e.bestellnr ? `<div class="leise" style="margin-bottom:10px">Zur Bestellung ${medienEsc(e.bestellnr)} · ${euro(e.bestellPreis)}</div>` : ''}
    <div class="re-raster">
      <label class="re-feld re-breit">Empfänger (Name und Anschrift, je Zeile)
        <textarea id="reEmpfaenger" rows="4" oninput="entwurf.empfaenger=this.value;entwurfSummeZeigen()">${medienEsc(e.empfaenger)}</textarea></label>
      ${feld('reBetreff', 'Betreff', e.betreff, 'text', 'oninput="entwurf.betreff=this.value"')}
      ${feld('reDatum', 'Rechnungsdatum', datumZuIso(e.datum), 'date', 'onchange="entwurf.datum=isoZuDatum(this.value)"')}
      ${feld('reLeistung', 'Leistungsdatum', datumZuIso(e.leistungsdatum), 'date', 'onchange="entwurf.leistungsdatum=isoZuDatum(this.value)"')}
      ${feld('reFaellig', 'Fällig am', datumZuIso(e.faellig), 'date', 'onchange="entwurfFaellig(this.value)"')}
      <label class="re-feld">Zahlung<select id="reZahlung" onchange="entwurfZahlung(this.value)">
        <option value="">Noch offen</option>${zahlungsOptionen(e.zahlungsart)}</select></label>
      ${e.zahlungsart ? feld('reBezahltAm', 'Bezahlt am', datumZuIso(e.bezahltAm), 'date', 'onchange="entwurf.bezahltAm=isoZuDatum(this.value)"') : ''}
    </div>
    <table class="re-pos">
      <thead><tr><th>Beschreibung</th><th>Menge</th><th>Einzelpreis €</th><th>Gesamt</th><th></th></tr></thead>
      <tbody>${e.positionen.map((p, i) => `<tr>
        <td><textarea rows="2" placeholder="Beschreibung" aria-label="Beschreibung ${i + 1}" oninput="entwurf.positionen[${i}].text=this.value">${medienEsc(p.text)}</textarea></td>
        <td><input type="number" step="1" min="1" title="Menge" aria-label="Menge ${i + 1}" value="${p.menge}" oninput="entwurf.positionen[${i}].menge=parseFloat(this.value)||0;entwurfSummeZeigen()"></td>
        <td><input type="number" step="0.01" title="Einzelpreis in €" placeholder="Preis €" aria-label="Preis ${i + 1}" value="${p.preis}" oninput="entwurf.positionen[${i}].preis=parseFloat(this.value)||0;entwurfSummeZeigen()"></td>
        <td class="re-zahl" id="reZeile${i}">${rBetrag((p.menge || 0) * (p.preis || 0))}</td>
        <td>${e.positionen.length > 1 ? `<button class="btn btn-outline btn-sm" title="Position entfernen" aria-label="Position ${i + 1} entfernen" onclick="entwurf.positionen.splice(${i},1);renderRechnungen()">✕</button>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div class="btn-row" style="margin:8px 0 14px"><button class="btn btn-outline btn-sm" onclick="entwurf.positionen.push({text:'',menge:1,preis:0});renderRechnungen()">+ Position</button>
      <div class="re-summe">Gesamt <b id="reSumme"></b></div></div>
    <div id="reHinweise" class="leise" style="margin-bottom:10px"></div>
    <div class="re-raster">
      <label class="re-feld re-breit">Hinweis (z. B. wie bezahlt wurde)<textarea id="reHinweis" rows="2" oninput="entwurf.hinweis=this.value">${medienEsc(e.hinweis)}</textarea></label>
      ${feld('reSerien', 'MK-Nummern (optional)', e.seriennummern, 'text', 'oninput="entwurf.seriennummern=this.value"')}
    </div>
    <div class="leise" style="font-size:12px;margin:6px 0 12px">Auf jeder Rechnung steht automatisch: „${RECHNUNG_19}“</div>
    <div class="btn-row">
      <button class="btn btn-outline" onclick="rechnungVorschau()">Vorschau</button>
      <button class="btn btn-primary" id="btnFestschreiben" onclick="rechnungFestschreiben()">Rechnung festschreiben</button>
      <button class="btn btn-outline" onclick="rechnungVerwerfen()">Verwerfen</button>
    </div>
  </div>`;
}

function entwurfSummeZeigen() {
  if (!entwurf) return;
  const s = rSumme(entwurf.positionen);
  const el = document.getElementById('reSumme'); if (el) el.textContent = '€ ' + rBetrag(s);
  entwurf.positionen.forEach((p, i) => { const z = document.getElementById('reZeile' + i); if (z) z.textContent = rBetrag((p.menge || 0) * (p.preis || 0)); });
  const h = [];
  if (entwurf.bestellPreis != null && Math.abs(s - entwurf.bestellPreis) >= 0.01) h.push('⚠ Summe weicht vom Bestellbetrag (' + euro(entwurf.bestellPreis) + ') ab.');
  const zeilen = String(entwurf.empfaenger || '').split('\n').filter(x => x.trim()).length;
  if (s > rechnungInfo.kleinbetrag && zeilen < 3) h.push('Über ' + rechnungInfo.kleinbetrag + ' € braucht die Rechnung Name und vollständige Anschrift des Empfängers.');
  const box = document.getElementById('reHinweise'); if (box) box.textContent = h.join(' ');
}

function zahlungsOptionen(gewaehlt) {
  const liste = ZAHLUNGSARTEN.indexOf(gewaehlt) < 0 && gewaehlt ? ZAHLUNGSARTEN.concat([gewaehlt]) : ZAHLUNGSARTEN;
  return liste.map(z => `<option ${z === gewaehlt ? 'selected' : ''}>${medienEsc(z)}</option>`).join('');
}

function rechnungJahre() {
  const jahre = new Set([String(new Date().getFullYear())]);
  alleRechnungen().forEach(r => { const j = String(r.datum || '').slice(6); if (j) jahre.add(j); });
  return [...jahre].sort().reverse();
}
// Jahr und Suche (ohne Status) – Grundlage für Kacheln, Reiter-Zahlen und Liste
function rechnungenImJahr() {
  const f = rechnungFilter, q = f.suche.trim().toLowerCase();
  return alleRechnungen().filter(r => {
    if (f.jahr && String(r.datum || '').slice(6) !== f.jahr) return false;
    if (q && ![r.nr, r.betreff, r.empfaenger, r.bestellnr].some(x => String(x || '').toLowerCase().includes(q))) return false;
    return true;
  });
}
const rStatusGruppe = r => { const st = rStatus(r); return st === 'Storno' ? 'Storniert' : st; };
function rechnungenGefiltert() {
  return rechnungenImJahr().filter(r => !rechnungFilter.status || rStatusGruppe(r) === rechnungFilter.status);
}
function rechnungFilterSetzen(feld, wert) {
  rechnungFilter[feld] = wert;
  menueFuer = '';
  listeMax = 200;
  if (feld === 'suche') {                                // Eingabefeld behalten (Fokus), nur Kacheln, Reiter und Liste neu
    const k = document.getElementById('reUebersicht'); if (k) k.outerHTML = uebersichtHtml();
    const l = document.getElementById('reListe'); if (l) l.outerHTML = listeZeilenHtml();
    return;
  }
  renderRechnungen();
}

function listeHtml() {
  if (!alleRechnungen().length) return `<div class="card leise">Noch keine Rechnungen hier. Die nächste bekommt die Nummer ${medienEsc(rechnungInfo.naechste || 'R-01272')}.
    ${papierkramHtml()}</div>`;
  const f = rechnungFilter;
  return `<div class="card re-karte">
    <div class="re-filter">
      <label>Jahr <select id="reFJahr" onchange="rechnungFilterSetzen('jahr', this.value)"><option value="">Alle</option>
        ${rechnungJahre().map(j => `<option ${j === f.jahr ? 'selected' : ''}>${j}</option>`).join('')}</select></label>
      <input type="search" id="reFSuche" placeholder="Suchen (Nr., Name, Betreff)" aria-label="Rechnungen durchsuchen" value="${medienEsc(f.suche)}" oninput="rechnungFilterSetzen('suche', this.value)">
    </div>
    ${uebersichtHtml()}
    ${listeZeilenHtml()}
    ${papierkramHtml()}
  </div>`;
}

// Kacheln (Offen / Überfällig / Bezahlt) und Status-Reiter mit Anzahl
function uebersichtHtml() {
  const basis = rechnungenImJahr();
  const gruppe = st => basis.filter(r => rStatusGruppe(r) === st);
  const summe = l => l.reduce((s, r) => s + (r.gesamt || 0), 0);
  const stueck = n => n + (n === 1 ? ' Rechnung' : ' Rechnungen');
  const kachel = (st, titel, cls) => { const l = gruppe(st).filter(r => r.art !== 'Storno');
    return `<button type="button" class="re-kachel ${cls}" onclick="rechnungFilterSetzen('status', '${st}')" aria-label="${titel}: € ${rBetrag(summe(l))}">
      <span class="re-kachel-titel">${titel}</span><span class="re-kachel-summe">€ ${rBetrag(summe(l))}</span><span class="re-kachel-anzahl">${stueck(l.length)}</span></button>`; };
  const reiter = (st, titel) => `<button type="button" role="tab" aria-selected="${rechnungFilter.status === st}" class="re-reiter ${rechnungFilter.status === st ? 'aktiv' : ''}"
      onclick="rechnungFilterSetzen('status', '${st}')">${titel} <span>${st ? gruppe(st).length : basis.length}</span></button>`;
  return `<div id="reUebersicht">
    <div class="re-kacheln">${kachel('Offen', 'Offen', 're-st-offen')}${kachel('Überfällig', 'Überfällig', 're-st-ueberfaellig')}${kachel('Bezahlt', 'Bezahlt' + (rechnungFilter.jahr ? ' ' + rechnungFilter.jahr : ''), 're-st-bezahlt')}</div>
    <div class="re-reiterleiste" role="tablist" aria-label="Status">${reiter('', 'Alle')}${RECHNUNG_STATUS.map(st => reiter(st, st)).join('')}</div>
  </div>`;
}

function listeZeilenHtml() {
  const gefiltert = rechnungenGefiltert();
  if (!gefiltert.length) return '<div id="reListe" class="leise" style="padding:14px 0">Keine Rechnungen für diese Auswahl.</div>';
  const liste = gefiltert.slice(0, listeMax);
  const mehr = gefiltert.length - liste.length;
  return `<div class="re-liste" id="reListe">
    <div class="re-zeile re-kopfzeile" aria-hidden="true"><div>Nr. / Betreff</div><div>Kunde</div><div>Status</div><div>Datum</div><div>Fällig am</div><div class="re-zahl">Betrag</div><div></div></div>
    ${liste.map(r => {
    const name = String(r.empfaenger || '').split('\n')[0];
    const nr = jsArg(r.nr), st = rStatus(r);
    if (r.quelle === 'Papierkram') return papierkramZeileHtml(r, nr, st, name);
    const zahlbar = st === 'Offen' || st === 'Überfällig';
    const menue = [
      zahlbar ? `<button type="button" onclick="zahlungFormZeigen(${nr})">✓ Als bezahlt markieren</button>` : '',
      st === 'Bezahlt' ? `<button type="button" onclick="rechnungBezahltKlick(${nr}, true)">↺ Zahlung zurücksetzen</button>` : '',
      `<button type="button" onclick="rechnungAnsehen(${nr})">Ansehen</button>`,
      r.art === 'Rechnung' && !r.storniertDurch ? `<button type="button" class="re-menue-rot" onclick="rechnungStornoKlick(${nr})">Stornieren</button>` : ''
    ].join('');
    return `<div class="re-zeile ${r.storniertDurch ? "storniert" : ""} re-z-${({ 'Überfällig': 'ueberfaellig' })[st] || st.toLowerCase()}" data-nr="${medienEsc(r.nr)}">
      <div class="re-nr"><b>${medienEsc(r.nr)}</b>
        <div class="leise">${r.storniertDurch ? 'storniert durch ' + medienEsc(r.storniertDurch) : medienEsc(r.betreff || '')}</div></div>
      <div class="re-kunde">${medienEsc(name)}</div>
      <div class="re-st">${rStatusBadge(st)}${st === 'Bezahlt' ? `<div class="leise re-klein">${medienEsc(r.bezahltAm)}${r.zahlungsart ? ' · ' + medienEsc(r.zahlungsart) : ''}</div>` : ''}</div>
      <div class="re-datum"><span class="re-mobil leise">Datum </span>${medienEsc(r.datum)}</div>
      <div class="re-faellig ${st === 'Überfällig' ? 're-rot' : ''}">${r.faellig && st !== 'Storniert' && st !== 'Storno' ? '<span class="re-mobil leise">fällig </span>' + medienEsc(r.faellig) : ''}</div>
      <div class="re-zahl re-betrag"><b>€ ${rBetrag(r.gesamt)}</b></div>
      <div class="re-symbole">
        <button type="button" class="re-symbol" title="Drucken / PDF" aria-label="Drucken / PDF" onclick="rechnungDrucken(${nr})">${RE_DRUCKER}</button>
        <div class="re-menue-wrap"><button type="button" class="re-symbol" title="Weitere Aktionen" aria-label="Weitere Aktionen zu ${medienEsc(r.nr)}" aria-expanded="${menueFuer === r.nr}" onclick="event.stopPropagation();menueUmschalten(${nr})">⋮</button>
          ${menueFuer === r.nr ? `<div class="re-menue" role="menu" onclick="event.stopPropagation()">${menue}</div>` : ''}</div>
      </div>
      ${zahlungFormFuer === r.nr ? `<div class="re-zahlung-form">
        <label class="re-feld">Bezahlt am<input type="date" id="reZAm" value="${datumZuIso(rHeute())}"></label>
        <label class="re-feld">Zahlungsart<select id="reZArt">${zahlungsOptionen(/Bezahlt über Etsy/.test(r.hinweis || '') ? 'Etsy Payments' : 'Überweisung')}</select></label>
        <div class="btn-row"><button class="btn btn-primary btn-sm" onclick="rechnungBezahltKlick(${nr})">Speichern</button>
          <button class="btn btn-outline btn-sm" onclick="zahlungFormZeigen('')">Abbrechen</button></div></div>` : ''}
    </div>`;
  }).join('')}
    ${mehr > 0 ? `<div class="re-mehr"><button class="btn btn-outline btn-sm" onclick="listeMax += 200; renderRechnungen()">Weitere anzeigen (${mehr} mehr)</button></div>` : ''}</div>`;
}

// Zeile einer alten Rechnung aus Papierkram: nur ansehen (Original-PDF), nichts ändern
function papierkramZeileHtml(r, nr, st, name) {
  const cls = ({ 'Überfällig': 'ueberfaellig' })[st] || st.toLowerCase();
  return `<div class="re-zeile re-papierkram ${r.storniertDurch ? 'storniert' : ''} re-z-${cls}" data-nr="${medienEsc(r.nr)}">
      <div class="re-nr"><b>${medienEsc(r.nr)}</b> <span class="re-quelle" title="aus Papierkram übernommen">Papierkram</span>
        <div class="leise">${r.storniertDurch && r.storniertDurch !== 'Papierkram' ? 'storniert durch ' + medienEsc(r.storniertDurch) : medienEsc(r.betreff || '')}</div></div>
      <div class="re-kunde">${medienEsc(name)}</div>
      <div class="re-st">${rStatusBadge(st)}${st === 'Bezahlt' ? `<div class="leise re-klein">${medienEsc(r.bezahltAm)}${r.zahlungsart ? ' · ' + medienEsc(r.zahlungsart) : ''}</div>` : ''}</div>
      <div class="re-datum"><span class="re-mobil leise">Datum </span>${medienEsc(r.datum)}</div>
      <div class="re-faellig"></div>
      <div class="re-zahl re-betrag"><b>€ ${rBetrag(r.gesamt)}</b></div>
      <div class="re-symbole">
        <button type="button" class="re-symbol" title="Original-PDF öffnen" aria-label="Original-PDF ${medienEsc(r.nr)} öffnen" onclick="papierkramPdf(${nr})">${RE_DRUCKER}</button>
        <span class="re-symbol-platz"></span>
      </div>
    </div>`;
}

// ---------- Alte Rechnungen aus Papierkram ----------
function papierkramSetzen(liste) {
  papierkram = (liste || []).map(r => Object.assign({}, r, { quelle: 'Papierkram',
    storniertDurch: r.storniertDurch || (r.status === 'Storniert' && r.art !== 'Storno' ? 'Papierkram' : ''),
    bezahltAm: r.status === 'Bezahlt' ? (r.bezahltAm || r.datum) : '' }))
    .sort((a, b) => datumZuIso(b.datum).localeCompare(datumZuIso(a.datum)) || b.nr.localeCompare(a.nr));
}

function papierkramHtml() {
  const knopf = text => `<label class="btn btn-outline btn-sm re-csv">${text}<input type="file" accept=".csv,text/csv" hidden onchange="papierkramDatei(this)"></label>`;
  if (!papierkram.length) return `<div class="re-pk leise">Ältere Rechnungen (bis R-01271) sind noch in Papierkram.
    In Papierkram unter Rechnungen mit Jahr „Alle“ auf „CSV“ klicken und die Datei hier einlesen: ${knopf('Aus Papierkram übernehmen')}</div>`;
  const nrs = papierkram.map(r => r.nr).filter(n => /^R-\d{5}$/.test(n)).sort();
  return `<div class="re-pk leise">Enthält ${papierkram.length.toLocaleString('de-DE')} Rechnungen aus Papierkram (${medienEsc(nrs[0] || '')} bis ${medienEsc(nrs[nrs.length - 1] || '')}). ${knopf('CSV neu einlesen')}
    ${papierkramOrdner ? '' : '<div>Für die Original-PDFs fehlt noch der Drive-Ordner (Skript-Eigenschaft PAPIERKRAM_ORDNER).</div>'}</div>`;
}

// CSV aus Papierkram lesen (Windows-1252 oder UTF-8, Semikolon getrennt)
function csvZeilen(text) {
  const zeilen = []; let z = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ';') { z.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      z.push(f); f = ''; if (z.some(x => x !== '')) zeilen.push(z); z = [];
    } else f += c;
  }
  z.push(f); if (z.some(x => x !== '')) zeilen.push(z);
  return zeilen;
}
function csvText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
}
function papierkramAusCsv(text) {
  const zeilen = csvZeilen(text);
  const kopf = (zeilen.shift() || []).map(k => k.trim());
  const sp = name => kopf.indexOf(name);
  const pflicht = ['Rechnungsnr.', 'Betreff', 'Kunde', 'Datum', 'Status', 'Typ', 'Brutto'];
  const fehlt = pflicht.filter(k => sp(k) < 0);
  if (fehlt.length) throw new Error('Das sieht nicht nach dem Rechnungs-Export von Papierkram aus (es fehlt: ' + fehlt.join(', ') + ').');
  const w = (z, k) => sp(k) >= 0 ? String(z[sp(k)] || '').trim() : '';
  const zahl = t => { t = String(t || '').replace(/\./g, '').replace(',', '.'); return Math.round((parseFloat(t) || 0) * 100) / 100; };
  const iso = t => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; };
  const alle = [], entwuerfe = [];
  zeilen.forEach(z => {
    const status = w(z, 'Status');
    if (status === 'Entwurf' || !/^R-\d/.test(w(z, 'Rechnungsnr.'))) { entwuerfe.push(w(z, 'Rechnungsnr.')); return; }
    const betreff = w(z, 'Betreff'), notiz = w(z, 'Notiz');
    const zahlungsart = /über Etsy|Etsy Payments/i.test(betreff + ' ' + notiz) ? 'Etsy Payments'
      : /^Bestellnummer: #/.test(betreff) ? 'Amazon' : '';
    alle.push({ nr: w(z, 'Rechnungsnr.'), art: w(z, 'Typ') === 'Stornorechnung' ? 'Storno' : 'Rechnung', datum: w(z, 'Datum'),
      faellig: w(z, 'Fälligkeitsdatum'), kunde: w(z, 'Kunde'), land: w(z, 'Land'), betreff, brutto: zahl(w(z, 'Brutto')),
      status: status === 'Storniert' ? 'Storniert' : status === 'Bezahlt' ? 'Bezahlt' : 'Offen',
      bezahltAm: status === 'Bezahlt' ? iso(w(z, 'letztes Bezahldatum')) : '', zahlungsart: status === 'Bezahlt' ? zahlungsart : '', notiz });
  });
  const nrs = new Set(alle.map(r => r.nr));
  alle.forEach(r => { if (r.status === 'Storniert' && r.art === 'Rechnung' && nrs.has(r.nr + '-S')) r.storniertDurch = r.nr + '-S'; });
  return { alle, entwuerfe };
}

async function papierkramDatei(input) {
  const datei = input.files && input.files[0];
  input.value = '';
  if (!datei || rechnungLaeuft) return;
  let daten;
  try { daten = papierkramAusCsv(csvText(new Uint8Array(await datei.arrayBuffer()))); }
  catch (e) { showStatus(e.message, 'error'); return; }
  const { alle, entwuerfe } = daten;
  if (!alle.length) { showStatus('In der Datei stehen keine Rechnungen.', 'error'); return; }
  const jahre = alle.map(r => r.datum.slice(6)).sort();
  if (!confirm(`${alle.length.toLocaleString('de-DE')} Rechnungen aus Papierkram (${jahre[0]}–${jahre[jahre.length - 1]}) übernehmen?`
    + (entwuerfe.length ? `\n\n${entwuerfe.length} Entwürfe werden übersprungen.` : '')
    + (papierkram.length ? '\n\nDie bisher übernommene Papierkram-Liste wird dabei ersetzt.' : ''))) return;
  rechnungLaeuft = true;
  showStatus('Rechnungen aus Papierkram werden übernommen …');
  try {
    const a = await schnittstelle('altrechnungenImport', { rechnungen: alle });
    papierkramSetzen(a.papierkram);
    renderRechnungen();
    showStatus(a.anzahl.toLocaleString('de-DE') + ' Rechnungen aus Papierkram übernommen ✓');
  } catch (e) {
    showStatus(e.message === 'unbekannte_aktion' ? 'Bitte zuerst Code.gs ab Version 1.13 im Apps Script bereitstellen.' : ((e.daten && e.daten.text) || apiFehlerText(e)), 'error');
  } finally { rechnungLaeuft = false; }
}

// Original-PDF aus dem Drive-Ordner öffnen (Fenster gleich öffnen, sonst blockiert der Browser es)
async function papierkramPdf(nr) {
  menueFuer = '';
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font-family:sans-serif">PDF wird gesucht …</p>');
  try {
    const a = await schnittstelle('altrechnungPdf', { nr });
    const r = papierkram.find(x => x.nr === nr); if (r) r.pdf = true;
    if (w) w.location.href = a.url; else window.open(a.url, '_blank');
  } catch (e) {
    if (w) w.close();
    showStatus(e.message === 'unbekannte_aktion' ? 'Bitte zuerst Code.gs ab Version 1.13 im Apps Script bereitstellen.' : ((e.daten && e.daten.text) || apiFehlerText(e)), 'error');
  }
}

const RE_DRUCKER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/></svg>';

function menueUmschalten(nr) { menueFuer = menueFuer === nr ? '' : nr; renderRechnungen(); }
document.addEventListener('click', () => { if (menueFuer) { menueFuer = ''; renderRechnungen(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && menueFuer) { menueFuer = ''; renderRechnungen(); } });

// Ansehen: dieselbe Rechnung im neuen Fenster, ohne Druckdialog
function rechnungAnsehen(nr) {
  menueFuer = '';
  const r = (rechnungen || []).find(x => x.nr === nr);
  if (r) druckFenster(rechnungHtml(r, rechnungInfo.absender), false);
  renderRechnungen();
}

function zahlungFormZeigen(nr) { zahlungFormFuer = nr; menueFuer = ''; renderRechnungen(); }

// Zahlung eintragen (oder mit zuruecksetzen=true wieder auf offen stellen); die Rechnung selbst bleibt unverändert
async function rechnungBezahltKlick(nr, zuruecksetzen) {
  if (rechnungLaeuft) return;
  let bezahltAm = '', zahlungsart = '';
  if (zuruecksetzen) {
    if (!confirm('Zahlung bei ' + nr + ' zurücksetzen? Die Rechnung gilt dann wieder als offen.')) return;
  } else {
    bezahltAm = isoZuDatum((document.getElementById('reZAm') || {}).value);
    zahlungsart = (document.getElementById('reZArt') || {}).value || '';
    if (!bezahltAm) { showStatus('Bitte das Datum der Zahlung eintragen.', 'error'); return; }
  }
  rechnungLaeuft = true;
  try {
    const a = await schnittstelle('rechnungBezahlt', { nr, bezahltAm, zahlungsart });
    const r = rechnungen.find(x => x.nr === nr);
    if (r) Object.assign(r, { bezahltAm: a.rechnung.bezahltAm, zahlungsart: a.rechnung.zahlungsart, faellig: a.rechnung.faellig || r.faellig });
    zahlungFormFuer = '';
    renderRechnungen();
    showStatus(zuruecksetzen ? nr + ' ist wieder offen.' : nr + ' ist als bezahlt markiert ✓');
  } catch (e) {
    showStatus(e.message === 'unbekannte_aktion' ? 'Bitte Code.gs ab Version 1.12 im Apps Script bereitstellen.' : ((e.daten && e.daten.text) || apiFehlerText(e)), 'error');
  } finally { rechnungLaeuft = false; }
}

// ---------- Festschreiben, Stornieren ----------
function entwurfDaten() {
  return { bestellnr: entwurf.bestellnr, datum: entwurf.datum, leistungsdatum: entwurf.leistungsdatum, betreff: entwurf.betreff.trim(),
    empfaenger: entwurf.empfaenger.trim(), hinweis: entwurf.hinweis.trim(), seriennummern: entwurf.seriennummern.trim(),
    faellig: entwurf.faellig || '', bezahltAm: entwurf.zahlungsart ? (entwurf.bezahltAm || '') : '', zahlungsart: entwurf.zahlungsart || '',
    positionen: entwurf.positionen.map(p => ({ text: String(p.text || '').trim(), menge: p.menge, preis: p.preis })) };
}
async function rechnungFestschreiben() {
  if (!entwurf || rechnungLaeuft) return;
  const d = entwurfDaten();
  if (!d.empfaenger) { showStatus('Bitte den Empfänger eintragen.', 'error'); return; }
  if (d.positionen.some(p => !p.text)) { showStatus('Jede Position braucht eine Beschreibung.', 'error'); return; }
  if (!(rSumme(d.positionen) > 0)) { showStatus('Der Rechnungsbetrag muss größer als 0 sein.', 'error'); return; }
  if (!confirm('Rechnung über € ' + rBetrag(rSumme(d.positionen)) + ' festschreiben? Danach lässt sie sich nicht mehr ändern, nur stornieren.')) return;
  rechnungLaeuft = true;
  try {
    const r = await schnittstelle('rechnungErstellen', { rechnung: d });
    entwurf = null;
    if (r.absender) rechnungInfo.absender = r.absender;
    await ladeRechnungen(true);
    if (d.bestellnr && bestellungen) { const b = bestellungen.find(x => x.nr === d.bestellnr); if (b) b.rechnungsnr = r.rechnung.nr; }
    showStatus('Rechnung ' + r.rechnung.nr + ' ist festgeschrieben ✓ Jetzt „Drucken / PDF“.');
  } catch (e) {
    showStatus((e.daten && e.daten.text) || apiFehlerText(e), 'error');
  } finally { rechnungLaeuft = false; }
}

async function rechnungStornoKlick(nr) {
  menueFuer = ''; renderRechnungen();
  const grund = prompt('Rechnung ' + nr + ' stornieren? Es entsteht die Stornorechnung ' + nr + '-S.\nGrund (optional, steht auf der Stornorechnung):', '');
  if (grund === null) return;
  try {
    const r = await schnittstelle('rechnungStornieren', { nr, grund });
    await ladeRechnungen(true);
    const b = (bestellungen || []).find(x => x.rechnungsnr === nr); if (b) b.rechnungsnr = '';
    showStatus('Stornorechnung ' + r.rechnung.nr + ' ist erstellt ✓');
  } catch (e) { showStatus((e.daten && e.daten.text) || apiFehlerText(e), 'error'); }
}

// ---------- Drucken ----------
// Fenster sofort im Klick öffnen (sonst blockt der Browser es), Inhalt danach hineinschreiben
function druckFenster(html, drucken) {
  const w = window.open('', '_blank');
  if (!w) { showStatus('Das Druckfenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben.', 'error'); return null; }
  w.document.open(); w.document.write(html); w.document.close();
  if (drucken) setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* Nutzerin druckt selbst */ } }, 300);
  return w;
}
function rechnungDrucken(nr) {
  const r = (rechnungen || []).find(x => x.nr === nr);
  if (!r) return;
  druckFenster(rechnungHtml(r, rechnungInfo.absender), true);
}
function rechnungVorschau() {
  if (!entwurf) return;
  const d = entwurfDaten();
  druckFenster(rechnungHtml(Object.assign({ nr: '(Entwurf)', art: 'Rechnung', gesamt: rSumme(d.positionen) }, d), rechnungInfo.absender, true), false);
}
// Aus der Bestellung heraus: Rechnung drucken, auch wenn die Liste noch nicht geladen ist
async function rechnungZurBestellung(nr) {
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font-family:Arial;padding:20px">Rechnung wird geladen …</p>');
  await ladeRechnungen(!rechnungen);
  const b = (bestellungen || []).find(x => x.nr === nr);
  const r = (rechnungen || []).find(x => b && x.nr === b.rechnungsnr);
  if (!r || !w) { if (w) w.close(); showStatus('Rechnung nicht gefunden.', 'error'); return; }
  w.document.open(); w.document.write(rechnungHtml(r, rechnungInfo.absender)); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* */ } }, 300);
}

function rechnungHtml(r, a, istEntwurf) {
  a = a || {};
  const storno = r.art === 'Storno';
  const titel = storno ? 'Stornorechnung' : 'Rechnung';
  const name1 = String(r.empfaenger || '').split('\n')[0].trim();
  const dateiname = (titel + '_' + r.nr + '_' + name1 + '_' + datumZuIso(r.datum)).replace(/[^\wäöüÄÖÜß.-]+/g, '_');
  const zeilen = t => rEsc(t).replace(/\n/g, '<br>');
  const fuss = (kopf, liste) => `<div><b>${kopf}</b>${liste.filter(Boolean).map(x => '<br>' + rEsc(x)).join('')}</div>`;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${rEsc(dateiname)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Open Sans", Arial, Helvetica, sans-serif; color: #222; font-size: 10pt; }
  .seite { width: 210mm; min-height: 297mm; padding: 14mm 18mm 40mm; position: relative; }
  .kopf { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { font-weight: 400; font-size: 22pt; margin: 18mm 0 0; }
  .absender { font-size: 7.5pt; margin-top: 4mm; } .absender span { color: #999; padding: 0 4px; }
  .empf { margin-top: 6mm; min-height: 32mm; line-height: 1.45; }
  .info { display: grid; grid-template-columns: 1.6fr 1.1fr 1.1fr .9fr; gap: 4mm; margin-top: 6mm; }
  .info b { display: block; } .info div:last-child { text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 7mm; }
  th { background: #e6e6e6; text-align: left; padding: 5px 6px; font-size: 9.5pt; }
  td { padding: 8px 6px; vertical-align: top; } th.z, td.z { text-align: right; white-space: nowrap; }
  tbody tr:last-child td { border-bottom: 1px solid #ccc; padding-bottom: 12px; }
  .summe { display: flex; justify-content: flex-end; gap: 22mm; font-weight: 700; font-size: 11pt; margin: 6mm 6px 0; }
  .texte { margin-top: 9mm; line-height: 1.5; } .texte p { margin: 0 0 4mm; }
  .fuss { position: absolute; left: 18mm; right: 18mm; bottom: 10mm; border-top: 1px solid #ddd; padding-top: 4mm;
    display: grid; grid-template-columns: 1fr 1.2fr 1.4fr; gap: 6mm; font-size: 6.8pt; line-height: 1.5; }
  .entwurf { position: absolute; top: 90mm; left: 0; right: 0; text-align: center; font-size: 60pt; color: rgba(200,0,0,.12); transform: rotate(-20deg); pointer-events: none; }
  @media screen { body { background: #eee; } .seite { margin: 10px auto; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.2); } }
</style></head><body><div class="seite">
  ${istEntwurf ? '<div class="entwurf">ENTWURF</div>' : ''}
  <div class="kopf">${RECHNUNG_LOGO}<h1>${titel}</h1></div>
  <div class="absender"><b>${rEsc(a.name)}</b><span>|</span>${rEsc(a.strasse)}<span>|</span>${rEsc(a.ort)}</div>
  <div class="empf">${zeilen(r.empfaenger)}</div>
  <div class="info">
    <div><b>Betreff</b>${zeilen(r.betreff || '–')}</div>
    <div><b>${storno ? 'Stornonummer' : 'Rechnungsnummer'}</b>${rEsc(r.nr)}${r.bezug ? '<br>zu ' + rEsc(r.bezug) : ''}</div>
    <div><b>Leistungsdatum</b>${rEsc(r.leistungsdatum)}</div>
    <div><b>Datum</b>${rEsc(r.datum)}</div>
  </div>
  <table><thead><tr><th>Pos.</th><th>Beschreibung</th><th class="z">Menge</th><th class="z">USt.</th><th class="z">Einzelpreis</th><th class="z">Gesamt</th></tr></thead>
  <tbody>${(r.positionen || []).map((p, i) => `<tr><td>${i + 1}.</td><td>${zeilen(p.text)}</td><td class="z">${rMenge(p.menge)}</td><td class="z">0%</td>
    <td class="z">${rBetrag(p.preis)}</td><td class="z">${rBetrag(p.menge * p.preis)}</td></tr>`).join('')}</tbody></table>
  <div class="summe"><span>Gesamt</span><span>€ ${rBetrag(r.gesamt)}</span></div>
  <div class="texte"><p>${RECHNUNG_19}</p>${r.hinweis ? '<p>' + zeilen(r.hinweis) + '</p>' : ''}${r.seriennummern ? '<p>' + rEsc(r.seriennummern) + '</p>' : ''}</div>
  <div class="fuss">
    ${fuss(a.name, [a.strasse, a.ort, a.ustid ? 'USt-ID: ' + a.ustid : '', a.inhaber ? 'Inhaber: ' + a.inhaber : ''])}
    ${fuss('Kontakt', [a.telefon ? 'Telefon: ' + a.telefon : '', a.email ? 'E-Mail: ' + a.email : ''])}
    ${fuss('Bankverbindung', [a.bank ? 'Bank: ' + a.bank : '', a.iban ? 'IBAN: ' + a.iban : '', a.bic ? 'BIC: ' + a.bic : ''])}
  </div>
</div></body></html>`;
}
