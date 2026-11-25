# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Überblick

Mila's Kronenwelt (kronenwelt.de): Webshop für handgenähte Hundekronen. Statische Website auf GitHub Pages
(`CNAME`), kein Build-Schritt, kein Framework. Code, Kommentare, Bezeichner, Commit-Nachrichten und Texte
sind auf Deutsch – so beibehalten. Die Admin-Seite wird von Sara (Inhaberin, keine Entwicklerin) bedient:
Meldungen und Texte in der Oberfläche müssen einfach und verständlich bleiben.

## Befehle

```bash
npm install && npx playwright install chromium   # einmalig
npm test                                          # alle Tests (Desktop + Handy-Größe, Schnittstelle einmal)
npx playwright test tests/shop.spec.js            # eine Datei
npx playwright test -g "Rechnung"                 # Tests nach Name
npx playwright test --project=desktop             # nur eine Bildschirmgröße
node scripts/seiten.js                            # Unterseiten, Produktkarten, sitemap.xml, js/katalog-notfall.js neu erzeugen
node scripts/seiten.js --pruefen                  # nur prüfen, ob erzeugte Dateien aktuell sind
node scripts/merchant-feed.js                     # merchant-feed.xml neu erzeugen
```

Die Tests starten selbst `python3 -m http.server 4173` und blockieren alle externen Dienste (`tests/helpers.js`).
Es gibt keinen Linter. CI (`.github/workflows/tests.yml`) führt bei jedem PR `npx playwright test` aus.

## Architektur

Drei Teile, die über JSON-Dateien und eine HTTP-Schnittstelle zusammenhängen:

1. **Shop** – `index.html` (Seite und CSS-Verweise), `js/shop.js` (das gesamte Shop-JavaScript, klassisches
   Skript am Ende von `<body>`, Funktionen global für `onclick="…"`) plus `config.js` (öffentliche Werte:
   PayPal-Client-ID, Apps-Script-URL; ist für jeden abrufbar, nie Geheimnisse eintragen).
   Startet mit `js/katalog-notfall.js` (erzeugt) und lädt zur Laufzeit `katalog.json`, `galerie.json`, `medien.json`. Bezahlt wird mit PayPal; danach wird die
   Bestellung per `fetch(CONFIG.SHEETS_URL)` an das Apps Script geschickt, Mails gehen über EmailJS.
2. **Admin** – `admin.html` + `admin/js/01-…14-*.js`. Klassische Skripte ohne Module: alle teilen sich einen
   globalen Namensraum, die Reihenfolge in `admin.html` ist entscheidend. `05-schnittstelle.js` enthält
   `schnittstelle(aktion, extra)`, über die alle Server-Aufrufe laufen. Der Admin liest/schreibt die
   JSON-Dateien über die Aktion `github` des Apps Scripts und **committet sie direkt auf `main`**
   (Commits „Admin: …“) – auf Feature-Branches daher mit Konflikten in `katalog.json`/`medien.json` rechnen.
3. **Schnittstelle** – `apps-script/Code.gs` (Google Apps Script an der Tabelle „Kronenwelt Bestellungen“).
   `doPost` → `bestellungSpeichern` (Shop, ohne Schlüssel) oder `adminAnfrage` (mit Admin-Schlüssel, `switch`
   über `aktion`). Zuständig für Bestellungen, Lager (Summe der Zeilen in „Lagerbewegungen“), PayPal-Prüfung,
   MK-Seriennummern (GPSR), Rechnungen, Etsy-Import. Alle Geheimnisse liegen in den Skript-Eigenschaften.
   Der Kopfkommentar von `Code.gs` dokumentiert jede Version (1.8 … 1.16) – bei neuen Funktionen dort ergänzen.

**`katalog.json` ist die eine Quelle** für Produkte, Merkmale (Farbe, Größe), Preise, Fotos und Artikelnummern
(z. B. `KR-PARTY-ROSA-GR`). Shop, Admin, Apps Script (rechnet Preise zur Prüfung nach) und die Generatoren
lesen sie. Kürzel/Artikelnummern nie ändern – sie sind die feste Kennung in Lager und Bestellungen.

**Erzeugte Dateien:** `scripts/seiten.js` erzeugt aus `seiten.json` + `katalog.json` + `vorlagen/unterseite.html`
die Unterseiten (z. B. `zahlenkrone-hund.html`), `sitemap.xml`, `js/katalog-notfall.js` (Notfall-Katalog des
Shops, Versionsnummer in `index.html` = Prüfsumme) und die Blöcke in `index.html` zwischen
`<!-- ERZEUGT:…:START -->` und `<!-- ERZEUGT:…:ENDE -->`. `scripts/merchant-feed.js` erzeugt `merchant-feed.xml`.
Diese Stellen nie von Hand bearbeiten, sondern Generator/Vorlage ändern und neu erzeugen. Auf `main` erledigt das
`.github/workflows/merchant-feed.yml` automatisch und committet das Ergebnis.

## Wichtige Regeln

- **Code.gs wird nicht automatisch bereitgestellt.** Sara kopiert ihn in den Apps-Script-Editor und stellt eine
  neue Version bereit. Website und Schnittstelle können also verschiedene Stände haben: Änderungen
  rückwärtskompatibel halten, bei neuen Aktionen `SCHNITTSTELLE_VERSION` erhöhen und im Admin den Fehler
  `unbekannte_aktion` verständlich behandeln (siehe `apiFehlerText`). In der Zusammenfassung angeben, dass
  Code.gs neu bereitgestellt werden muss.
- **Tabellenspalten:** Die ersten 12 Spalten (`SPALTEN`) sind fest; neue Spalten nur rechts anhängen
  (`ZUSATZ_SPALTEN`), nie umbenennen oder löschen. Spalten immer über den Kopfnamen ansprechen (`kopf.indexOf`).
- **Rechnungen:** Festgeschriebene Rechnungen sind unveränderlich (Korrektur nur per Stornorechnung `<Nr>-S`);
  danach dürfen sich nur „Fällig am“, „Bezahlt am“, „Zahlungsart“ ändern.
- **Versionsnummer Shop:** Nach Änderungen an `js/shop.js` den Parameter `js/shop.js?v=…` in `index.html`
  hochzählen, sonst laden Browser die alte Datei aus dem Zwischenspeicher.
- **Versionsnummer Admin:** Bei Änderungen an Admin-Dateien `ADMIN_VERSION` (`admin/js/03-navigation.js`) und
  die `?v=`-Parameter in `admin.html` gemeinsam hochzählen (Cache-Busting).
- **Admin darf nur bestimmte Dateien schreiben:** `GITHUB_DATEIEN` in `Code.gs`. Neue vom Admin bearbeitete
  Datei = dort eintragen.

## Tests

- `tests/schnittstelle-attrappe.js` führt den **echten** `Code.gs` in einer Node-`vm` aus, mit nachgestellten
  Google-Diensten (Sheets, Mail, Lock, Properties, UrlFetch für PayPal/Etsy). `schnittstelle.spec.js` testet
  so die Server-Logik; nutzt `Code.gs` einen neuen Google-Dienst, muss die Attrappe ihn nachbilden.
- `admin.spec.js` testet die Admin-Seite im Browser gegen diese Attrappe; `seiten.spec.js` prüft, dass die
  erzeugten Dateien zu `katalog.json`/`seiten.json` passen (nach Katalogänderungen `node scripts/seiten.js`
  ausführen, sonst schlägt er fehl).
- Preise und Fotos in Tests immer aus `katalog.json` ableiten (`helpers.js`: `preise`, `fotos`), nicht fest eintragen.
