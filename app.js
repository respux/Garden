// ---- constants ----------------------------------------------------------

const MAAND_NAMEN = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
const TYPE_INFO = {
  boom: { label: "Boom", symbol: "🌳" },
  struik: { label: "Struik", symbol: "🌿" },
  moestuin: { label: "Moestuinplant", symbol: "🥕" },
  vaste_plant: { label: "Vaste plant", symbol: "🌸" },
  siergras: { label: "Siergras", symbol: "🌾" },
  overig: { label: "Overig", symbol: "🌱" },
};
const SNOEI_METHODEN = [
  "Vormsnoei",
  "Onderhoudssnoei (tussentijds)",
  "Verjongingssnoei (tot op de grond)",
  "Alleen uitgebloeide bloemen verwijderen",
  "Geen snoei nodig",
];
const ZONE_PALET = ["#5B7553","#8B9A6B","#A8763E","#6E8894","#9C8257","#71835B","#B08D57","#5D7A88"];
const uid = () => Math.random().toString(36).slice(2, 10);
const nowMonth = () => new Date().getMonth() + 1;
const LOCAL_KEY = "tuin-lokaal";
const SVG_NS = "http://www.w3.org/2000/svg";

// ---- state ---------------------------------------------------------------

let state = {
  zones: [],
  plants: [],
  achtergrond: { bestand: "img/plattegrond.jpg", x: 50, y: 50, zoom: 100 },
  soorten: [],
  view: "kaart",
  editMode: false,
  panel: null,
  zoneDrawing: null,
  placingTreeId: null,
  bgError: false,
};

async function init() {
  let base = { zones: [], plants: [], achtergrond: state.achtergrond };
  try {
    const res = await fetch("data/garden.json");
    base = await res.json();
  } catch (e) { console.warn("Kon data/garden.json niet laden", e); }

  const local = localStorage.getItem(LOCAL_KEY);
  if (local) {
    try {
      const parsed = JSON.parse(local);
      Object.assign(state, parsed);
    } catch (e) { Object.assign(state, base); }
  } else {
    Object.assign(state, base);
  }

  try {
    const res2 = await fetch("data/soorten.json");
    const data2 = await res2.json();
    state.soorten = data2.soorten || [];
  } catch (e) { console.warn("Kon data/soorten.json niet laden", e); }

  render();
}

function persist() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({
    zones: state.zones, plants: state.plants, achtergrond: state.achtergrond,
  }));
}

function exportData() {
  const blob = new Blob([JSON.stringify({ zones: state.zones, plants: state.plants, achtergrond: state.achtergrond }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "garden.json";
  a.click();
  URL.revokeObjectURL(url);
}

function resetToPublished() {
  if (!confirm("Lokale wijzigingen weggooien en teruggaan naar de laatst gepubliceerde versie?")) return;
  localStorage.removeItem(LOCAL_KEY);
  location.reload();
}

// ---- render root ----------------------------------------------------------

function render() {
  document.getElementById("subtitle").textContent = `${state.plants.length} planten · ${state.zones.length} zones`;
  document.querySelectorAll(".tab-btn[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === state.view);
    btn.onclick = () => { state.view = btn.dataset.view; state.placingTreeId = null; state.zoneDrawing = null; render(); };
  });
  const editBtn = document.getElementById("edit-toggle");
  editBtn.textContent = state.editMode ? "🔓 Bewerken aan" : "🔒 Bewerken uit";
  editBtn.classList.toggle("active", state.editMode);
  editBtn.onclick = () => { state.editMode = !state.editMode; state.zoneDrawing = null; render(); };

  const exportBtn = document.getElementById("export-btn");
  const resetBtn = document.getElementById("reset-btn");
  exportBtn.style.display = state.editMode ? "" : "none";
  resetBtn.style.display = state.editMode ? "" : "none";
  exportBtn.onclick = exportData;
  resetBtn.onclick = resetToPublished;

  const app = document.getElementById("app");
  app.innerHTML = "";

  if (state.editMode) {
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.textContent = "Bewerkmodus staat aan. Wijzigingen worden alleen in jouw browser bewaard. Gebruik \"Exporteren\" om ze publiek te maken.";
    app.appendChild(notice);
  }

  if (state.view === "kaart") renderKaart(app);
  if (state.view === "kalender") renderKalender(app);
  if (state.view === "lijst") renderLijst(app);

  renderPanel();
}

// ---- geometry helpers ---------------------------------------------------

function centroid(points) {
  const n = points.length;
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / n, y: sum.y / n };
}

function pointsToAttr(points) {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

// ---- kaart view -------------------------------------------------------

function renderKaart(app) {
  const wrap = document.createElement("div");
  wrap.className = "map-wrap";

  if (state.editMode) {
    wrap.appendChild(renderBgControls());
  }

  if (state.placingTreeId) {
    const n = document.createElement("div");
    n.className = "notice accent";
    n.textContent = "Klik op de kaart om deze boom te plaatsen.";
    wrap.appendChild(n);
  }
  if (state.zoneDrawing) {
    const n = document.createElement("div");
    n.className = "notice accent";
    n.textContent = `Zone tekenen: klik punten langs de rand van het gebied (${state.zoneDrawing.points.length} geplaatst). Minimaal 3 nodig. Klik "Klaar" als de vorm compleet is.`;
    wrap.appendChild(n);
  }

  const map = document.createElement("div");
  map.className = "map" + (state.editMode ? " editing" : "");
  map.id = "map-el";

  if (state.achtergrond && state.achtergrond.bestand && !state.bgError) {
    const img = document.createElement("img");
    img.className = "map-bg-img";
    img.src = state.achtergrond.bestand;
    img.style.left = state.achtergrond.x + "%";
    img.style.top = state.achtergrond.y + "%";
    img.style.width = state.achtergrond.zoom + "%";
    img.style.transform = "translate(-50%, -50%)";
    img.onerror = () => { state.bgError = true; render(); };
    map.appendChild(img);
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.position = "absolute"; svg.style.inset = "0"; svg.style.width = "100%"; svg.style.height = "100%";

  state.zones.forEach((z) => {
    const poly = document.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points", pointsToAttr(z.points));
    poly.setAttribute("fill", z.kleur + "77");
    poly.setAttribute("stroke", z.kleur);
    poly.setAttribute("stroke-width", "0.4");
    poly.style.cursor = "pointer";
    poly.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.zoneDrawing || state.placingTreeId) return;
      state.panel = { type: "zone", data: z }; render();
    });
    svg.appendChild(poly);
  });

  if (state.zoneDrawing && state.zoneDrawing.points.length > 0) {
    const pts = state.zoneDrawing.points;
    if (pts.length > 1) {
      const poly = document.createElementNS(SVG_NS, "polyline");
      poly.setAttribute("points", pointsToAttr(pts));
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", "#A8763E");
      poly.setAttribute("stroke-width", "0.5");
      poly.setAttribute("stroke-dasharray", "1.5,1");
      svg.appendChild(poly);
    }
    pts.forEach((p) => {
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("cx", p.x); c.setAttribute("cy", p.y); c.setAttribute("r", "0.8");
      c.setAttribute("fill", "#A8763E");
      svg.appendChild(c);
    });
  }

  map.appendChild(svg);

  state.zones.forEach((z) => {
    const c = centroid(z.points);
    const label = document.createElement("span");
    label.className = "zone-label";
    label.style.position = "absolute";
    label.style.left = c.x + "%"; label.style.top = c.y + "%";
    label.style.transform = "translate(-50%, -50%)";
    label.style.pointerEvents = "none";
    label.textContent = z.naam;
    map.appendChild(label);
  });

  const treePlants = state.plants.filter((p) => p.type === "boom" && typeof p.x === "number");
  treePlants.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "tree-pin";
    btn.innerHTML = `<span style="font-size:22px;">🌳</span><span class="tree-pin-label"></span>`;
    btn.querySelector(".tree-pin-label").textContent = p.naam;
    btn.style.left = p.x + "%"; btn.style.top = p.y + "%";
    btn.onclick = (e) => {
      e.stopPropagation();
      if (state.zoneDrawing) return;
      state.panel = { type: "plant", data: p }; render();
    };
    map.appendChild(btn);
  });

  wrap.appendChild(map);
  app.appendChild(wrap);

  setupMapInteractions(map);

  const unplacedTrees = state.plants.filter((p) => p.type === "boom" && typeof p.x !== "number");
  if (unplacedTrees.length > 0) {
    const u = document.createElement("div");
    u.className = "unplaced";
    u.textContent = "Nog niet op de kaart geplaatst: ";
    unplacedTrees.forEach((t) => {
      const b = document.createElement("button");
      b.textContent = t.naam;
      b.onclick = () => { state.placingTreeId = t.id; render(); };
      u.appendChild(b);
    });
    app.appendChild(u);
  }

  if (state.editMode) {
    const actions = document.createElement("div");
    actions.className = "map-actions";

    if (!state.zoneDrawing) {
      const addBtn = document.createElement("button");
      addBtn.className = "add-btn";
      addBtn.textContent = "+ Plant toevoegen";
      addBtn.onclick = () => { state.panel = { type: "plantForm", data: { zoneId: null } }; render(); };
      const zoneBtn = document.createElement("button");
      zoneBtn.className = "add-btn";
      zoneBtn.textContent = "+ Zone tekenen";
      zoneBtn.onclick = () => { state.zoneDrawing = { points: [] }; render(); };
      const tip = document.createElement("span");
      tip.className = "tip";
      tip.textContent = "Klik punt voor punt langs de rand van een gebied om een zone in een eigen vorm te tekenen.";
      actions.appendChild(addBtn); actions.appendChild(zoneBtn); actions.appendChild(tip);
    } else {
      const doneBtn = document.createElement("button");
      doneBtn.className = "add-btn solid";
      doneBtn.textContent = "✓ Klaar";
      doneBtn.disabled = state.zoneDrawing.points.length < 3;
      doneBtn.onclick = () => {
        const pts = state.zoneDrawing.points;
        state.zoneDrawing = null;
        state.panel = { type: "zoneForm", data: { points: pts, naam: "", kleur: ZONE_PALET[state.zones.length % ZONE_PALET.length] } };
        render();
      };
      const undoBtn = document.createElement("button");
      undoBtn.className = "add-btn";
      undoBtn.textContent = "↺ Laatste punt";
      undoBtn.onclick = () => { state.zoneDrawing.points.pop(); render(); };
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "add-btn";
      cancelBtn.textContent = "✕ Annuleren";
      cancelBtn.onclick = () => { state.zoneDrawing = null; render(); };
      actions.appendChild(doneBtn); actions.appendChild(undoBtn); actions.appendChild(cancelBtn);
    }
    app.appendChild(actions);
  }
}

function renderBgControls() {
  const box = document.createElement("div");
  box.className = "bg-controls";

  const pathLabel = document.createElement("label");
  pathLabel.textContent = "Afbeeldingspad (in de repo, bv. img/plattegrond.jpg)";
  const pathInput = document.createElement("input");
  pathInput.className = "input"; pathInput.value = state.achtergrond.bestand || "";
  pathInput.oninput = () => { state.achtergrond.bestand = pathInput.value; state.bgError = false; persist(); render(); };
  pathLabel.appendChild(pathInput);

  const mk = (labelText, key, min, max) => {
    const l = document.createElement("label");
    l.textContent = labelText + " (" + state.achtergrond[key] + ")";
    const row = document.createElement("div"); row.className = "range-row";
    const r = document.createElement("input");
    r.type = "range"; r.min = min; r.max = max; r.value = state.achtergrond[key];
    r.oninput = () => { state.achtergrond[key] = Number(r.value); persist(); render(); };
    row.appendChild(r);
    l.appendChild(row);
    return l;
  };

  box.appendChild(pathLabel);
  box.appendChild(mk("Horizontaal (pan)", "x", 0, 100));
  box.appendChild(mk("Verticaal (pan)", "y", 0, 100));
  box.appendChild(mk("Zoom", "zoom", 20, 300));
  const hint = document.createElement("div");
  hint.className = "tip";
  hint.textContent = "Zet je luchtfoto in de img/-map van de repo en verwijs hierboven naar het bestand. Pan/zoom om irrelevante delen buiten beeld te schuiven.";
  box.appendChild(hint);
  return box;
}

function setupMapInteractions(map) {
  function pct(e) {
    const rect = map.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }
  map.onclick = (e) => {
    if (!state.editMode) return;
    if (state.placingTreeId) {
      const { x, y } = pct(e);
      const plant = state.plants.find((p) => p.id === state.placingTreeId);
      if (plant) { plant.x = x; plant.y = y; persist(); }
      state.placingTreeId = null;
      render();
      return;
    }
    if (state.zoneDrawing) {
      const { x, y } = pct(e);
      state.zoneDrawing.points.push({ x, y });
      render();
      return;
    }
  };
}

// ---- kalender view --------------------------------------------------------

function renderKalender(app) {
  const grid = document.createElement("div");
  grid.className = "calendar-grid";
  const huidig = nowMonth();
  let anyContent = false;

  MAAND_NAMEN.forEach((naam, idx) => {
    const maand = idx + 1;
    const snoei = state.plants.filter((p) => (p.snoeiMaanden || []).includes(maand));
    const oogst = state.plants.filter((p) => (p.oogstMaanden || []).includes(maand));
    if (snoei.length === 0 && oogst.length === 0) return;
    anyContent = true;
    const card = document.createElement("div");
    card.className = "month-card" + (maand === huidig ? " current" : "");
    let html = `<div class="month-title">${naam}${maand === huidig ? '<span class="now-badge">NU</span>' : ""}</div>`;
    if (snoei.length) {
      html += `<div class="section-label">Snoeien</div>`;
      snoei.forEach((p) => { html += plantLineHtml(p, "🌿"); });
    }
    if (oogst.length) {
      html += `<div class="section-label" style="margin-top:8px;">Oogsten</div>`;
      oogst.forEach((p) => { html += plantLineHtml(p, "🧺"); });
    }
    card.innerHTML = html;
    card.querySelectorAll("[data-plant-id]").forEach((el) => {
      el.onclick = () => { const p = state.plants.find((pl) => pl.id === el.dataset.plantId); state.panel = { type: "plant", data: p }; render(); };
    });
    grid.appendChild(card);
  });

  app.appendChild(grid);
  if (!anyContent) {
    const empty = document.createElement("div");
    empty.className = "tip";
    empty.textContent = "Nog geen snoei- of oogstmaanden ingesteld bij je planten.";
    app.appendChild(empty);
  }
}

function plantLineHtml(p, icon) {
  const zone = state.zones.find((z) => z.id === p.zoneId);
  return `<div class="plant-line" data-plant-id="${p.id}">${icon} ${escapeHtml(p.naam)} <span class="meta">· ${zone ? escapeHtml(zone.naam) : "geen zone"}</span></div>`;
}

// ---- lijst view -------------------------------------------------------

function renderLijst(app) {
  if (state.editMode) {
    const addBtn = document.createElement("button");
    addBtn.className = "add-btn solid";
    addBtn.style.width = "auto";
    addBtn.style.marginBottom = "16px";
    addBtn.textContent = "+ Plant toevoegen";
    addBtn.onclick = () => { state.panel = { type: "plantForm", data: { zoneId: null } }; render(); };
    app.appendChild(addBtn);
  }
  const sorted = [...state.plants].sort((a, b) => a.naam.localeCompare(b.naam));
  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tip";
    empty.textContent = "Nog geen planten toegevoegd.";
    app.appendChild(empty);
    return;
  }
  sorted.forEach((p) => {
    const zone = state.zones.find((z) => z.id === p.zoneId);
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `<div>
        <div class="name">${escapeHtml(p.naam)} ${p.latijnseNaam ? `<span class="latin">(${escapeHtml(p.latijnseNaam)})</span>` : ""}</div>
        <div class="meta">${TYPE_INFO[p.type]?.label || ""} · ${zone ? escapeHtml(zone.naam) : "Geen zone"}</div>
      </div>`;
    row.onclick = () => { state.panel = { type: "plant", data: p }; render(); };
    app.appendChild(row);
  });
}

// ---- panel (side drawer) --------------------------------------------------

function renderPanel() {
  const root = document.getElementById("panel-root");
  root.innerHTML = "";
  if (!state.panel) return;

  const overlay = document.createElement("div");
  overlay.className = "panel-overlay";
  overlay.onclick = () => { state.panel = null; render(); };
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.onclick = (e) => e.stopPropagation();

  const closeBtn = document.createElement("button");
  closeBtn.className = "panel-close";
  closeBtn.textContent = "✕";
  closeBtn.onclick = () => { state.panel = null; render(); };
  panel.appendChild(closeBtn);
  panel.appendChild(Object.assign(document.createElement("div"), { className: "clear" }));

  if (state.panel.type === "zone") panel.appendChild(renderZonePanel(state.panel.data));
  if (state.panel.type === "plant") panel.appendChild(renderPlantDetail(state.panel.data));
  if (state.panel.type === "plantForm") panel.appendChild(renderPlantForm(state.panel.data));
  if (state.panel.type === "zoneForm") panel.appendChild(renderZoneForm(state.panel.data));

  overlay.appendChild(panel);
  root.appendChild(overlay);
}

function renderZonePanel(zone) {
  const div = document.createElement("div");
  const zonePlants = state.plants.filter((p) => p.zoneId === zone.id);
  const header = document.createElement("div");
  header.className = "detail-header";
  header.innerHTML = `<div class="detail-name">${escapeHtml(zone.naam)}</div>`;
  if (state.editMode) {
    const del = document.createElement("button");
    del.className = "icon-btn"; del.textContent = "🗑";
    del.onclick = () => {
      if (!confirm("Zone verwijderen? Planten in deze zone verliezen hun zone.")) return;
      state.zones = state.zones.filter((z) => z.id !== zone.id);
      state.plants.forEach((p) => { if (p.zoneId === zone.id) p.zoneId = null; });
      persist();
      state.panel = null; render();
    };
    header.appendChild(del);
  }
  div.appendChild(header);
  const meta = document.createElement("div");
  meta.className = "detail-meta";
  meta.textContent = `${zonePlants.length} planten in deze zone`;
  div.appendChild(meta);

  const list = document.createElement("div");
  list.className = "zone-plants";
  zonePlants.forEach((p) => {
    const row = document.createElement("div");
    row.className = "zone-plant-row";
    row.innerHTML = `${TYPE_INFO[p.type]?.symbol || "🌱"} ${escapeHtml(p.naam)}`;
    row.onclick = () => { state.panel = { type: "plant", data: p }; render(); };
    list.appendChild(row);
  });
  div.appendChild(list);

  if (state.editMode) {
    const addBtn = document.createElement("button");
    addBtn.className = "add-btn"; addBtn.style.marginTop = "12px";
    addBtn.textContent = "+ Plant toevoegen aan deze zone";
    addBtn.onclick = () => { state.panel = { type: "plantForm", data: { zoneId: zone.id } }; render(); };
    div.appendChild(addBtn);
  }
  return div;
}

function renderPlantDetail(plant) {
  const div = document.createElement("div");
  const zone = state.zones.find((z) => z.id === plant.zoneId);
  const header = document.createElement("div");
  header.className = "detail-header";
  header.innerHTML = `<div class="detail-name-row"><span style="font-size:20px;">${TYPE_INFO[plant.type]?.symbol || "🌱"}</span><div class="detail-name">${escapeHtml(plant.naam)}</div></div>`;
  if (state.editMode) {
    const actions = document.createElement("div");
    const editB = document.createElement("button"); editB.className = "icon-btn"; editB.textContent = "✎";
    editB.onclick = () => { state.panel = { type: "plantForm", data: plant }; render(); };
    const delB = document.createElement("button"); delB.className = "icon-btn"; delB.textContent = "🗑";
    delB.onclick = () => {
      if (!confirm("Deze plant verwijderen?")) return;
      state.plants = state.plants.filter((p) => p.id !== plant.id);
      persist(); state.panel = null; render();
    };
    actions.appendChild(editB); actions.appendChild(delB);
    header.appendChild(actions);
  }
  div.appendChild(header);
  if (plant.latijnseNaam) {
    const latin = document.createElement("div");
    latin.className = "detail-latin"; latin.textContent = plant.latijnseNaam;
    div.appendChild(latin);
  }
  const meta = document.createElement("div");
  meta.className = "detail-meta";
  meta.textContent = `${TYPE_INFO[plant.type]?.label || ""} · ${zone ? zone.naam : "Geen zone"}`;
  div.appendChild(meta);

  const fields = document.createElement("div");
  fields.className = "detail-fields";
  if (plant.plantDatum) fields.appendChild(fieldEl("Geplant op", new Date(plant.plantDatum).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })));
  if (plant.snoeiMaanden?.length) fields.appendChild(fieldEl("Snoeimaanden", plant.snoeiMaanden.map((m) => MAAND_NAMEN[m - 1]).join(", ")));
  if (plant.snoeiMethode?.length) fields.appendChild(fieldEl("Manier van snoeien", plant.snoeiMethode.join(", ")));
  if (plant.oogstMaanden?.length) fields.appendChild(fieldEl("Oogstmaanden", plant.oogstMaanden.map((m) => MAAND_NAMEN[m - 1]).join(", ")));
  if (plant.notities) fields.appendChild(fieldEl("Notities", plant.notities, true));
  div.appendChild(fields);
  return div;
}

function fieldEl(label, value, multiline) {
  const d = document.createElement("div");
  d.innerHTML = `<div class="field-label"></div><div class="field-value"></div>`;
  d.querySelector(".field-label").textContent = label;
  d.querySelector(".field-value").textContent = value;
  return d;
}

// ---- plant form with species suggestions ------------------------------

function findSuggestions(query) {
  if (!query || query.trim().length < 2) return [];
  const q = query.trim().toLowerCase();
  const fromDb = state.soorten.filter((s) => s.naam.toLowerCase().includes(q) || (s.latijnseNaam || "").toLowerCase().includes(q));
  const fromGarden = state.plants.filter((p) => p.naam.toLowerCase().includes(q) && (p.snoeiMaanden?.length || p.snoeiMethode?.length))
    .map((p) => ({ naam: p.naam, latijnseNaam: p.latijnseNaam, type: p.type, snoeiMaanden: p.snoeiMaanden, snoeiMethode: p.snoeiMethode, oogstMaanden: p.oogstMaanden, tips: "Al eerder toegevoegd in jouw tuin.", _eigen: true }));
  const combined = [...fromDb, ...fromGarden];
  const seen = new Set();
  return combined.filter((s) => { const key = s.naam.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 5);
}

function renderPlantForm(initial) {
  const isEdit = !!initial.id;
  const data = {
    id: initial.id, naam: initial.naam || "", latijnseNaam: initial.latijnseNaam || "", type: initial.type || "struik",
    zoneId: initial.zoneId || "", plantDatum: initial.plantDatum || "", notities: initial.notities || "",
    snoeiMaanden: initial.snoeiMaanden || [], snoeiMethode: initial.snoeiMethode || [], oogstMaanden: initial.oogstMaanden || [],
    x: initial.x, y: initial.y,
  };

  const div = document.createElement("form");
  div.style.display = "flex"; div.style.flexDirection = "column"; div.style.gap = "0";

  const title = document.createElement("div");
  title.className = "detail-name"; title.style.marginBottom = "14px";
  title.textContent = isEdit ? "Plant bewerken" : "Nieuwe plant";
  div.appendChild(title);

  const naamField = labeledInput("Naam *", data.naam, (v) => { data.naam = v; renderSuggestions(); });
  div.appendChild(naamField.wrap);

  const suggestBox = document.createElement("div");
  suggestBox.id = "suggest-box";
  div.appendChild(suggestBox);

  function renderSuggestions() {
    const matches = findSuggestions(data.naam);
    suggestBox.innerHTML = "";
    if (matches.length === 0) return;
    const box = document.createElement("div");
    box.className = "suggestion-box";
    box.innerHTML = `<div class="field-label">Suggesties</div>`;
    matches.forEach((m) => {
      const line = document.createElement("div");
      line.style.marginBottom = "4px";
      line.innerHTML = `<b>${escapeHtml(m.naam)}</b>${m.latijnseNaam ? " <i>(" + escapeHtml(m.latijnseNaam) + ")</i>" : ""} — ${escapeHtml(m.tips || "")}`;
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "tag"; btn.textContent = "Overnemen";
      btn.onclick = () => {
        data.latijnseNaam = m.latijnseNaam || data.latijnseNaam;
        data.type = m.type || data.type;
        data.snoeiMaanden = m.snoeiMaanden || data.snoeiMaanden;
        data.snoeiMethode = m.snoeiMethode || data.snoeiMethode;
        data.oogstMaanden = m.oogstMaanden || data.oogstMaanden;
        if (m.tips && !m._eigen) data.notities = data.notities ? data.notities + "\n" + m.tips : m.tips;
        rebuildDynamicFields();
        latinField.input.value = data.latijnseNaam;
        notesArea.value = data.notities;
        suggestBox.innerHTML = "";
      };
      line.appendChild(document.createElement("br"));
      line.appendChild(btn);
      box.appendChild(line);
    });
    suggestBox.appendChild(box);
  }

  const latinField = labeledInput("Latijnse naam", data.latijnseNaam, (v) => { data.latijnseNaam = v; }, true);
  div.appendChild(latinField.wrap);

  const typeWrap = document.createElement("div"); typeWrap.className = "field";
  typeWrap.innerHTML = `<div class="field-label">Type</div>`;
  const typeRow = document.createElement("div"); typeRow.className = "tag-row";
  Object.entries(TYPE_INFO).forEach(([key, info]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "tag" + (data.type === key ? " on" : "");
    b.textContent = info.label;
    b.onclick = () => { data.type = key; renderTypeButtons(); rebuildDynamicFields(); };
    typeRow.appendChild(b);
  });
  function renderTypeButtons() {
    [...typeRow.children].forEach((b, i) => { b.classList.toggle("on", Object.keys(TYPE_INFO)[i] === data.type); });
  }
  typeWrap.appendChild(typeRow);
  div.appendChild(typeWrap);

  const zoneWrap = document.createElement("div"); zoneWrap.className = "field";
  zoneWrap.innerHTML = `<div class="field-label">Zone</div>`;
  const zoneSelect = document.createElement("select"); zoneSelect.className = "input";
  zoneSelect.innerHTML = `<option value="">Geen zone</option>` + state.zones.map((z) => `<option value="${z.id}">${escapeHtml(z.naam)}</option>`).join("");
  zoneSelect.value = data.zoneId || "";
  zoneSelect.onchange = () => { data.zoneId = zoneSelect.value; };
  zoneWrap.appendChild(zoneSelect);
  div.appendChild(zoneWrap);

  const dateField = labeledInput("Plantdatum", data.plantDatum, (v) => { data.plantDatum = v; }, false, "date");
  div.appendChild(dateField.wrap);

  const snoeiWrap = document.createElement("div"); snoeiWrap.className = "field";
  snoeiWrap.innerHTML = `<div class="field-label">Snoeimaanden</div>`;
  const snoeiRow = monthToggleRow(data.snoeiMaanden, (arr) => { data.snoeiMaanden = arr; });
  snoeiWrap.appendChild(snoeiRow);
  div.appendChild(snoeiWrap);

  const methodeWrap = document.createElement("div"); methodeWrap.className = "field";
  methodeWrap.innerHTML = `<div class="field-label">Manier van snoeien</div>`;
  const methodeRow = document.createElement("div"); methodeRow.className = "tag-row";
  SNOEI_METHODEN.forEach((m) => {
    const b = document.createElement("button"); b.type = "button";
    b.className = "tag" + (data.snoeiMethode.includes(m) ? " on" : "");
    b.textContent = m;
    b.onclick = () => {
      data.snoeiMethode = data.snoeiMethode.includes(m) ? data.snoeiMethode.filter((x) => x !== m) : [...data.snoeiMethode, m];
      b.classList.toggle("on");
    };
    methodeRow.appendChild(b);
  });
  methodeWrap.appendChild(methodeRow);
  div.appendChild(methodeWrap);

  const oogstWrap = document.createElement("div"); oogstWrap.className = "field";
  function buildOogst() {
    oogstWrap.innerHTML = "";
    if (data.type !== "moestuin") return;
    oogstWrap.innerHTML = `<div class="field-label">Oogstmaanden</div>`;
    oogstWrap.appendChild(monthToggleRow(data.oogstMaanden, (arr) => { data.oogstMaanden = arr; }));
  }
  div.appendChild(oogstWrap);

  const notesWrap = document.createElement("div"); notesWrap.className = "field";
  notesWrap.innerHTML = `<div class="field-label">Notities</div>`;
  const notesArea = document.createElement("textarea"); notesArea.className = "input"; notesArea.rows = 3;
  notesArea.value = data.notities; notesArea.placeholder = "optioneel";
  notesArea.oninput = () => { data.notities = notesArea.value; };
  notesWrap.appendChild(notesArea);
  div.appendChild(notesWrap);

  function rebuildDynamicFields() {
    renderTypeButtons();
    buildOogst();
  }
  buildOogst();

  const treeHint = document.createElement("div");
  if (data.type === "boom") {
    treeHint.className = "tip"; treeHint.style.marginBottom = "12px";
    treeHint.textContent = "Na het opslaan vraag ik je deze boom op de kaart te plaatsen.";
  }
  div.appendChild(treeHint);

  const actions = document.createElement("div"); actions.className = "form-actions";
  const saveBtn = document.createElement("button"); saveBtn.type = "submit"; saveBtn.className = "add-btn solid"; saveBtn.style.width = "auto";
  saveBtn.textContent = "Opslaan";
  const cancelBtn = document.createElement("button"); cancelBtn.type = "button"; cancelBtn.className = "add-btn"; cancelBtn.style.width = "auto";
  cancelBtn.textContent = "Annuleren";
  cancelBtn.onclick = () => { state.panel = null; render(); };
  actions.appendChild(saveBtn); actions.appendChild(cancelBtn);
  div.appendChild(actions);

  div.onsubmit = (e) => {
    e.preventDefault();
    data.naam = naamField.input.value.trim();
    data.latijnseNaam = latinField.input.value.trim();
    data.plantDatum = dateField.input.value;
    data.notities = notesArea.value.trim();
    if (!data.naam) return;
    if (isEdit) {
      const idx = state.plants.findIndex((p) => p.id === data.id);
      state.plants[idx] = { ...state.plants[idx], ...data, zoneId: data.zoneId || null };
    } else {
      data.id = uid();
      state.plants.push({ ...data, zoneId: data.zoneId || null });
    }
    persist();
    const needsPlacement = data.type === "boom" && typeof data.x !== "number";
    if (needsPlacement) {
      state.placingTreeId = data.id;
      state.view = "kaart";
      state.panel = null;
    } else {
      state.panel = { type: "plant", data: state.plants.find((p) => p.id === data.id) };
    }
    render();
  };

  return div;
}

function monthToggleRow(selectedArr, onChange) {
  const row = document.createElement("div"); row.className = "tag-row";
  MAAND_NAMEN.forEach((m, idx) => {
    const val = idx + 1;
    const b = document.createElement("button"); b.type = "button"; b.className = "month-tag" + (selectedArr.includes(val) ? " on" : "");
    b.textContent = m;
    b.onclick = () => {
      const i = selectedArr.indexOf(val);
      if (i >= 0) selectedArr.splice(i, 1); else selectedArr.push(val);
      onChange(selectedArr);
      b.classList.toggle("on");
    };
    row.appendChild(b);
  });
  return row;
}

function labeledInput(label, value, onInput, italic, type) {
  const wrap = document.createElement("div"); wrap.className = "field";
  const lab = document.createElement("div"); lab.className = "field-label"; lab.textContent = label;
  const input = document.createElement("input"); input.className = "input"; input.type = type || "text"; input.value = value || "";
  if (italic) input.style.fontStyle = "italic";
  input.oninput = () => onInput(input.value);
  wrap.appendChild(lab); wrap.appendChild(input);
  return { wrap, input };
}

// ---- zone form (naming a freshly-sketched polygon) ------------------------

function renderZoneForm(zone) {
  const div = document.createElement("div");
  const title = document.createElement("div"); title.className = "detail-name"; title.style.marginBottom = "14px";
  title.textContent = "Nieuwe zone";
  div.appendChild(title);

  const naamField = labeledInput("Naam *", zone.naam, (v) => { zone.naam = v; });
  div.appendChild(naamField.wrap);

  const colorWrap = document.createElement("div"); colorWrap.className = "field";
  colorWrap.innerHTML = `<div class="field-label">Kleur</div>`;
  const colorRow = document.createElement("div"); colorRow.className = "tag-row";
  ZONE_PALET.forEach((c) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "swatch" + (zone.kleur === c ? " on" : "");
    b.style.background = c;
    b.onclick = () => { zone.kleur = c; [...colorRow.children].forEach((x) => x.classList.remove("on")); b.classList.add("on"); };
    colorRow.appendChild(b);
  });
  colorWrap.appendChild(colorRow);
  div.appendChild(colorWrap);

  const actions = document.createElement("div"); actions.className = "form-actions";
  const saveBtn = document.createElement("button"); saveBtn.className = "add-btn solid"; saveBtn.style.width = "auto";
  saveBtn.textContent = "Zone opslaan";
  saveBtn.onclick = () => {
    zone.naam = naamField.input.value.trim();
    if (!zone.naam) return;
    state.zones.push({ id: uid(), naam: zone.naam, points: zone.points, kleur: zone.kleur });
    persist();
    state.panel = null;
    render();
  };
  const cancelBtn = document.createElement("button"); cancelBtn.className = "add-btn"; cancelBtn.style.width = "auto";
  cancelBtn.textContent = "Annuleren (vorm weggooien)";
  cancelBtn.onclick = () => { state.panel = null; render(); };
  actions.appendChild(saveBtn); actions.appendChild(cancelBtn);
  div.appendChild(actions);
  return div;
}

// ---- utils -------------------------------------------------------------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

window.tuinExport = exportData;
window.tuinReset = resetToPublished;

init();
