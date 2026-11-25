// Kronenwelt Admin – Galerie
// Teil von admin.html; alle Dateien teilen sich einen Namensraum (klassische Skripte, Reihenfolge wie in admin.html).

// ============================================================
// GALERIE
// ============================================================
// Alle Werte entschärft (medienEsc): ein " oder < in Name/Dateiname darf das Formular nicht zerbrechen.
function renderGalerie() {
  const clName = medienEsc(localStorage.getItem('mkw_cl_name') || 'dw6amyijc');
  const e = medienEsc;
  const list = document.getElementById('galerieList');
  list.innerHTML = currentGalerie.map((item, i) => `
    <div class="galerie-item" id="galerieItem_${i}">
      <img class="galerie-thumb"
        src="https://res.cloudinary.com/${clName}/image/upload/${e(item.datei)}.jpg"
        alt="${e(item.name)}"
        onerror="this.src='data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'60\' height=\'60\'><rect width=\'60\' height=\'60\' fill=\'%23e6e2dc\'/></svg>'">
      <div class="galerie-fields">
        <input type="text" placeholder="Dateiname (z.B. bonnie)" value="${e(item.datei)}"
          onchange="updateGalerieItem(${i}, 'datei', this.value)">
        <input type="text" placeholder="Name (z.B. Bonnie)" value="${e(item.name)}"
          onchange="updateGalerieItem(${i}, 'name', this.value)">
        <input type="text" placeholder="Rasse (z.B. Dackel)" value="${e(item.rasse)}"
          onchange="updateGalerieItem(${i}, 'rasse', this.value)">
        <input type="text" placeholder="Krone (z.B. Party · Rosa)" value="${e(item.krone)}"
          onchange="updateGalerieItem(${i}, 'krone', this.value)">
      </div>
      <button class="galerie-del" onclick="deleteGalerieItem(${i})">🗑️</button>
    </div>
  `).join('');
}

function updateGalerieItem(i, field, value) {
  currentGalerie[i][field] = value;
}

function deleteGalerieItem(i) {
  if (!confirm(`"${currentGalerie[i].name}" wirklich entfernen?`)) return;
  currentGalerie.splice(i, 1);
  renderGalerie();
}

function addGalerieItem() {
  currentGalerie.push({
    datei: '',
    name: 'Neuer Hund',
    rasse: '',
    krone: '',
    farbe: '#4a9090',
    featured: false,
    badge: '',
    likes: 0
  });
  renderGalerie();
  // Scroll zum neuen Element
  const items = document.querySelectorAll('.galerie-item');
  items[items.length - 1]?.scrollIntoView({ behavior: 'smooth' });
}

async function saveGalerie() {
  showStatus('Galerie wird gespeichert...', 'loading');
  try {
    const json = JSON.stringify(currentGalerie, null, 2);
    await githubPut('galerie.json', json, 'Admin: Galerie aktualisiert');
    showStatus('Galerie gespeichert! Die Website wird in ~1 Minute aktualisiert.');
  } catch(e) {
    showStatus('Fehler: ' + e.message, 'error');
  }
}
