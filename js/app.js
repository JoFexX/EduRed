/*
 * Interfaz web del TB1.
 */
(() => {
  "use strict";

  const TRAMOS = [
    { nombre: "Josue",   ini: 1,    fin: 375,  color: "#e0b100" },
    { nombre: "Alexs",   ini: 376,  fin: 750,  color: "#ff4500" },
    { nombre: "Maria",   ini: 751,  fin: 1125, color: "#2e8b57" },
    { nombre: "Gabriel", ini: 1126, fin: 1500, color: "#4682b4" },
  ];
  const C = { origen: "#16a34a", destino: "#DF2935", gris: "#6b6f6b", ruta: "#f59e0b" };
  const PALETA_COMP = ["#94a3b8", "#DF2935", "#a78bfa", "#22d3ee", "#fb923c", "#4ade80", "#f472b6", "#3772FF"];
  const COLOR_ZONA = { alta: "#ff7a00", media: "#FDCA40", baja: "#7fb3d5" };

  // ---------------------------------------------------------------- estado
  let py, nodos, aristas, ids, w2i, adyKm, compDe, tamanos, zonas;
  const cacheTramo = new Map();
  const st = {
    tab: "sim", metrica: "km", modo: "destino", origen: null, destinos: [],
    colorPor: "tramo", tramo: null, vecinos: true, aristas: true, compSel: null,
    resultado: null, legSel: null,
  };

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const fmt = x => (x == null || !Number.isFinite(x) ? "∞" : x.toFixed(3));
  const unidad = () => (st.metrica === "km" ? "km" : "km-eq");
  const tramoDe = id => TRAMOS.find(t => id >= t.ini && id <= t.fin);
  const sinTildes = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // deja repintar la pantalla antes de un cálculo largo (setTimeout también avanza con la pestaña en segundo plano)
  const nextFrame = () => new Promise(r => setTimeout(r, 30));

  // ---------------------------------------------------------------- mapa
  const mapa = L.map("mapa", { preferCanvas: true }).setView([-12.06, -77.03], 11);
  const fondo = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  const render = L.canvas({ padding: 0.5 });
  const capaAristas = L.layerGroup().addTo(mapa);
  const capaNodos = L.layerGroup().addTo(mapa);
  const capaRuta = L.layerGroup().addTo(mapa);
  let marcadores = [], camion = null, polisLeg = [];

  // ---------------------------------------------------------------- arranque
  iniciar().catch(e => {
    console.error(e);
    $("#cargandoTxt").textContent = "Error al iniciar: " + e.message;
  });

  async function iniciar() {
    const [pyodide, codigo, datos] = await Promise.all([
      loadPyodide(),
      fetch("python/grafo_donaciones.py", { cache: "no-cache" }).then(r => r.text()),
      fetch("data/grafo.json", { cache: "no-cache" }).then(r => r.text()),
    ]);
    $("#cargandoTxt").textContent = "Construyendo el grafo en Python…";
    await nextFrame();
    pyodide.FS.writeFile("grafo_donaciones.py", codigo);
    py = pyodide.pyimport("grafo_donaciones");
    py.cargar(datos);

    const data = JSON.parse(datos);
    nodos = data.nodos;
    aristas = data.aristas;
    ids = nodos.map(n => n.id);
    w2i = new Map(ids.map((id, i) => [id, i]));
    // adyacencia solo para mostrar vecinos en la ficha del nodo
    adyKm = nodos.map(() => []);
    for (const [o, d, km] of aristas) {
      const u = w2i.get(o), v = w2i.get(d);
      adyKm[u].push([v, km]); adyKm[v].push([u, km]);
    }

    ({ compDe, tamanos } = JSON.parse(py.info_componentes()));
    const op = JSON.parse(py.opciones_trafico());
    zonas = op.zonas;
    llenarSelect("#tHora", op.horas, "18:00");
    llenarSelect("#tDia", op.dias);
    llenarSelect("#tClima", op.climas);

    crearMarcadores();
    construirTramos();
    construirConectividad();
    renderSeleccion();
    refrescarVista();
    mapa.fitBounds(L.latLngBounds(nodos.map(n => [n.lat, n.lon])), { padding: [20, 20] });
    $("#cargando").remove();
  }

  function llenarSelect(sel, valores, def) {
    $(sel).innerHTML = valores.map(v => `<option${v === def ? " selected" : ""}>${esc(v)}</option>`).join("");
  }

  function escenario() {
    if (st.metrica !== "trafico") return { metrica: st.metrica };
    return { metrica: "trafico", hora: $("#tHora").value, dia: $("#tDia").value, clima: $("#tClima").value, zonas: $("#tZonas").checked };
  }

  // ---------------------------------------------------------------- nodos y aristas
  function crearMarcadores() {
    marcadores = nodos.map((n, i) => {
      const m = L.circleMarker([n.lat, n.lon], { renderer: render, radius: 4, weight: 1, color: "#080708", fillOpacity: 0.95 });
      m.bindTooltip(`<b>${n.id}</b> · ${esc(n.nom)}`, { direction: "top", offset: [0, -4] });
      return m;
    });
    // Un solo manejador en el mapa: elige el nodo visible más cercano al clic.
    // Así no hace falta acertar exactamente sobre el círculo de 4 px.
    mapa.on("click", e => {
      const i = nodoCercano(e.containerPoint, 12);
      if (i != null) clicNodo(i);
    });
  }

  function nodoCercano(pt, tolerancia) {
    let mejor = null, dMin = Infinity;
    marcadores.forEach((m, i) => {
      if (!capaNodos.hasLayer(m)) return;
      const d = mapa.latLngToContainerPoint(m.getLatLng()).distanceTo(pt);
      if (d < dMin) { dMin = d; mejor = i; }
    });
    return dMin <= tolerancia + (mejor != null ? marcadores[mejor].getRadius() : 0) ? mejor : null;
  }

  function tramoInfo(t) {
    if (!cacheTramo.has(t.nombre)) cacheTramo.set(t.nombre, JSON.parse(py.resumen_tramo(t.ini, t.fin)));
    return cacheTramo.get(t.nombre);
  }

  function visibles() {
    if (!st.tramo || st.tab !== "explorar") return null; // el filtro solo aplica en «Explorar»
    const info = tramoInfo(st.tramo);
    return { mios: new Set(info.mios), vec: st.vecinos ? new Set(info.vecinos) : new Set() };
  }

  function colorBase(i) {
    if (st.colorPor === "comp") return PALETA_COMP[Math.min(compDe[i], PALETA_COMP.length - 1)];
    if (st.colorPor === "zona") return COLOR_ZONA[zonas[nodos[i].dis]];
    if (st.colorPor === "grado") {
      const t = Math.min(adyKm[i].length / 12, 1);
      return `hsl(${220 - t * 200}, 80%, ${66 - t * 16}%)`;
    }
    return tramoDe(nodos[i].id).color;
  }

  function pintarNodos() {
    const vis = visibles();
    const enRuta = new Set(st.destinos);
    if (st.origen != null) enRuta.add(st.origen);
    capaNodos.clearLayers();
    nodos.forEach((n, i) => {
      let color = colorBase(i), radio = 4, opac = 0.95;
      if (vis) {
        if (vis.mios.has(i)) color = st.tramo.color;
        else if (vis.vec.has(i)) color = C.gris;
        else if (!enRuta.has(i)) return;
      }
      if (st.compSel != null) { if (compDe[i] !== st.compSel) opac = 0.15; else radio = 6; }
      if (st.resultado && !enRuta.has(i)) opac = Math.min(opac, 0.35);
      if (i === st.origen) { color = C.origen; radio = 8; opac = 1; }
      else if (enRuta.has(i)) { color = C.destino; radio = 7; opac = 1; }
      marcadores[i].setStyle({ fillColor: color, radius: radio, fillOpacity: opac, opacity: opac });
      capaNodos.addLayer(marcadores[i]);
    });
  }

  function dibujarAristas() {
    capaAristas.clearLayers();
    if (!st.aristas) return;
    const vis = visibles();
    const mostrar = vis ? new Set([...vis.mios, ...vis.vec]) : null;
    const segs = [];
    for (const [o, d] of aristas) {
      const u = w2i.get(o), v = w2i.get(d);
      if (mostrar && !(mostrar.has(u) && mostrar.has(v))) continue;
      segs.push([[nodos[u].lat, nodos[u].lon], [nodos[v].lat, nodos[v].lon]]);
    }
    L.polyline(segs, { renderer: render, color: "#4b4f5a", weight: 1, opacity: st.resultado ? 0.25 : 0.6, interactive: false }).addTo(capaAristas);
  }

  function refrescarVista() {
    dibujarAristas();
    pintarNodos();
    renderLeyenda();
    renderResumenTramo();
  }

  // ---------------------------------------------------------------- interacción con nodos
  function clicNodo(i) {
    // fuera de «Simulación» el clic solo muestra la ficha (que tiene botones de origen/destino)
    if (st.tab !== "sim") return abrirPopup(i);
    if (st.modo === "origen") { fijarOrigen(i); return ponerModo("destino"); }
    if (st.modo === "destino") alternarDestino(i);
    else if (st.modo === "destino") alternarDestino(i);
    else abrirPopup(i);
  }
  function fijarOrigen(i) {
    st.destinos = st.destinos.filter(d => d !== i);
    st.origen = i;
    invalidar();
  }
  function alternarDestino(i) {
    if (i === st.origen) return abrirPopup(i);
    const k = st.destinos.indexOf(i);
    if (k >= 0) st.destinos.splice(k, 1); else st.destinos.push(i);
    invalidar();
  }
  function invalidar() {
    limpiarRuta();
    renderSeleccion();
    pintarNodos();
  }

  function abrirPopup(i) {
    const n = nodos[i];
    const esDest = st.destinos.includes(i);
    const vec = adyKm[i].slice().sort((a, b) => a[1] - b[1])
      .map(([v, w]) => `<div>• <a data-ir="${v}">${ids[v]} ${esc(nodos[v].nom)}</a> — ${fmt(w)} km</div>`).join("");
    const t = tramoDe(n.id);
    const html = `
      <div class="pop">
        <h3>${esc(n.nom)}</h3>
        <div class="meta">ID ${n.id} · Cód. ${n.cod}<br>${esc(n.dis)} · ${esc(n.niv)}<br>${esc(n.dir)}<br>
          Tramo: <b style="color:${t.color}">${t.nombre}</b> · Grado ${adyKm[i].length} · Componente #${compDe[i] + 1} (${tamanos[compDe[i]]} nodos)<br>
          Congestión de la zona: <b style="color:${COLOR_ZONA[zonas[n.dis]]}">${zonas[n.dis]}</b></div>
        <div class="acciones">
          <button data-acc="origen" style="background:${C.origen}">${i === st.origen ? "Es el origen" : "Fijar origen"}</button>
          <button data-acc="destino" style="background:${C.destino}">${esDest ? "Quitar destino" : "Agregar destino"}</button>
        </div>
        <div class="vec"><b>Vecinos (${adyKm[i].length})</b>${vec || "<div>Sin vecinos</div>"}</div>
      </div>`;
    const p = L.popup({ maxWidth: 300 }).setLatLng([n.lat, n.lon]).setContent(html).openOn(mapa);
    const el = p.getElement();
    el.querySelector('[data-acc="origen"]').onclick = () => { fijarOrigen(i); mapa.closePopup(); };
    el.querySelector('[data-acc="destino"]').onclick = () => { if (i !== st.origen) { alternarDestino(i); mapa.closePopup(); } };
    el.querySelectorAll("[data-ir]").forEach(a => (a.onclick = () => irA(+a.dataset.ir, true)));
  }

  function irA(i, popup) {
    const n = nodos[i];
    mapa.flyTo([n.lat, n.lon], Math.max(mapa.getZoom(), 15), { duration: 0.6 });
    if (popup) mapa.once("moveend", () => abrirPopup(i));
  }

  // ---------------------------------------------------------------- panel: selección
  function renderSeleccion() {
    const ob = $("#origenBox");
    if (st.origen == null) {
      ob.className = "origen vacio";
      ob.textContent = "Ninguno. Haz clic en un nodo (modo «Fijar origen») o búscalo.";
      ob.onclick = null;
    } else {
      const n = nodos[st.origen];
      ob.className = "origen";
      ob.innerHTML = `<b>${n.id}</b> · ${esc(n.nom)}<br><small>${esc(n.dis)}</small>`;
      ob.onclick = () => irA(st.origen, true);
    }
    const ul = $("#destinos");
    $("#nDest").textContent = st.destinos.length;
    if (!st.destinos.length) {
      ul.innerHTML = `<li class="vacio">Haz clic en nodos del mapa para agregarlos.</li>`;
    } else {
      const cO = st.origen != null ? compDe[st.origen] : null;
      ul.innerHTML = st.destinos.map(d => {
        const inacc = cO != null && compDe[d] !== cO;
        return `<li title="${esc(nodos[d].nom)}${inacc ? " — inaccesible desde el origen (otra componente)" : ""}">
          <span data-ver="${d}">${inacc ? "⚠ " : ""}${ids[d]} ${esc(nodos[d].nom)}</span>
          <button data-quitar="${d}" aria-label="Quitar">×</button></li>`;
      }).join("");
      ul.querySelectorAll("[data-quitar]").forEach(b => (b.onclick = () => {
        st.destinos = st.destinos.filter(x => x !== +b.dataset.quitar); invalidar();
      }));
      ul.querySelectorAll("[data-ver]").forEach(s => (s.onclick = () => irA(+s.dataset.ver, true)));
    }
    $("#btnEjecutar").disabled = st.origen == null || st.destinos.length === 0;
  }

  function ponerModo(modo) {
    st.modo = modo;
    $$("#modoClic button").forEach(x => x.classList.toggle("activo", x.dataset.modo === modo));
  }
  $$("#modoClic button").forEach(b => (b.onclick = () => ponerModo(b.dataset.modo)));
  $("#metrica").onchange = e => {
    st.metrica = e.target.value;
    $("#trafico").hidden = st.metrica !== "trafico";
    if (st.resultado) ejecutar();
  };
  ["#tHora", "#tDia", "#tClima", "#tZonas"].forEach(s => ($(s).onchange = () => { if (st.resultado) ejecutar(); }));

  $("#btnAleatorio").onclick = () => {
    const usados = new Set([st.origen, ...st.destinos]);
    if (st.origen == null) { st.origen = Math.floor(Math.random() * nodos.length); usados.add(st.origen); }
    for (let c = 0; c < 8;) {
      const r = Math.floor(Math.random() * nodos.length);
      if (!usados.has(r)) { usados.add(r); st.destinos.push(r); c++; }
    }
    invalidar();
  };
  $("#btnLimpiar").onclick = () => { st.origen = null; st.destinos = []; invalidar(); };
  $("#btnEjecutar").onclick = () => ejecutar();

  // ---------------------------------------------------------------- buscador
  const inp = $("#buscar"), sug = $("#sugerencias");
  let sugIdx = [], sugSel = 0;
  inp.addEventListener("input", () => {
    const q = sinTildes(inp.value.trim());
    if (!q || !nodos) { sug.hidden = true; return; }
    const num = /^\d+$/.test(q);
    sugIdx = [];
    for (let i = 0; i < nodos.length && sugIdx.length < 10; i++) {
      const n = nodos[i];
      const ok = num ? String(n.id).startsWith(q) || String(n.cod).startsWith(q)
                     : sinTildes(n.nom).includes(q) || sinTildes(n.dis).includes(q);
      if (ok) sugIdx.push(i);
    }
    if (num && w2i.has(+q)) { const e = w2i.get(+q); sugIdx = [e, ...sugIdx.filter(x => x !== e)].slice(0, 10); }
    sugSel = 0;
    sug.innerHTML = sugIdx.length
      ? sugIdx.map((i, k) => `<li data-i="${i}" class="${k === 0 ? "sel" : ""}"><span><b>${ids[i]}</b> ${esc(nodos[i].nom)}</span><small>${esc(nodos[i].dis)} · ${esc(nodos[i].niv)}</small></li>`).join("")
      : `<li><small>Sin resultados</small></li>`;
    sug.hidden = false;
    sug.querySelectorAll("[data-i]").forEach(li => (li.onmousedown = e => { e.preventDefault(); elegir(+li.dataset.i); }));
  });
  inp.addEventListener("keydown", e => {
    if (sug.hidden || !sugIdx.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sugSel = (sugSel + (e.key === "ArrowDown" ? 1 : -1) + sugIdx.length) % sugIdx.length;
      sug.querySelectorAll("li").forEach((li, k) => li.classList.toggle("sel", k === sugSel));
    } else if (e.key === "Enter") { e.preventDefault(); elegir(sugIdx[sugSel]); }
    else if (e.key === "Escape") sug.hidden = true;
  });
  inp.addEventListener("blur", () => setTimeout(() => (sug.hidden = true), 120));
  function elegir(i) {
    sug.hidden = true; inp.value = "";
    if (st.modo === "origen") fijarOrigen(i);
    else if (st.modo === "destino" && i !== st.origen && !st.destinos.includes(i)) alternarDestino(i);
    irA(i, st.modo === "info");
  }

  // ---------------------------------------------------------------- simulación (Python)
  async function ejecutar() {
    if (st.origen == null || !st.destinos.length) return;
    detenerAnimacion();
    const btn = $("#btnEjecutar");
    btn.disabled = true;
    btn.textContent = "Calculando…";
    await nextFrame();
    try {
      const r = JSON.parse(py.simular(ids[st.origen], st.destinos.map(d => ids[d]), JSON.stringify(escenario())));
      st.resultado = r;
      st.legSel = null;
      dibujarAristas();
      pintarNodos();
      dibujarRuta();
      renderResultado();
    } catch (e) {
      console.error(e);
      alert("Error en Python: " + e.message);
    } finally {
      btn.textContent = "Ejecutar simulación";
      btn.disabled = false;
    }
  }

  function limpiarRuta() {
    detenerAnimacion();
    capaRuta.clearLayers();
    if (st.resultado) { st.resultado = null; dibujarAristas(); }
    $("#resultado").hidden = true;
  }

  function dibujarRuta() {
    capaRuta.clearLayers();
    polisLeg = [];
    const r = st.resultado;
    r.entregas.forEach((e, k) => {
      const pts = e.camino.map(i => [nodos[i].lat, nodos[i].lon]);
      const halo = L.polyline(pts, { color: "#080708", weight: 8, opacity: 0.8, interactive: false }).addTo(capaRuta);
      const p = L.polyline(pts, { color: C.ruta, weight: 4, opacity: 0.95, bubblingMouseEvents: false }).addTo(capaRuta);
      p.bindTooltip(`Tramo ${k + 1}: ${fmt(e.costo)} ${unidad()}`, { sticky: true });
      p.on("click", () => seleccionarLeg(k));
      e.camino.slice(1, -1).forEach(i => L.circleMarker([nodos[i].lat, nodos[i].lon], {
        renderer: render, radius: 3, color: "#b45309", weight: 1, fillColor: "#fde68a", fillOpacity: 1, interactive: false,
      }).addTo(capaRuta));
      polisLeg.push({ halo, p });
    });
    L.marker([nodos[st.origen].lat, nodos[st.origen].lon], {
      icon: L.divIcon({ className: "", html: `<div class="num-icono origen" style="width:26px;height:26px">O</div>`, iconSize: [26, 26] }),
      zIndexOffset: 1000,
    }).bindTooltip(`Origen: ${esc(nodos[st.origen].nom)}`).on("click", () => abrirPopup(st.origen)).addTo(capaRuta);
    r.marcadoresNum = r.entregas.map((e, k) => L.marker([nodos[e.destino].lat, nodos[e.destino].lon], {
      icon: iconoNum(k, false), zIndexOffset: 900,
    }).bindTooltip(`${k + 1}. ${esc(nodos[e.destino].nom)}`).on("click", () => seleccionarLeg(k)).addTo(capaRuta));
    mapa.fitBounds(L.latLngBounds(r.ruta.map(i => [nodos[i].lat, nodos[i].lon])), { padding: [40, 40] });
  }

  function renderResultado() {
    const r = st.resultado;
    $("#resultado").hidden = false;
    const al = [];
    if (r.inaccesibles.length) {
      al.push(`<div class="alerta"><b>UFDS:</b> ${r.inaccesibles.length} destino(s) en otra componente conexa, no se pueden alcanzar: ${r.inaccesibles.map(d => ids[d]).join(", ")}</div>`);
    } else {
      al.push(`<p class="nota ok">✔ UFDS: los ${st.destinos.length} destinos están en la misma componente que el origen.</p>`);
    }
    if (r.pendientes.length) al.push(`<div class="alerta">Quedaron ${r.pendientes.length} destinos sin planificar.</div>`);
    $("#alertas").innerHTML = al.join("");
    $("#kTotal").textContent = `${fmt(r.distanciaTotal)} ${unidad()}`;
    $("#kEntregas").textContent = r.entregas.length;
    $("#kSaltos").textContent = r.ruta.length - 1;
    const iters = r.entregas.reduce((a, e) => a + e.iteraciones, 0);
    const relaj = r.entregas.reduce((a, e) => a + e.relajaciones, 0);
    const esc_ = escenario();
    const u = unidad();
    const fila = (k, v, cls = "") => `<div class="d-fila ${cls}"><span>${k}</span><b>${v}</b></div>`;

    let html = "";
    if (esc_.metrica === "trafico") {
      html += `<div class="d-escenario">
        <span>🕒 ${esc(esc_.hora)}</span><span>📅 ${esc(esc_.dia)}</span><span>🌦 ${esc(esc_.clima)}</span>
        ${esc_.zonas ? "<span>🚦 Congestión por distrito</span>" : ""}</div>`;
    }
    html += `<div class="d-grupo"><div class="d-titulo">Bellman-Ford</div>
      ${fila("Ejecuciones", r.entregas.length)}
      ${fila("Iteraciones totales", iters)}
      ${fila("Relajaciones totales", relaj.toLocaleString("es-PE"))}
      ${fila("Tiempo", `${r.ms.toFixed(1)} ms`)}</div>`;

    if (r.costoFijo != null) {
      const ahorro = r.costoFijo - r.distanciaTotal;
      const pct = r.costoFijo > 0 ? (ahorro / r.costoFijo) * 100 : 0;
      let veredicto;
      if (ahorro > 1e-9) veredicto = fila("Ahorro del voraz", `${fmt(ahorro)} ${u} (${pct.toFixed(1)}%)`, "positivo");
      else if (ahorro < -1e-9) veredicto = fila("Tu orden es mejor por", `${fmt(-ahorro)} ${u}`, "negativo") +
        `<p class="nota">El voraz no garantiza el óptimo global.</p>`;
      else veredicto = fila("Diferencia", "ninguna");
      html += `<div class="d-grupo"><div class="d-titulo">Comparación de órdenes</div>
        ${fila("Orden en que elegiste los destinos", `${fmt(r.costoFijo)} ${u}`)}
        ${fila("Orden voraz (más cercano primero)", `${fmt(r.distanciaTotal)} ${u}`)}
        ${veredicto}</div>`;
    }
    $("#comparacion").innerHTML = html;
    $("#entregas").innerHTML = r.entregas.map((e, k) => {
      const n = nodos[e.destino];
      const sig = e.candidatos[1];
      return `<li data-k="${k}">
        <div><div class="nom">${n.id} · ${esc(n.nom)}</div>
        <div class="det">desde ${ids[e.desde]} · ${e.camino.length - 2} nodos intermedios · BF: ${e.iteraciones} iter., ${e.relajaciones} relaj.
        ${sig ? `<br>Elegido sobre ${ids[sig.idx]} (${fmt(sig.dist)} ${unidad()}) — el más cercano de ${e.candidatos.length} pendientes` : ""}</div></div>
        <div class="km">${fmt(e.costo)} ${unidad()}</div></li>`;
    }).join("");
    $$("#entregas li").forEach(li => (li.onclick = () => seleccionarLeg(+li.dataset.k)));
    $("#barra").style.width = "0";
    $("#btnPlay").textContent = "▶ Animar recorrido";
  }

  function seleccionarLeg(k) {
    st.legSel = st.legSel === k ? null : k;
    polisLeg.forEach(({ p, halo }, j) => {
      const on = st.legSel == null || j === st.legSel;
      p.setStyle({ opacity: on ? 0.95 : 0.15, weight: j === st.legSel ? 6 : 4 });
      halo.setStyle({ opacity: on ? 0.8 : 0 });
    });
    $$("#entregas li").forEach((li, j) => li.classList.toggle("activo", j === st.legSel));
    if (st.legSel != null) {
      const e = st.resultado.entregas[k];
      mapa.fitBounds(L.latLngBounds(e.camino.map(i => [nodos[i].lat, nodos[i].lon])), { padding: [60, 60], maxZoom: 16 });
    }
  }

  // ---------------------------------------------------------------- animación
  let anim = null;
  function iconoNum(k, hecho) {
    return L.divIcon({
      className: "", iconSize: [22, 22],
      html: `<div class="num-icono${hecho ? " hecho" : ""}" style="width:22px;height:22px">${hecho ? "✓" : k + 1}</div>`,
    });
  }

  $("#btnPlay").onclick = () => {
    if (!st.resultado || !st.resultado.entregas.length) return;
    if (anim && anim.corriendo) { anim.corriendo = false; $("#btnPlay").textContent = "▶ Continuar"; return; }
    if (!anim || anim.terminado) prepararAnimacion();
    anim.corriendo = true;
    anim.ultimo = performance.now();
    $("#btnPlay").textContent = "⏸ Pausar";
    requestAnimationFrame(paso);
  };

  function prepararAnimacion() {
    detenerAnimacion();
    const r = st.resultado;
    const pts = [], finLeg = [];
    r.entregas.forEach((e, k) => {
      (k === 0 ? e.camino : e.camino.slice(1)).forEach(i => pts.push(L.latLng(nodos[i].lat, nodos[i].lon)));
      finLeg.push(pts.length - 1);
    });
    const acum = [0];
    for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + mapa.distance(pts[i - 1], pts[i]));
    r.marcadoresNum.forEach((m, k) => m.setIcon(iconoNum(k, false)));
    $$("#entregas li").forEach(li => li.classList.remove("hecho"));
    camion = L.marker(pts[0], {
      icon: L.divIcon({ className: "", html: `<div class="camion">🚚</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      zIndexOffset: 2000, interactive: false,
    }).addTo(capaRuta);
    anim = { pts, acum, finLeg, d: 0, total: Math.max(acum[acum.length - 1], 1), hechas: 0, corriendo: false, terminado: false };
  }

  function paso(t) {
    if (!anim || !anim.corriendo) return;
    const dt = Math.min((t - anim.ultimo) / 1000, 0.1);
    anim.ultimo = t;
    const vel = +$("#velocidad").value;                                    // 1..10
    anim.d = Math.min(anim.total, anim.d + (anim.total * vel / 40) * dt);  // vel 1 = 40 s

    let i = 1;
    while (i < anim.acum.length - 1 && anim.acum[i] < anim.d) i++;
    const a = anim.pts[i - 1], b = anim.pts[i] || a;
    const seg = anim.acum[i] - anim.acum[i - 1] || 1;
    const f = Math.min(1, Math.max(0, (anim.d - anim.acum[i - 1]) / seg));
    camion.setLatLng([a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f]);

    while (anim.hechas < anim.finLeg.length && anim.acum[anim.finLeg[anim.hechas]] <= anim.d + 1e-6) {
      const k = anim.hechas++;
      $$("#entregas li")[k]?.classList.add("hecho");
      st.resultado.marcadoresNum[k].setIcon(iconoNum(k, true));
    }
    $("#barra").style.width = `${(anim.d / anim.total) * 100}%`;

    if (anim.d >= anim.total) {
      anim.corriendo = false;
      anim.terminado = true;
      $("#btnPlay").textContent = "↺ Repetir";
      return;
    }
    requestAnimationFrame(paso);
  }

  function detenerAnimacion() {
    if (anim) anim.corriendo = false;
    anim = null;
    if (camion) { capaRuta.removeLayer(camion); camion = null; }
  }

  // ---------------------------------------------------------------- explorar
  function construirTramos() {
    const cont = $("#tramos");
    const opciones = [{ nombre: "Todos (1500)", todos: true }, ...TRAMOS];
    cont.innerHTML = opciones.map((t, k) =>
      `<button data-k="${k}" class="${k === 0 ? "activo" : ""}">${t.todos ? t.nombre : `<span class="punto" style="background:${t.color}"></span>${t.nombre} (${t.ini}–${t.fin})`}</button>`
    ).join("");
    cont.querySelectorAll("button").forEach(b => (b.onclick = () => {
      cont.querySelectorAll("button").forEach(x => x.classList.toggle("activo", x === b));
      const t = opciones[+b.dataset.k];
      st.tramo = t.todos ? null : t;
      refrescarVista();
      if (st.tramo) {
        const mios = tramoInfo(st.tramo).mios;
        mapa.fitBounds(L.latLngBounds(mios.map(i => [nodos[i].lat, nodos[i].lon])), { padding: [20, 20] });
      }
    }));
    $$("#colorPor button").forEach(b => (b.onclick = () => {
      $$("#colorPor button").forEach(x => x.classList.toggle("activo", x === b));
      st.colorPor = b.dataset.color;
      refrescarVista();
    }));
    $("#chkVecinos").onchange = e => { st.vecinos = e.target.checked; refrescarVista(); };
    $("#chkAristas").onchange = e => { st.aristas = e.target.checked; dibujarAristas(); };
    $("#chkMapa").onchange = e => (e.target.checked ? fondo.addTo(mapa) : mapa.removeLayer(fondo));
  }

  function renderLeyenda() {
    let items = [];
    if (st.tramo) items = [[st.tramo.color, `Nodos de ${st.tramo.nombre}`], [C.gris, "Vecinos de otros tramos"]];
    else if (st.colorPor === "tramo") items = TRAMOS.map(t => [t.color, t.nombre]);
    else if (st.colorPor === "comp") items = tamanos.map((n, k) => [PALETA_COMP[Math.min(k, PALETA_COMP.length - 1)], `C${k + 1}: ${n}`]);
    else if (st.colorPor === "zona") items = Object.entries(COLOR_ZONA).map(([z, c]) => [c, `Congestión ${z}`]);
    else items = [["hsl(220,80%,66%)", "grado bajo"], ["hsl(120,80%,58%)", "medio"], ["hsl(20,80%,50%)", "grado ≥ 12"]];
    items.push([C.origen, "Origen"], [C.destino, "Destino"]);
    $("#leyenda").innerHTML = items.map(([c, t]) => `<span><i class="punto" style="background:${c}"></i>${esc(t)}</span>`).join("");
  }

  function renderResumenTramo() {
    const box = $("#resumenTramo");
    if (!st.tramo) {
      box.innerHTML = `<p class="nota">Elige un tramo para ver su subgrafo y el resumen del informe (sección 9 del notebook).</p>`;
      return;
    }
    const info = tramoInfo(st.tramo);
    box.innerHTML = `<div class="etq">Resumen de ${esc(st.tramo.nombre)}</div><table>${info.filas.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${b}</td></tr>`).join("")}</table>`;
  }

  // ---------------------------------------------------------------- conectividad
  function construirConectividad() {
    $("#cNodos").textContent = nodos.length;
    $("#cAristas").textContent = aristas.length;
    $("#cComp").textContent = tamanos.length;
    const ul = $("#listaComp");
    ul.innerHTML = tamanos.map((n, k) => {
      const distritos = [...new Set(nodos.filter((_, i) => compDe[i] === k).map(x => x.dis))].slice(0, 3).join(", ");
      return `<li data-k="${k}"><span><span class="punto" style="background:${PALETA_COMP[Math.min(k, PALETA_COMP.length - 1)]}"></span>
        Componente ${k + 1}<br><small class="nota">${esc(distritos)}</small></span><b>${n} nodos</b></li>`;
    }).join("");
    ul.querySelectorAll("li").forEach(li => (li.onclick = () => {
      const k = +li.dataset.k;
      st.compSel = st.compSel === k ? null : k;
      ul.querySelectorAll("li").forEach(x => x.classList.toggle("activo", +x.dataset.k === st.compSel));
      pintarNodos();
      if (st.compSel != null) {
        mapa.fitBounds(L.latLngBounds(nodos.filter((_, i) => compDe[i] === k).map(n => [n.lat, n.lon])), { padding: [60, 60], maxZoom: 15 });
      }
    }));
  }

  // ---------------------------------------------------------------- pestañas
  $$(".tab").forEach(b => (b.onclick = () => {
    if (!nodos) return;
    $$(".tab").forEach(x => x.classList.toggle("activo", x === b));
    $$(".vista").forEach(v => v.classList.toggle("activo", v.id === "tab-" + b.dataset.tab));
    st.tab = b.dataset.tab;
    if (st.tab !== "conect" && st.compSel != null) {
      st.compSel = null; $$("#listaComp li").forEach(x => x.classList.remove("activo"));
    }
    refrescarVista();
  }));
})();
