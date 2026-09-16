/* Geoportal de Tigre — todo se define en data/config.json */
(function () {
  "use strict";

  const RAMPA = ["#F1EBDC", "#C9D8C2", "#8DB8A9", "#4E8F8E", "#16525A"];
  const RAMPA_OSCURA = ["#2E3B32", "#3F6454", "#5E9282", "#8DC3B5", "#CDEDE4"];
  const CATEGORICA = ["#16525A", "#C9A46A", "#6F8A3E", "#B5566B", "#5B6FA8", "#D98C3A", "#7D5BA6", "#4F9E8F"];
  const GRIS = "#9AA5A4";

  const $ = (id) => document.getElementById(id);
  const oscuro = () => window.matchMedia("(prefers-color-scheme: dark)").matches &&
    document.documentElement.dataset.theme !== "light";

  const estado = {
    config: null,
    mapa: null,
    capas: new Map(),       // id -> { def, datos, capa, stats, error }
    explorar: { capaId: null, campo: null, rango: null, categorias: null },
    seleccion: null,        // { id, capaLeaflet }
    indiceBusqueda: [],
    prueba: null
  };

  // ---------- utilidades ----------
  const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const esNumero = (v) => v !== null && v !== "" && isFinite(Number(v));
  const escapar = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function formatear(v, variable) {
    if (!esNumero(v)) return v === null || v === undefined || v === "" ? "Sin dato" : escapar(v);
    const dec = variable && variable.decimales !== undefined ? variable.decimales : 2;
    const txt = Number(v).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec });
    return variable && variable.unidad ? `${txt} ${escapar(variable.unidad)}` : txt;
  }

  function avisar(msg) {
    const el = $("aviso");
    el.textContent = msg;
    el.hidden = !msg;
  }

  function cuantiles(valores, n) {
    const v = [...valores].sort((a, b) => a - b);
    const cortes = [];
    for (let i = 1; i < n; i++) {
      const pos = (v.length - 1) * (i / n);
      const b = Math.floor(pos);
      cortes.push(v[b] + (v[Math.min(b + 1, v.length - 1)] - v[b]) * (pos - b));
    }
    return cortes;
  }

  function calcularStats(def, datos) {
    const stats = {};
    (def.variables || []).forEach((variable) => {
      const vals = datos.features.map((f) => f.properties[variable.campo]);
      if (variable.tipo === "categoria") {
        const conteos = new Map();
        vals.forEach((x) => {
          const k = x === null || x === undefined || x === "" ? "Sin dato" : String(x);
          conteos.set(k, (conteos.get(k) || 0) + 1);
        });
        const cats = [...conteos.keys()].sort((a, b) => a.localeCompare(b, "es"));
        const colores = {};
        cats.forEach((c, i) => { colores[c] = c === "Sin dato" ? GRIS : CATEGORICA[i % CATEGORICA.length]; });
        stats[variable.campo] = { tipo: "categoria", cats, conteos, colores };
        return;
      }
      const nums = vals.filter(esNumero).map(Number);
      if (!nums.length) { stats[variable.campo] = { tipo: "vacio" }; return; }
      const min = Math.min(...nums), max = Math.max(...nums);
      const unicos = new Set(nums).size;
      const n = Math.max(1, Math.min(def.clases || 5, unicos, 5));
      let cortes;
      if ((def.clasificacion || "cuantiles") === "intervalos") {
        cortes = Array.from({ length: n - 1 }, (_, i) => min + ((max - min) * (i + 1)) / n);
      } else {
        cortes = cuantiles(nums, n);
      }
      cortes = [...new Set(cortes.map((c) => +c.toFixed(10)))].filter((c) => c > min && c < max);
      const ordenados = [...nums].sort((a, b) => b - a);
      stats[variable.campo] = { tipo: "numero", min, max, cortes, nums, ordenados };
    });
    return stats;
  }

  function colorDeClase(i, total) {
    const rampa = oscuro() ? RAMPA_OSCURA : RAMPA;
    if (total <= 1) return rampa[rampa.length - 1];
    return rampa[Math.round((i * (rampa.length - 1)) / (total - 1))];
  }

  function claseDe(valor, cortes) {
    let i = 0;
    while (i < cortes.length && valor > cortes[i]) i++;
    return i;
  }

  // ---------- estilos ----------
  function estiloBase(def) {
    const e = def.estilo || {};
    return {
      color: e.color || "#16525A",
      weight: e.grosor ?? (def.geometria === "linea" ? 2.5 : 1.5),
      opacity: e.opacidad ?? 0.95,
      fillColor: e.relleno || e.color || "#16525A",
      fillOpacity: e.opacidadRelleno ?? (def.geometria === "punto" ? 0.9 : 0.2),
      radius: e.radio ?? 6
    };
  }

  function estiloElemento(def, feature) {
    const base = estiloBase(def);
    const ex = estado.explorar;
    if (ex.capaId !== def.id || !ex.campo) return base;
    const st = estado.capas.get(def.id).stats[ex.campo];
    const v = feature.properties[ex.campo];

    if (st.tipo === "categoria") {
      const k = v === null || v === undefined || v === "" ? "Sin dato" : String(v);
      if (!ex.categorias.has(k)) return apagado(base, def);
      return { ...base, fillColor: st.colores[k], fillOpacity: 0.78, color: bordeDato(def), weight: def.geometria === "linea" ? 3 : 0.8, ...(def.geometria === "linea" ? { color: st.colores[k] } : {}) };
    }
    if (st.tipo !== "numero" || !esNumero(v)) return apagado(base, def);
    const n = Number(v);
    if (ex.rango && (n < ex.rango[0] || n > ex.rango[1])) return apagado(base, def);
    const col = colorDeClase(claseDe(n, st.cortes), st.cortes.length + 1);
    if (def.geometria === "linea") return { ...base, color: col, weight: 3.5 };
    return { ...base, fillColor: col, fillOpacity: 0.82, color: bordeDato(def), weight: 0.8 };
  }

  const bordeDato = () => (oscuro() ? "#0E1A1A" : "#FFFFFF");

  function apagado(base, def) {
    return { ...base, color: GRIS, weight: def.geometria === "linea" ? 1 : 0.6, dashArray: "3 3", fillColor: GRIS, fillOpacity: 0.06, opacity: 0.6 };
  }

  function repintar(id) {
    const c = estado.capas.get(id);
    if (!c || !c.capa) return;
    c.capa.eachLayer((l) => {
      l.setStyle(estiloElemento(c.def, l.feature));
      if (estado.seleccion && estado.seleccion.capaLeaflet === l) resaltar(l);
    });
  }

  function resaltar(l) {
    l.setStyle({ weight: 4, color: getComputedStyle(document.documentElement).getPropertyValue("--limo").trim() || "#9A6B2F", opacity: 1, dashArray: null });
    if (l.bringToFront) l.bringToFront();
  }

  // ---------- mapa ----------
  function crearMapa(cfg) {
    const v = cfg.vista || { centro: [-34.40, -58.60], zoom: 11 };
    const mapa = L.map("mapa", {
      center: v.centro, zoom: v.zoom, minZoom: 9, zoomControl: false,
      maxBounds: cfg.limitesNavegacion || null, maxBoundsViscosity: 0.8
    });
    L.control.zoom({ position: "bottomright", zoomInTitle: "Acercar", zoomOutTitle: "Alejar" }).addTo(mapa);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(mapa);
    mapa.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

    const bases = {};
    let inicial = null;
    (cfg.mapasBase || []).forEach((b, i) => {
      const t = L.tileLayer(b.url, { attribution: b.atribucion || "", maxZoom: b.zoomMaximo || 19, subdomains: b.subdominios || "abc" });
      bases[b.nombre] = t;
      if (b.inicial || (!inicial && i === 0)) inicial = t;
    });
    if (inicial) inicial.addTo(mapa);
    if (Object.keys(bases).length > 1) L.control.layers(bases, null, { position: "topleft" }).addTo(mapa);

    mapa.createPane("poligonos").style.zIndex = 410;
    mapa.createPane("lineas").style.zIndex = 420;
    mapa.createPane("puntos").style.zIndex = 430;
    mapa.createPane("prueba").style.zIndex = 440;

    mapa.on("click", () => cerrarFicha());
    mapa.on("moveend", guardarEnUrl);
    return mapa;
  }

  function paneDe(def) {
    return def.geometria === "punto" ? "puntos" : def.geometria === "linea" ? "lineas" : "poligonos";
  }

  async function cargarCapa(def) {
    const registro = { def, datos: null, capa: null, stats: {}, error: null };
    estado.capas.set(def.id, registro);
    try {
      const r = await fetch(def.archivo, { cache: "no-cache" });
      if (!r.ok) throw new Error(`respuesta ${r.status}`);
      registro.datos = await r.json();
      if (!registro.datos.features) throw new Error("el archivo no es un FeatureCollection");
      registro.stats = calcularStats(def, registro.datos);
      registro.capa = L.geoJSON(registro.datos, {
        pane: paneDe(def),
        style: (f) => estiloElemento(def, f),
        pointToLayer: (f, ll) => L.circleMarker(ll, { ...estiloElemento(def, f), pane: "puntos" }),
        onEachFeature: (f, l) => {
          l.on("click", (e) => { L.DomEvent.stopPropagation(e); seleccionar(def.id, l); });
          const t = tituloDe(def, f);
          if (t) l.bindTooltip(escapar(t), { sticky: true, direction: "top", opacity: 0.95 });
        }
      });
      indexar(def, registro);
    } catch (err) {
      registro.error = `No se pudo cargar ${def.archivo} (${err.message}). Revisá que el archivo exista y que la ruta en config.json sea la correcta.`;
      console.error(err);
    }
    return registro;
  }

  function tituloDe(def, f) {
    const p = f.properties || {};
    return p[def.titulo] ?? p[def.busqueda] ?? p.nombre ?? p.name ?? "";
  }

  // La primera capa de config.json queda arriba de todo
  function ordenarCapas() {
    [...estado.config.capas].reverse().forEach((def) => {
      const reg = estado.capas.get(def.id);
      if (reg && reg.capa && estado.mapa.hasLayer(reg.capa)) reg.capa.bringToFront();
    });
  }

  // ---------- lista de capas ----------
  function dibujarListaCapas() {
    const cont = $("listaCapas");
    cont.innerHTML = "";
    const grupos = new Map();
    estado.config.capas.forEach((def) => {
      const g = def.grupo || "Otras capas";
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(def);
    });
    grupos.forEach((defs, nombre) => {
      const div = document.createElement("div");
      div.className = "grupo-capas";
      div.innerHTML = grupos.size > 1 || nombre !== "Otras capas" ? `<h3>${escapar(nombre)}</h3>` : "";
      defs.forEach((def) => {
        const reg = estado.capas.get(def.id);
        const b = estiloBase(def);
        const fila = document.createElement("div");
        fila.className = "capa";
        const idc = `capa-${def.id}`;
        const tipoMuestra = def.geometria === "punto" ? "punto" : def.geometria === "linea" ? "linea" : "";
        const fondo = def.geometria === "linea" ? "transparent" : b.fillColor;
        fila.innerHTML = `
          <input type="checkbox" id="${idc}" ${reg.capa && estado.mapa.hasLayer(reg.capa) ? "checked" : ""} ${reg.error ? "disabled" : ""}>
          <span class="muestra ${tipoMuestra}" style="border-color:${b.color};background:${fondo}"></span>
          <label for="${idc}">${escapar(def.nombre)}</label>
          ${reg.error ? "" : `<a href="${escapar(def.archivo)}" download title="Descargar ${escapar(def.nombre)} en GeoJSON">Descargar</a>`}
          ${reg.error ? `<span class="error">${escapar(reg.error)}</span>` : ""}`;
        const chk = fila.querySelector("input");
        chk.addEventListener("change", () => alternarCapa(def.id, chk.checked));
        div.appendChild(fila);
      });
      cont.appendChild(div);
    });
  }

  function alternarCapa(id, visible) {
    const reg = estado.capas.get(id);
    if (!reg || !reg.capa) return;
    if (visible) { reg.capa.addTo(estado.mapa); ordenarCapas(); }
    else {
      estado.mapa.removeLayer(reg.capa);
      if (estado.seleccion && estado.seleccion.id === id) cerrarFicha();
    }
    const chk = $(`capa-${id}`);
    if (chk) chk.checked = visible;
  }

  // ---------- explorar datos ----------
  function prepararExplorar() {
    const conVars = estado.config.capas.filter((d) => d.variables && d.variables.length && estado.capas.get(d.id).datos);
    if (!conVars.length) return;
    $("seccionExplorar").hidden = false;
    const selCapa = $("selCapa");
    selCapa.innerHTML = `<option value="">Ninguna</option>` +
      conVars.map((d) => `<option value="${escapar(d.id)}">${escapar(d.nombre)}</option>`).join("");
    selCapa.addEventListener("change", () => elegirCapa(selCapa.value));
    $("selVariable").addEventListener("change", (e) => elegirVariable(e.target.value));
  }

  function elegirCapa(id, campo) {
    const anterior = estado.explorar.capaId;
    estado.explorar = { capaId: id || null, campo: null, rango: null, categorias: null };
    if (anterior) repintar(anterior);
    const selVar = $("selVariable");
    $("selCapa").value = id || "";
    if (!id) {
      selVar.innerHTML = "";
      selVar.disabled = true;
      $("leyenda").innerHTML = "";
      $("descVariable").textContent = "";
      $("fuenteVariable").textContent = "";
      guardarEnUrl();
      return;
    }
    const def = estado.capas.get(id).def;
    alternarCapa(id, true);
    selVar.disabled = false;
    selVar.innerHTML = def.variables.map((v) => `<option value="${escapar(v.campo)}">${escapar(v.nombre)}</option>`).join("");
    $("fuenteVariable").textContent = def.fuente ? `Fuente: ${def.fuente}` : "";
    elegirVariable(campo && def.variables.some((v) => v.campo === campo) ? campo : def.variables[0].campo);
  }

  function elegirVariable(campo, rango) {
    const ex = estado.explorar;
    const reg = estado.capas.get(ex.capaId);
    const variable = reg.def.variables.find((v) => v.campo === campo);
    const st = reg.stats[campo];
    ex.campo = campo;
    $("selVariable").value = campo;
    $("descVariable").textContent = variable.descripcion || "";
    if (st.tipo === "categoria") {
      ex.rango = null;
      ex.categorias = new Set(st.cats);
    } else if (st.tipo === "numero") {
      ex.categorias = null;
      ex.rango = rango && rango.length === 2 ? rango : [st.min, st.max];
    }
    dibujarLeyenda();
    repintar(ex.capaId);
    if (estado.seleccion) mostrarFicha(estado.seleccion.id, estado.seleccion.capaLeaflet);
    guardarEnUrl();
  }

  function dibujarLeyenda() {
    const ex = estado.explorar;
    const reg = estado.capas.get(ex.capaId);
    const variable = reg.def.variables.find((v) => v.campo === ex.campo);
    const st = reg.stats[ex.campo];
    const cont = $("leyenda");
    const total = reg.datos.features.length;

    if (st.tipo === "vacio") {
      cont.innerHTML = `<p class="nota">Esta variable no tiene valores numéricos en la capa. Revisá el nombre del campo en config.json.</p>`;
      return;
    }

    if (st.tipo === "categoria") {
      cont.innerHTML = `<ul class="clases">${st.cats.map((c, i) => `
        <li><label><input type="checkbox" data-cat="${i}" checked>
          <span class="sw" style="background:${st.colores[c]}"></span>${escapar(c)}
          <span class="n">${st.conteos.get(c)}</span></label></li>`).join("")}</ul>
        <p class="conteo" id="conteo"></p>`;
      cont.querySelectorAll("input[data-cat]").forEach((chk) => {
        chk.checked = ex.categorias.has(st.cats[+chk.dataset.cat]);
        chk.addEventListener("change", () => {
          const c = st.cats[+chk.dataset.cat];
          chk.checked ? ex.categorias.add(c) : ex.categorias.delete(c);
          repintar(ex.capaId);
          actualizarConteo();
          guardarEnUrl();
        });
      });
      actualizarConteo();
      return;
    }

    // Numérica: histograma + clases + filtro por rango
    const nClases = st.cortes.length + 1;
    const limites = [st.min, ...st.cortes, st.max];
    const W = 300, H = 74;
    const nBins = Math.max(4, Math.min(24, Math.ceil(Math.sqrt(st.nums.length)) * 2));
    const ancho = (st.max - st.min) / nBins || 1;
    const bins = new Array(nBins).fill(0);
    st.nums.forEach((x) => { bins[Math.min(nBins - 1, Math.floor((x - st.min) / ancho))]++; });
    const maxBin = Math.max(...bins);
    const bw = W / nBins;
    const barras = bins.map((c, i) => {
      const medio = st.min + ancho * (i + 0.5);
      const h = c ? Math.max(3, (c / maxBin) * (H - 4)) : 0;
      return `<rect class="barra" data-desde="${st.min + ancho * i}" data-hasta="${st.min + ancho * (i + 1)}"
        x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}"
        fill="${colorDeClase(claseDe(medio, st.cortes), nClases)}" stroke="var(--borde)" stroke-width="0.5"><title>${c} elemento(s)</title></rect>`;
    }).join("");
    const paso = (st.max - st.min) / 200 || 1;

    cont.innerHTML = `
      <svg class="histograma" viewBox="0 0 ${W} ${H + 2}" role="img" aria-label="Distribución de ${escapar(variable.nombre)}">
        ${barras}<line x1="0" x2="${W}" y1="${H + 1}" y2="${H + 1}" stroke="var(--apagado)"/>
      </svg>
      <div class="doble-rango">
        <input type="range" id="rangoMin" min="${st.min}" max="${st.max}" step="${paso}" value="${ex.rango[0]}" aria-label="Valor mínimo">
        <input type="range" id="rangoMax" min="${st.min}" max="${st.max}" step="${paso}" value="${ex.rango[1]}" aria-label="Valor máximo">
      </div>
      <div class="rango-valores"><span id="valMin"></span><span id="valMax"></span></div>
      <p class="conteo" id="conteo"></p>
      <ul class="clases">${limites.slice(0, -1).map((a, i) => `
        <li><span class="sw" style="background:${colorDeClase(i, nClases)}"></span>
          ${formatear(a, variable)} a ${formatear(limites[i + 1], variable)}
          <span class="n">${st.nums.filter((x) => claseDe(x, st.cortes) === i).length}</span></li>`).join("")}
      </ul>`;

    const rMin = $("rangoMin"), rMax = $("rangoMax");
    const alMover = () => {
      let a = +rMin.value, b = +rMax.value;
      if (a > b) { [a, b] = [b, a]; }
      // los extremos del control se ajustan al valor real para no perder elementos por redondeo
      ex.rango = [a <= st.min + paso / 2 ? st.min : a, b >= st.max - paso / 2 ? st.max : b];
      actualizarRango(variable, st);
      repintar(ex.capaId);
    };
    rMin.addEventListener("input", alMover);
    rMax.addEventListener("input", alMover);
    rMin.addEventListener("change", guardarEnUrl);
    rMax.addEventListener("change", guardarEnUrl);
    actualizarRango(variable, st);
  }

  function actualizarRango(variable, st) {
    const [a, b] = estado.explorar.rango;
    $("valMin").innerHTML = formatear(a, variable);
    $("valMax").innerHTML = formatear(b, variable);
    document.querySelectorAll(".histograma .barra").forEach((r) => {
      r.classList.toggle("fuera", +r.dataset.hasta < a || +r.dataset.desde > b);
    });
    actualizarConteo();
  }

  function actualizarConteo() {
    const ex = estado.explorar;
    const reg = estado.capas.get(ex.capaId);
    const st = reg.stats[ex.campo];
    const feats = reg.datos.features;
    let visibles, filtrado;
    if (st.tipo === "categoria") {
      visibles = feats.filter((f) => ex.categorias.has(f.properties[ex.campo] == null || f.properties[ex.campo] === "" ? "Sin dato" : String(f.properties[ex.campo]))).length;
      filtrado = ex.categorias.size < st.cats.length;
    } else {
      visibles = feats.filter((f) => esNumero(f.properties[ex.campo]) && +f.properties[ex.campo] >= ex.rango[0] && +f.properties[ex.campo] <= ex.rango[1]).length;
      filtrado = ex.rango[0] > st.min || ex.rango[1] < st.max;
    }
    const el = $("conteo");
    el.innerHTML = `${visibles} de ${feats.length} elementos resaltados` +
      (filtrado ? ` <button type="button" class="boton" id="quitarFiltro">Quitar filtro</button>` : "");
    const q = $("quitarFiltro");
    if (q) q.addEventListener("click", () => elegirVariable(ex.campo));
  }

  // ---------- ficha ----------
  function seleccionar(id, l) {
    if (estado.seleccion) {
      const prev = estado.seleccion;
      const regPrev = estado.capas.get(prev.id);
      if (regPrev && prev.capaLeaflet.setStyle) prev.capaLeaflet.setStyle(estiloElemento(regPrev.def, prev.capaLeaflet.feature));
    }
    estado.seleccion = { id, capaLeaflet: l };
    if (l.setStyle) resaltar(l);
    mostrarFicha(id, l);
    cerrarPanelMovil();
  }

  function mostrarFicha(id, l) {
    const reg = estado.capas.get(id);
    const def = reg.def;
    const p = l.feature.properties || {};
    const campos = def.campos || Object.fromEntries(Object.keys(p).map((k) => [k, k]));
    const vars = Object.fromEntries((def.variables || []).map((v) => [v.campo, v]));

    const filas = Object.entries(campos).map(([k, alias]) =>
      `<dt>${escapar(alias)}</dt><dd>${formatear(p[k], vars[k])}</dd>`).join("");

    const numericas = (def.variables || []).filter((v) => reg.stats[v.campo] && reg.stats[v.campo].tipo === "numero");
    let comparacion = "";
    if (numericas.length && reg.datos.features.length > 1) {
      comparacion = `<div class="comparacion"><h3>Frente al resto de ${escapar(def.nombre.toLowerCase())}</h3>` +
        numericas.map((v) => {
          const st = reg.stats[v.campo];
          const x = p[v.campo];
          if (!esNumero(x)) return `<div class="comp-item"><div class="fila"><span>${escapar(v.nombre)}</span><span class="puesto">Sin dato</span></div></div>`;
          const pos = st.max > st.min ? ((x - st.min) / (st.max - st.min)) * 100 : 50;
          const puesto = st.ordenados.indexOf(Number(x)) + 1;
          return `<div class="comp-item"><div class="fila"><span>${escapar(v.nombre)}</span>
            <span class="puesto">${puesto}.º de ${st.ordenados.length}</span></div>
            <div class="pista" title="Mínimo ${formatear(st.min, v)}, máximo ${formatear(st.max, v)}"><span style="left:${pos.toFixed(1)}%"></span></div></div>`;
        }).join("") + `</div>`;
    }

    $("fichaContenido").innerHTML = `
      <h2>${escapar(tituloDe(def, l.feature) || def.nombre)}</h2>
      <p class="capa-origen">${escapar(def.nombre)}</p>
      <dl>${filas}</dl>${comparacion}`;
    $("ficha").hidden = false;
  }

  function cerrarFicha() {
    if (estado.seleccion) {
      const { id, capaLeaflet } = estado.seleccion;
      const reg = estado.capas.get(id);
      if (reg && capaLeaflet.setStyle) capaLeaflet.setStyle(estiloElemento(reg.def, capaLeaflet.feature));
    }
    estado.seleccion = null;
    $("ficha").hidden = true;
  }

  // Encuadra dejando lugar a la ficha cuando está abierta en escritorio
  function encuadrar(bounds) {
    const escritorio = window.innerWidth > 760;
    const derecha = escritorio && !$("ficha").hidden ? $("ficha").offsetWidth + 24 : 30;
    const abajo = !escritorio && !$("ficha").hidden ? $("ficha").offsetHeight + 90 : 30;
    estado.mapa.fitBounds(bounds, { maxZoom: 16, paddingTopLeft: [30, 30], paddingBottomRight: [derecha, abajo] });
  }

  // ---------- búsqueda ----------
  function indexar(def, reg) {
    if (!def.busqueda) return;
    reg.capa.eachLayer((l) => {
      const txt = l.feature.properties[def.busqueda];
      if (txt !== null && txt !== undefined && txt !== "") {
        estado.indiceBusqueda.push({ texto: String(txt), norm: normalizar(txt), id: def.id, capa: def.nombre, l });
      }
    });
  }

  function prepararBusqueda() {
    const input = $("busqueda"), lista = $("resultados");
    let actual = [], activo = -1;
    const cerrar = () => { lista.hidden = true; input.setAttribute("aria-expanded", "false"); activo = -1; };
    const ir = (r) => {
      alternarCapa(r.id, true);
      seleccionar(r.id, r.l);
      if (r.l.getBounds) encuadrar(r.l.getBounds());
      else estado.mapa.setView(r.l.getLatLng(), 16);
      input.value = r.texto;
      cerrar();
    };
    const pintar = () => {
      lista.innerHTML = actual.length
        ? actual.map((r, i) => `<li role="option" id="res-${i}" aria-selected="${i === activo}">${escapar(r.texto)}<small>${escapar(r.capa)}</small></li>`).join("")
        : `<li class="vacio">Sin resultados. Probá con otra palabra.</li>`;
      lista.hidden = false;
      input.setAttribute("aria-expanded", "true");
      lista.querySelectorAll("li[role=option]").forEach((li, i) => li.addEventListener("mousedown", (e) => { e.preventDefault(); ir(actual[i]); }));
    };
    input.addEventListener("input", () => {
      const q = normalizar(input.value.trim());
      if (q.length < 2) return cerrar();
      actual = estado.indiceBusqueda.filter((r) => r.norm.includes(q))
        .sort((a, b) => a.norm.indexOf(q) - b.norm.indexOf(q)).slice(0, 8);
      activo = -1;
      pintar();
    });
    input.addEventListener("keydown", (e) => {
      if (lista.hidden) return;
      if (e.key === "ArrowDown") { activo = Math.min(actual.length - 1, activo + 1); pintar(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { activo = Math.max(0, activo - 1); pintar(); e.preventDefault(); }
      else if (e.key === "Enter" && actual.length) { ir(actual[Math.max(0, activo)]); e.preventDefault(); }
      else if (e.key === "Escape") cerrar();
    });
    input.addEventListener("blur", () => setTimeout(cerrar, 100));
  }

  // ---------- estado en la URL (para compartir una vista) ----------
  function guardarEnUrl() {
    if (!estado.mapa) return;
    const c = estado.mapa.getCenter();
    const ps = new URLSearchParams();
    ps.set("z", estado.mapa.getZoom());
    ps.set("c", `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`);
    const ex = estado.explorar;
    if (ex.capaId && ex.campo) {
      ps.set("capa", ex.capaId);
      ps.set("var", ex.campo);
      const st = estado.capas.get(ex.capaId).stats[ex.campo];
      if (ex.rango && st && (ex.rango[0] > st.min || ex.rango[1] < st.max)) ps.set("rango", ex.rango.map((x) => +x.toPrecision(8)).join(","));
    }
    history.replaceState(null, "", `${location.pathname}${location.search}#${ps.toString()}`);
  }

  function leerUrl() {
    const ps = new URLSearchParams(location.hash.slice(1));
    const z = ps.get("z"), c = ps.get("c");
    if (z && c) {
      const [lat, lng] = c.split(",").map(Number);
      if (isFinite(lat) && isFinite(lng)) estado.mapa.setView([lat, lng], Number(z));
    }
    const capa = ps.get("capa");
    if (capa && estado.capas.get(capa) && estado.capas.get(capa).datos && $("selCapa").querySelector(`option[value="${CSS.escape(capa)}"]`)) {
      elegirCapa(capa, ps.get("var"));
      const r = ps.get("rango");
      if (r) {
        const rango = r.split(",").map(Number);
        if (rango.every(isFinite)) elegirVariable(estado.explorar.campo, rango);
      }
    }
  }

  // ---------- panel en celulares ----------
  function cerrarPanelMovil() { $("panel").classList.remove("abierto"); }
  function prepararPanelMovil() {
    $("abrirPanel").addEventListener("click", () => { $("panel").classList.add("abierto"); $("busqueda").focus({ preventScroll: true }); });
    $("cerrarPanel").addEventListener("click", cerrarPanelMovil);
    $("cerrarFicha").addEventListener("click", cerrarFicha);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { cerrarFicha(); cerrarPanelMovil(); } });
  }

  // ---------- modo equipo: probar una capa antes de publicarla ----------
  const MOJIBAKE = /Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â€/;
  function repararTexto(s) {
    if (typeof s !== "string" || !MOJIBAKE.test(s)) return s;
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  function recorrerCoords(geom, fn) {
    if (!geom) return;
    if (geom.type === "GeometryCollection") return geom.geometries.forEach((g) => recorrerCoords(g, fn));
    const rec = (c) => (typeof c[0] === "number" ? fn(c) : c.forEach(rec));
    rec(geom.coordinates);
  }

  function prepararEquipo() {
    if (!new URLSearchParams(location.search).has("equipo")) return;
    $("seccionEquipo").hidden = false;
    $("archivoPrueba").addEventListener("change", async (e) => {
      const archivo = e.target.files[0];
      if (!archivo) return;
      let datos;
      try { datos = JSON.parse(await archivo.text()); }
      catch (err) { return informar(`<p class="alerta">El archivo no es un JSON válido. Exportalo de nuevo desde QGIS con formato GeoJSON.</p>`); }
      analizarPrueba(archivo.name, datos);
      e.target.value = "";
    });
  }

  function informar(html) { $("informePrueba").innerHTML = `<div class="informe">${html}</div>`; }

  function analizarPrueba(nombre, datos) {
    if (!datos || datos.type !== "FeatureCollection" || !Array.isArray(datos.features)) {
      return informar(`<p class="alerta">El archivo no es un FeatureCollection de GeoJSON.</p>`);
    }
    const checks = [];
    const tipos = new Set(datos.features.map((f) => f.geometry && f.geometry.type).filter(Boolean));
    let fueraDeRango = false, lejos = 0, total = 0;
    datos.features.forEach((f) => recorrerCoords(f.geometry, ([x, y]) => {
      total++;
      if (Math.abs(x) > 180 || Math.abs(y) > 90) fueraDeRango = true;
      else if (x < -59.5 || x > -57.8 || y < -35 || y > -33.8) lejos++;
    }));
    if (fueraDeRango) checks.push(`<li class="alerta">Las coordenadas no están en grados. En QGIS elegí SRC EPSG:4326 (WGS 84) al exportar.</li>`);
    else if (total && lejos / total > 0.5) checks.push(`<li class="alerta">La mayor parte de la capa cae fuera de la zona de Tigre. Revisá el sistema de referencia.</li>`);
    else checks.push(`<li class="ok">Coordenadas en WGS 84 dentro de la zona.</li>`);

    const crs = datos.crs && datos.crs.properties && datos.crs.properties.name;
    if (crs && !/CRS84|4326/.test(crs)) checks.push(`<li class="alerta">El archivo declara el SRC ${escapar(crs)}. Exportalo en EPSG:4326.</li>`);

    let rotos = 0;
    datos.features.forEach((f) => Object.entries(f.properties || {}).forEach(([k, v]) => {
      if (MOJIBAKE.test(k) || (typeof v === "string" && MOJIBAKE.test(v))) rotos++;
    }));
    if (rotos) checks.push(`<li class="alerta">Hay ${rotos} textos con acentos rotos (por ejemplo "Ã³" en lugar de "ó").</li>`);

    const kb = Math.max(1, Math.round(new Blob([JSON.stringify(datos)]).size / 1024));
    checks.push(kb > 5000
      ? `<li class="alerta">Pesa ${kb.toLocaleString("es-AR")} KB. Simplificá geometrías o bajá la precisión a 6 decimales para que cargue rápido.</li>`
      : `<li class="ok">Pesa ${kb.toLocaleString("es-AR")} KB.</li>`);

    // campos y tipos
    const props = datos.features.map((f) => f.properties || {});
    const claves = [...new Set(props.flatMap((p) => Object.keys(p)))];
    const info = claves.map((k) => {
      const vals = props.map((p) => p[k]).filter((v) => v !== null && v !== undefined && v !== "");
      const numerico = vals.length > 0 && vals.every(esNumero);
      return { k, numerico, unicos: new Set(vals).size };
    });
    const texto = info.filter((c) => !c.numerico).sort((a, b) => b.unicos - a.unicos)[0];
    const categorias = info.filter((c) => !c.numerico && c !== texto && c.unicos > 1 && c.unicos <= 8);
    const geometria = [...tipos].some((t) => /Point/.test(t)) ? "punto" : [...tipos].some((t) => /Line/.test(t)) ? "linea" : "poligono";
    const id = normalizar(nombre.replace(/\.(geo)?json$/i, "")).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

    const fragmento = {
      id, nombre: nombre.replace(/\.(geo)?json$/i, "").replace(/[_-]+/g, " "),
      grupo: "Otras capas", archivo: `data/${nombre}`, geometria, visible: false,
      ...(texto ? { titulo: texto.k, busqueda: texto.k } : {}),
      fuente: "",
      estilo: geometria === "punto" ? { color: "#FFFFFF", relleno: "#16525A", radio: 6, grosor: 1.5 } : { color: "#16525A", relleno: "#8DB8A9", opacidadRelleno: 0.2 },
      campos: Object.fromEntries(claves.map((k) => [k, k])),
      variables: [
        ...info.filter((c) => c.numerico && c.unicos > 1).map((c) => ({ campo: c.k, nombre: c.k, decimales: 2 })),
        ...categorias.map((c) => ({ campo: c.k, nombre: c.k, tipo: "categoria" }))
      ]
    };
    if (!fragmento.variables.length) delete fragmento.variables;
    const textoFragmento = JSON.stringify(fragmento, null, 2);

    informar(`
      <p><strong>${escapar(nombre)}</strong>: ${datos.features.length} elementos (${escapar([...tipos].join(", ") || "sin geometría")}).</p>
      <ul>${checks.join("")}</ul>
      <p>Campos: ${info.map((c) => `${escapar(c.k)} <small>(${c.numerico ? "número" : "texto"})</small>`).join(", ")}</p>
      <p>Bloque sugerido para agregar a <code>capas</code> en config.json:</p>
      <pre id="fragmento">${escapar(textoFragmento)}</pre>
      <div class="acciones">
        <button type="button" class="boton" id="copiarFragmento">Copiar bloque</button>
        ${rotos ? `<button type="button" class="boton" id="repararAcentos">Reparar acentos y descargar</button>` : ""}
        <button type="button" class="boton" id="quitarPrueba">Quitar del mapa</button>
      </div>`);

    // dibujar en el mapa
    if (estado.prueba) estado.mapa.removeLayer(estado.prueba);
    estado.prueba = L.geoJSON(datos, {
      pane: "prueba",
      style: (f) => /Point/.test(f.geometry && f.geometry.type)
        ? { radius: 6, color: "#FFFFFF", weight: 1.5, fillColor: "#D98C3A", fillOpacity: 0.9 }
        : { color: "#D98C3A", weight: 2, dashArray: "5 4", fillOpacity: 0.12 },
      pointToLayer: (f, ll) => L.circleMarker(ll, { pane: "prueba" }),
      onEachFeature: (f, l) => l.bindPopup(`<dl style="margin:0">${Object.entries(f.properties || {}).map(([k, v]) => `<dt><b>${escapar(k)}</b></dt><dd style="margin:0 0 4px">${escapar(v)}</dd>`).join("")}</dl>`)
    }).addTo(estado.mapa);
    if (!fueraDeRango && total) encuadrar(estado.prueba.getBounds());

    $("copiarFragmento").addEventListener("click", async (ev) => {
      try { await navigator.clipboard.writeText(textoFragmento); ev.target.textContent = "Bloque copiado"; }
      catch (err) { ev.target.textContent = "Seleccioná el bloque y copialo a mano"; }
    });
    $("quitarPrueba").addEventListener("click", () => { estado.mapa.removeLayer(estado.prueba); estado.prueba = null; $("informePrueba").innerHTML = ""; });
    const rep = $("repararAcentos");
    if (rep) rep.addEventListener("click", () => {
      const limpio = { ...datos, features: datos.features.map((f) => ({
        ...f, properties: Object.fromEntries(Object.entries(f.properties || {}).map(([k, v]) => [repararTexto(k), repararTexto(v)]))
      })) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(limpio)], { type: "application/geo+json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      analizarPrueba(nombre, limpio);
    });
  }

  // ---------- inicio ----------
  async function iniciar() {
    prepararPanelMovil();
    if (location.protocol === "file:") {
      avisar("Abriste el archivo directo desde la carpeta y el navegador bloquea la carga de capas. Usá un servidor local (ver README) o la versión publicada en GitHub Pages.");
    }
    try {
      const r = await fetch("data/config.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      estado.config = await r.json();
    } catch (err) {
      if (location.protocol !== "file:") avisar("No se pudo leer data/config.json. Revisá que exista y que no tenga errores de formato (comas o llaves de más).");
      return;
    }
    const cfg = estado.config;
    document.title = cfg.titulo || document.title;
    $("titulo").textContent = cfg.titulo || "";
    $("subtitulo").textContent = cfg.subtitulo || "";

    estado.mapa = crearMapa(cfg);
    await Promise.all((cfg.capas || []).map(cargarCapa));
    [...cfg.capas].reverse().forEach((def) => {
      const reg = estado.capas.get(def.id);
      if (def.visible && reg.capa) reg.capa.addTo(estado.mapa);
    });
    dibujarListaCapas();
    prepararExplorar();
    prepararBusqueda();
    prepararEquipo();
    leerUrl();

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      estado.capas.forEach((_, id) => repintar(id));
      if (estado.explorar.campo) dibujarLeyenda();
    });
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
