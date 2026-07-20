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
  const zone = state.zones.find((z) => z.id === plant.zo
