// Erzeugt aus seiten.json + katalog.json die statischen Teile der Website:
//   1. die Unterseiten (z. B. zahlenkrone-hund.html) aus vorlagen/unterseite.html
//   2. die Produktkarten und Seitenlinks in index.html (zwischen den ERZEUGT-Markierungen)
//   3. sitemap.xml
// Preise, Fotos, Farben und Größen stehen danach fest im HTML – gut für Google, kein JavaScript nötig.
// Läuft automatisch per GitHub Action, sobald sich katalog.json oder seiten.json ändert.
//
//   node scripts/seiten.js            → Dateien schreiben
//   node scripts/seiten.js --pruefen  → nur prüfen, ob alles aktuell ist (Fehlercode 1, wenn nicht)

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const SHOP = 'https://kronenwelt.de/';
// Feste Versionsnummer in den Bildadressen (wie in index.html), damit sich die erzeugten Dateien
// nicht bei jedem Lauf ändern. Neue Fotos kommen trotzdem an: der Admin leert den Cloudinary-Cache.
const BILD = 'https://res.cloudinary.com/dw6amyijc/image/upload/v20551/';
const FESTE_SEITEN = ['impressum.html', 'agb.html', 'widerruf.html', 'datenschutz.html'];

const lies = d => fs.readFileSync(path.join(WURZEL, d), 'utf8');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const euro = n => n.toFixed(2).replace('.', ',') + ' €';

/* ---------- Katalog-Helfer ---------- */
const preise = p => ((p.merkmale || {}).groesse || []).map(g => g.preis).filter(x => typeof x === 'number');
const abPreis = p => { const l = preise(p); return l.length ? Math.min(...l) : null; };
const bildUrl = id => BILD + id + '.jpg';
const bestellLink = p => '/?krone=' + encodeURIComponent(p.name) + '#bestellen';

// Welche Produkte gehören auf eine Seite? { "typ": "zahl" } = alle mit diesem Konfigurator-Typ
// (neue Produkte kommen automatisch dazu), { "ids": [...] } = feste Auswahl.
function produkteFuer(auswahl, katalog) {
  const alle = katalog.produkte || [];
  if (auswahl && Array.isArray(auswahl.ids)) return auswahl.ids.map(id => alle.find(p => p.id === id)).filter(Boolean);
  if (auswahl && auswahl.typ) return alle.filter(p => (p.konfigurator || {}).typ === auswahl.typ);
  return alle;
}

/* ---------- Produktkarten ---------- */
function kartenReihenfolge(katalog, karten) {
  const alle = katalog.produkte || [];
  const vorn = (karten.reihenfolge || []).map(id => alle.find(p => p.id === id)).filter(Boolean);
  return vorn.concat(alle.filter(p => !vorn.includes(p)));
}

// alsLink = false: Karte der Startseite (wählt die Krone im Konfigurator aus)
// alsLink = true:  Karte einer Unterseite (führt zur Startseite mit vorgewählter Krone)
function karteHtml(p, karten, alsLink) {
  const k = karten[p.id] || {};
  const titel = k.titel || p.name;
  const alt = k.alt || (p.texte || {}).googleTitel || p.name + ' für Hunde';
  const ab = abPreis(p);
  const badge = k.badge ? `\n            <div class="prod-badge${k.badgeDunkel ? ' prod-badge-dark' : ''}">${esc(k.badge)}</div>` : '';
  const js = p.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const auf = alsLink
    ? `<a class="prod-card" data-variant="${esc(p.name)}" href="${esc(bestellLink(p))}">`
    : `<div class="prod-card" data-variant="${esc(p.name)}" onclick="selectVariant('${esc(js)}');document.getElementById('bestellen').scrollIntoView({behavior:'smooth'})">`;
  return `    ${auf}
      <div class="prod-img">
        <img src="${bildUrl(p.hauptfoto)}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="prod-overlay">
          <div class="prod-overlay-left">
            <div class="prod-name">${esc(titel)}</div>
            <div class="prod-price">${ab != null ? 'ab ' + euro(ab) : ''}</div>${badge}
          </div>
        </div>
      </div>
    ${alsLink ? '</a>' : '</div>'}`;
}

/* ---------- Bausteine der Unterseiten ---------- */
function abschnittHtml(a, i) {
  return `<section class="section ${i % 2 ? 'section-white' : 'section-beige'} us-text">
  ${a.eyebrow ? `<div class="sec-eyebrow">${esc(a.eyebrow)}</div>\n  ` : ''}<h2 class="sec-title">${esc(a.titel)}</h2>
  <div class="sec-line"></div>
  <div class="us-prosa">
${(a.absaetze || []).map(t => `    <p>${t}</p>`).join('\n')}
  </div>
</section>`;
}

// Beschreibung je Produkt: Kurztext, Farben und Größen aus dem Katalog
function produktListeHtml(liste, karten, katalog) {
  const gName = w => (((katalog.merkmale || {}).groesse || {}).werte || []).find(g => g.wert === w);
  return liste.map(p => {
    const k = karten[p.id] || {};
    const farben = ((p.merkmale || {}).farbe || []).map(f => f.wert).join(', ');
    const groessen = ((p.merkmale || {}).groesse || []).map(g => (gName(g.wert) || {}).name || g.wert).join(', ');
    return `    <div class="us-produkt">
      <dt><a href="${esc(bestellLink(p))}">${esc(k.titel || p.name)}</a></dt>
      <dd>${esc((p.texte || {}).kurz || '')}${farben ? ` <span class="us-detail">Ausführungen: ${esc(farben)}.</span>` : ''}${groessen ? ` <span class="us-detail">Größen: ${esc(groessen)}.</span>` : ''}</dd>
    </div>`;
  }).join('\n');
}

function zahlenpadsHtml(z, katalog) {
  const werte = (((katalog.optionen || {}).zahlenpets || {}).werte) || [];
  if (!z || !werte.length) return '';
  const zeilen = werte.map(o => `      <div class="szinfo-card">
        <div class="szinfo-name">${o.wert} Zahlenpads</div>
        <div class="szinfo-dim">${o.aufpreis ? '+ ' + euro(o.aufpreis) : 'im Preis enthalten'}</div>
      </div>`).join('\n');
  return `<section class="section section-white us-text" id="zahlenpads">
  ${z.eyebrow ? `<div class="sec-eyebrow">${esc(z.eyebrow)}</div>\n  ` : ''}<h2 class="sec-title">${esc(z.titel)}</h2>
  <div class="sec-line"></div>
  <div class="us-prosa"><p>${z.text || ''}</p></div>
  <div class="szinfo-grid us-raster">
${zeilen}
  </div>
</section>`;
}

// Größenkarten: nur Größen, die es bei den Produkten der Seite gibt; mit Hinweis, wenn nicht bei allen
function groessenHtml(g, liste, karten, katalog) {
  if (!g) return '';
  const werte = (((katalog.merkmale || {}).groesse || {}).werte) || [];
  const hat = (p, w) => ((p.merkmale || {}).groesse || []).some(x => x.wert === w);
  const zeilen = werte.filter(w => liste.some(p => hat(p, w.wert))).map(w => {
    const mit = liste.filter(p => hat(p, w.wert));
    const nur = mit.length < liste.length
      ? `\n        <div class="szinfo-breeds">Erhältlich bei: ${esc(mit.map(p => (karten[p.id] || {}).titel || p.name).join(', '))}</div>` : '';
    return `      <div class="szinfo-card">
        <svg class="szinfo-crown" viewBox="0 0 44 28" aria-hidden="true"><polygon points="22,2 32,12 42,5 38,22 6,22 2,5 12,12" fill="none" stroke="#729599" stroke-width="2" stroke-linejoin="round"/></svg>
        <div class="szinfo-name">${esc(w.name || w.wert)}</div>
        <div class="szinfo-dim">${esc(w.info || '')}</div>${nur}
      </div>`;
  });
  return `<section class="section section-beige us-text" id="groessen">
  ${g.eyebrow ? `<div class="sec-eyebrow">${esc(g.eyebrow)}</div>\n  ` : ''}<h2 class="sec-title">${esc(g.titel)}</h2>
  <div class="sec-line"></div>
  <div class="szinfo-grid us-raster">
${zeilen.join('\n')}
  </div>
</section>`;
}

function faqHtml(s) {
  if (!Array.isArray(s.faq) || !s.faq.length) return '';
  return `<section class="section section-beige" id="faq">
  <div class="sec-eyebrow">FAQ</div>
  <h2 class="sec-title">${esc(s.faqTitel || 'Häufige Fragen')}</h2>
  <div class="sec-line"></div>
  <div class="faq-list">
${s.faq.map(f => `    <details class="faq-item">
      <summary>${esc(f.frage)}</summary>
      <p>${f.antwort}</p>
    </details>`).join('\n')}
  </div>
</section>`;
}

// Produktdaten für Google (wie auf der Startseite, hier aber fest im HTML)
function jsonLd(s, liste, karten) {
  const url = SHOP + s.datei;
  const produkte = liste.filter(p => preise(p).length).map(p => ({
    '@type': 'Product',
    name: ((karten[p.id] || {}).titel || p.name) + ' – Hundekrone',
    description: (p.texte || {}).googleText || (p.texte || {}).kurz || 'Handgemachte Krone für Hunde.',
    image: bildUrl(p.hauptfoto),
    brand: { '@type': 'Brand', name: "Mila's Kronenwelt" },
    category: 'Hundezubehör > Hundekostüme',
    offers: {
      '@type': 'AggregateOffer',
      url: SHOP + bestellLink(p).slice(1),
      priceCurrency: 'EUR',
      lowPrice: Math.min(...preise(p)).toFixed(2),
      highPrice: Math.max(...preise(p)).toFixed(2),
      offerCount: preise(p).length,
      availability: 'https://schema.org/InStock',
      seller: { '@id': SHOP + '#shop' }
    }
  }));
  const graph = [
    {
      '@type': 'WebPage', '@id': url, url, name: s.titel, description: s.beschreibung, inLanguage: 'de-DE',
      isPartOf: { '@id': SHOP + '#website' }
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: "Mila's Kronenwelt", item: SHOP },
        { '@type': 'ListItem', position: 2, name: s.linkText || s.h1, item: url }
      ]
    },
    ...produkte
  ];
  // "</" entschärfen, damit der Text den <script>-Block nicht vorzeitig beenden kann
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2).replace(/<\//g, '<\\/');
}

function seitenLinksHtml(seiten, ausser) {
  return seiten.filter(s => s !== ausser)
    .map(s => `      <a href="${esc(s.datei)}">${esc(s.linkText || s.h1)}</a>`).join('\n');
}

function unterseite(s, daten, vorlage) {
  const { katalog, karten, seiten } = daten;
  const liste = produkteFuer(s.produkte, katalog);
  if (!liste.length) throw new Error(`Seite ${s.datei}: keine passenden Produkte im Katalog gefunden.`);
  const abs = liste.map(abPreis).filter(x => x != null);
  const werte = {
    titel: esc(s.titel),
    beschreibung: esc(s.beschreibung),
    url: SHOP + s.datei,
    bildUrl: bildUrl(s.bild || liste[0].hauptfoto),
    bildAlt: esc(s.bildAlt || s.titel),
    jsonLd: jsonLd(s, liste, karten),
    eyebrow: esc(s.eyebrow || ''),
    h1: esc(s.h1) + (s.h1Betont ? `<br><em>${esc(s.h1Betont)}</em>` : ''),
    einleitung: s.einleitung || '',
    knopf: esc(s.knopf || 'Jetzt bestellen'),
    knopfLink: esc(bestellLink(liste[0])),
    abPreisText: abs.length ? 'ab ' + euro(Math.min(...abs)) : 'Handgefertigt',
    kartenEyebrow: esc(s.kartenEyebrow || 'KOLLEKTION'),
    kartenTitel: esc(s.kartenTitel || 'Unsere Hundekronen'),
    karten: liste.map(p => karteHtml(p, karten, true)).join('\n\n'),
    produktListe: produktListeHtml(liste, karten, katalog),
    abschnitte: (s.abschnitte || []).map(abschnittHtml).join('\n\n'),
    zahlenpads: zahlenpadsHtml(s.zahlenpads, katalog),
    groessen: groessenHtml(s.groessen, liste, karten, katalog),
    faq: faqHtml(s),
    seitenLinks: seitenLinksHtml(seiten, s)
  };
  const html = vorlage.replace(/\{\{(\w+)\}\}/g, (m, name) => {
    if (!(name in werte)) throw new Error(`Vorlage: unbekannter Platzhalter ${m}`);
    return werte[name];
  });
  return html.replace(/\n{3,}/g, '\n\n');
}

/* ---------- index.html: Bereiche zwischen den Markierungen ersetzen ---------- */
function ersetzeBereich(html, name, inhalt) {
  const re = new RegExp(`(<!-- ERZEUGT:${name}:START[^>]*-->)[\\s\\S]*?(<!-- ERZEUGT:${name}:ENDE -->)`);
  if (!re.test(html)) throw new Error(`index.html: Markierung ERZEUGT:${name} fehlt.`);
  return html.replace(re, (m, a, b) => `${a}\n${inhalt}\n${b}`);
}

function startseite(html, daten) {
  const { katalog, karten, seiten } = daten;
  const kartenHtml = kartenReihenfolge(katalog, karten).map(p => karteHtml(p, karten, false)).join('\n\n');
  html = ersetzeBereich(html, 'KARTEN', '\n' + kartenHtml + '\n');
  html = ersetzeBereich(html, 'MEHR', seiten.length
    ? `  <p class="mehr-seiten">Mehr erfahren: ${seiten.map(s => `<a href="${esc(s.datei)}">${esc(s.linkText || s.h1)}</a>`).join(' · ')}</p>` : '');
  html = ersetzeBereich(html, 'SEITENLINKS', seitenLinksHtml(seiten, null));
  return html;
}

function sitemap(seiten) {
  const urls = [SHOP, ...seiten.map(s => SHOP + s.datei), ...FESTE_SEITEN.map(d => SHOP + d)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>
`;
}

/* ---------- Alles zusammen ---------- */
function erzeuge() {
  const katalog = JSON.parse(lies('katalog.json'));
  const cfg = JSON.parse(lies('seiten.json'));
  const daten = { katalog, karten: cfg.karten || {}, seiten: cfg.seiten || [] };
  const vorlage = lies('vorlagen/unterseite.html');
  const dateien = {};
  daten.seiten.forEach(s => {
    if (!/^[a-z0-9-]+\.html$/.test(s.datei || '') || s.datei === 'index.html' || FESTE_SEITEN.includes(s.datei)) {
      throw new Error(`seiten.json: ungültiger Dateiname "${s.datei}" (nur Kleinbuchstaben, Ziffern, Bindestrich, .html).`);
    }
    dateien[s.datei] = unterseite(s, daten, vorlage);
  });
  dateien['index.html'] = startseite(lies('index.html'), daten);
  dateien['sitemap.xml'] = sitemap(daten.seiten);
  return dateien;
}

if (require.main === module) {
  const pruefen = process.argv.includes('--pruefen');
  const dateien = erzeuge();
  const veraltet = Object.keys(dateien).filter(d => {
    const ziel = path.join(WURZEL, d);
    return !fs.existsSync(ziel) || fs.readFileSync(ziel, 'utf8') !== dateien[d];
  });
  if (pruefen) {
    if (veraltet.length) {
      console.error('Nicht aktuell: ' + veraltet.join(', ') + '\n→ bitte "node scripts/seiten.js" ausführen.');
      process.exit(1);
    }
    console.log('Alle erzeugten Seiten sind aktuell.');
  } else {
    veraltet.forEach(d => fs.writeFileSync(path.join(WURZEL, d), dateien[d]));
    console.log(veraltet.length ? 'Geschrieben: ' + veraltet.join(', ') : 'Alles aktuell – nichts zu tun.');
  }
}

module.exports = { erzeuge };
