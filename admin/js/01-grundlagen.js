// Kronenwelt Admin – Konfiguration und gemeinsamer Zustand
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// KONFIGURATION
// ============================================================
const GITHUB_USER = 'wpeterchwarz-collab';
const GITHUB_REPO = 'kronenwelt.de';
const CL_BASE = 'https://res.cloudinary.com/';

// Preise & Strukturbaum (wird von GitHub geladen)
const GROESSEN = ['Gross', 'Klein', 'Mini', 'Extra Mini'];
let VARIANTEN_LIST = ['Party', 'Einfarbig', 'Glitzer', 'Edel & Wild',
                        'Zahlenkrone Klassik', 'Zahlenkrone Leo', 'Zahlenkrone Glitzer', 'Zahlenkrone Konfetti'];
// Grössen je Variante (Standard: alle 4)
const VARIANT_GROESSEN = {
  'Zahlenkrone Klassik':  ['Gross', 'Klein', 'Mini'],
  'Zahlenkrone Konfetti': ['Gross', 'Klein', 'Mini']
};
const groessenFuer = v => (katalogProdukt(v) ? katalogProdukt(v).merkmale.groesse.map(g => g.wert) : null) ||
  VARIANT_GROESSEN[v] ||
  (currentPrices[v] && GROESSEN.some(g => g in currentPrices[v]) ? GROESSEN.filter(g => g in currentPrices[v]) : GROESSEN);
const isZahlVariante = v => katalogProdukt(v) ? (katalogProdukt(v).optionen || []).includes('zahlenpets') : v.startsWith('Zahlenkrone');
// Aufpreis für mehr Zahlenpets (Grundpreis = inkl. 3 Pets)
const AUFPREIS_KEY  = 'Zahlenpets Aufpreis';
const AUFPREIS_OPTS = ['6 Pets', '9 Pets'];

// Fallback-Liste – im Normalfall wird die Liste aus katalog.json (Website) gebaut,
// damit jede Farbe aus dem Konfigurator hier automatisch eine Foto-Kachel hat.
let PRODUKT_FOTOS = [
  { key: 'mila-hero',              label: '⭐ Hero-Bild (Startseite)',      variant: 'Startseite',  ext: 'png' },
  { key: 'uni-mint',               label: '⭐ Kollektion – Einfarbig',      variant: 'Startseite'  },
  { key: 'party-krone',            label: '⭐ Kollektion – Party',           variant: 'Startseite'  },
  { key: 'royal-krone',            label: '⭐ Kollektion – Edel & Wild',     variant: 'Startseite'  },
  { key: 'glitzer-krone',          label: '⭐ Kollektion – Glitzer',         variant: 'Startseite'  },
  { key: 'zahl-klassik-krone',     label: '⭐ Kollektion – Zahlenkrone Klassik', variant: 'Startseite' },
  { key: 'zahl-leo-krone',         label: '⭐ Kollektion – Zahlenkrone Leo',     variant: 'Startseite' },
  { key: 'zahl-glitzer-krone',     label: '⭐ Kollektion – Zahlenkrone Glitzer rosa', variant: 'Startseite' },
  { key: 'zahl-konfetti-krone',    label: '⭐ Kollektion – Zahlenkrone Konfetti', variant: 'Startseite' },
  { key: 'party-rosa',             label: 'Party – Rosa mit Punkten',       variant: 'Party'       },
  { key: 'party-grau',             label: 'Party – Grau mit Punkten',       variant: 'Party'       },
  { key: 'party-mint',             label: 'Party – Mint mit Punkten',       variant: 'Party'       },
  { key: 'party-lilia',            label: 'Party – Lila mit Punkten',       variant: 'Party'       },
  { key: 'party-petrol',           label: 'Party – Petrol',                 variant: 'Party'       },
  { key: 'party-konfetti',         label: 'Party – Konfetti',               variant: 'Party'       },
  { key: 'party-weiss-blau-gruen', label: 'Party – Weiss/Blau/Grün',        variant: 'Party'       },
  { key: 'uni-berry',              label: 'Einfarbig – Berry',              variant: 'Einfarbig'   },
  { key: 'uni-blau',               label: 'Einfarbig – Blau',               variant: 'Einfarbig'   },
  { key: 'uni-gruen',              label: 'Einfarbig – Grün',               variant: 'Einfarbig'   },
  { key: 'uni-orange',             label: 'Einfarbig – Orange',             variant: 'Einfarbig'   },
  { key: 'glitzer-blau',           label: 'Glitzer – Blau',                 variant: 'Glitzer'     },
  { key: 'glitzer-pink',           label: 'Glitzer – Rosa/Pink',            variant: 'Glitzer'     },
  { key: 'glitzer-tuerkis',        label: 'Glitzer – Türkis',               variant: 'Glitzer'     },
  { key: 'glitzer-silber',         label: 'Glitzer – Silber',               variant: 'Glitzer'     },
  { key: 'glitzer-weiss',          label: 'Glitzer – Weiss',                variant: 'Glitzer'     },
  { key: 'glitzer-gold',           label: 'Glitzer – Gold',                 variant: 'Glitzer'     },
  { key: 'edel-gold',              label: 'Edel & Wild – Gold',             variant: 'Edel & Wild' },
  { key: 'edel-schwarz',           label: 'Edel & Wild – Schwarz',          variant: 'Edel & Wild' },
  { key: 'edel-rosa',              label: 'Edel & Wild – Rosa',             variant: 'Edel & Wild' },
  { key: 'wild-leo',               label: 'Edel & Wild – Leo Braun',        variant: 'Edel & Wild' },
  { key: 'wild-leo-weiss',         label: 'Edel & Wild – Leo Weiss',        variant: 'Edel & Wild' },
  { key: 'wild-leopard',           label: 'Edel & Wild – Leopard',          variant: 'Edel & Wild' },
  // Zahlenkronen: ein Foto pro wählbarer Option im Konfigurator
  { key: 'zahl-klassik-rosa',       label: 'Hauptfarbe Rosa',                  variant: 'Zahlenkrone Klassik' },
  { key: 'zahl-klassik-gruen',      label: 'Hauptfarbe Grün',                  variant: 'Zahlenkrone Klassik' },
  { key: 'zahl-klassik-weiss-bunt', label: 'Hauptfarbe Weiss/bunte Punkte',    variant: 'Zahlenkrone Klassik' },
  { key: 'zahl-leo-pets-gold',      label: 'Pets Gold / Zahlen schwarz',       variant: 'Zahlenkrone Leo' },
  { key: 'zahl-leo-pets-schwarz',   label: 'Pets Schwarz / Zahlen gold',       variant: 'Zahlenkrone Leo' },
  { key: 'zahl-glitzer-schwarz',    label: 'Schriftfarbe Schwarz',             variant: 'Zahlenkrone Glitzer rosa' },
  { key: 'zahl-glitzer-weiss',      label: 'Schriftfarbe Weiss',               variant: 'Zahlenkrone Glitzer rosa' },
  { key: 'zahl-konfetti-mint',      label: 'Zahlenpads Mint',                  variant: 'Zahlenkrone Konfetti' },
  { key: 'zahl-konfetti-rosa',      label: 'Zahlenpads Rosa',                  variant: 'Zahlenkrone Konfetti' },
];

// ============================================================
// STATE
// ============================================================
let currentPrices = {
  'Party':       { 'Gross': 15, 'Klein': 14, 'Mini': 13, 'Extra Mini': 12 },
  'Einfarbig':   { 'Gross': 15, 'Klein': 14, 'Mini': 13, 'Extra Mini': 12 },
  'Glitzer':     { 'Gross': 17, 'Klein': 16, 'Mini': 15, 'Extra Mini': 14 },
  'Edel & Wild': { 'Gross': 17, 'Klein': 16, 'Mini': 15, 'Extra Mini': 14 },
  'Zahlenkrone Klassik': { 'Gross': 21, 'Klein': 20, 'Mini': 19 },
  'Zahlenkrone Leo':     { 'Gross': 21, 'Klein': 20, 'Mini': 19, 'Extra Mini': 18 },
  'Zahlenkrone Glitzer': { 'Gross': 21, 'Klein': 20, 'Mini': 19, 'Extra Mini': 18 },
  'Zahlenkrone Konfetti': { 'Gross': 21, 'Klein': 20, 'Mini': 19 },
  'Zahlenpets Aufpreis': { '6 Pets': 3, '9 Pets': 6 }
};

let currentGalerie = [];
// Produktkatalog (katalog.json): eine Quelle für Website, Admin und Google-Produktdatei.
// Fehlt die Datei noch (vor dem Umstieg), arbeitet der Admin wie bisher mit preise.json/produktfotos.json.
let KATALOG = null;
let currentMedien = {};
