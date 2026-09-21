/* Geoportal de Tigre — todo se define en data/config.json */
(function () {
  "use strict";

  const RAMPA = ["#F1EBDC", "#C9D8C2", "#8DB8A9", "#4E8F8E", "#16525A"];
  const RAMPA_OSCURA = ["#2E3B32", "#3F6454", "#5E9282", "#8DC3B5", "#CDEDE4"];
  const CATEGORICA = ["#16525A", "#C9A46A", "#6F8A3E", "#B5566B", "#5B6FA8", "#D98C3A", "#7D5BA6", "#4F9E8F",
    "#8A6D3B", "#3E7CB1", "#A4507A", "#7A8B2E", "#2F6F4F", "#C2622C", "#4C5FA0", "#96703E",
    "#B04A4A", "#3D8C8C", "#6E5AA8", "#7F9B3A"];
  const GRIS = "#9AA5A4";

  const $ = (id) => document.getElementById(id);
  const oscuro = () => window.matchMedia("(prefers-color-scheme: dark)").matches &&
    document.documentElement.dataset.theme !== "light";

  const estado = {
    config: null,
    mapa: null,
    capas: new Map(),       // id -> { def, datos, capa, stats, error }
    explorar: { capaId: null, clave: null, anio: null, rango: null, categorias: null },
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

  // ---------- variables: simples, por año (series) y categóricas ----------
  const claveVar = (v) => v.id || v.campo;
  const aniosDe = (v) => (v.series ? Object.keys(v.series).sort() : []);
  const campoDe = (v, anio) => (v.series ? v.series[anio] ?? v.series[aniosDe(v).slice(-1)[0]] : v.campo);

  function cortesDivergentes(nums) {
    const abs = nums.map(Math.abs);
    let q1 = cuantiles(abs, 5)[0];
    let q2 = cuantiles(abs, 5)[2];
    if (!(q1 > 0)) q1 = (Math.max(...abs) || 1) / 10;
    if (!(q2 > q1)) q2 = q1 * 2;
    return [-q2, -q1, q1, q2];
  }

  function calcularStats(def, datos) {
    const stats = {};
    (def.variables || []).forEach((variable) => {
      const clave = claveVar(variable);
      if (variable.tipo === "categoria") {
        const conteos = new Map();
        datos.features.forEach((f) => {
          const x = f.properties[variable.campo];
          const k = x === null || x === undefined || x === "" ? "Sin dato" : String(x);
          conteos.set(k, (conteos.get(k) || 0) + 1);
        });
        const cats = [...conteos.keys()].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
        const colores = {};
        cats.forEach((c, i) => {
          colores[c] = (variable.colores && variable.colores[c]) || (c === "Sin dato" ? GRIS : CATEGORICA[i % CATEGORICA.length]);
        });
        stats[clave] = { tipo: "categoria", cats, conteos, colores };
        return;
      }
      const campos = variable.series ? Object.values(variable.series) : [variable.campo];
      const porCampo = {};
      let todos = [];
      campos.forEach((campo) => {
        const nums = datos.features.map((f) => f.properties[campo]).filter(esNumero).map(Number);
        porCampo[campo] = { nums, ordenados: [...nums].sort((a, b) => b - a) };
        todos = todos.concat(nums);
      });
      if (!todos.length) { stats[clave] = { tipo: "vacio" }; return; }
      const min = Math.min(...todos), max = Math.max(...todos);
      let cortes;
      if (Array.isArray(variable.cortes)) {
        cortes = variable.cortes.filter((c) => c > min && c < max);
      } else if (variable.paleta === "divergente") {
        cortes = cortesDivergentes(todos);
      } else {
        const n = Math.max(1, Math.min(variable.clases || def.clases || 5, new Set(todos).size, 5));
        cortes = (variable.clasificacion || def.clasificacion || "cuantiles") === "intervalos"
          ? Array.from({ length: n - 1 }, (_, i) => min + ((max - min) * (i + 1)) / n)
          : cuantiles(todos, n);
        cortes = [...new Set(cortes.map((c) => +c.toFixed(10)))].filter((c) => c > min && c < max);
      }
      // dominio visible del histograma y del filtro (permite recortar valores extremos)
      const dmin = variable.limites ? Math.max(min, variable.limites[0]) : min;
      const dmax = variable.limites ? Math.min(max, variable.limites[1]) : max;
      stats[clave] = { tipo: "numero", min, max, dmin, dmax, cortes, porCampo };
    });
    return stats;
  }

  const DIVERGENTE = ["#9A4A2B", "#D6A184", "#E9E4D8", "#8DB8A9", "#16525A"];
  const DIVERGENTE_OSCURA = ["#D98A68", "#8C5B45", "#3C4745", "#4E8F8E", "#9AD3C6"];

  function colorDeClase(i, total, variable) {
    if (variable && variable.paleta === "divergente") {
      const p = oscuro() ? DIVERGENTE_OSCURA : DIVERGENTE;
      const idx = Math.round((i * (p.length - 1)) / Math.max(1, total - 1));
      return variable.invertir ? p[p.length - 1 - idx] : p[idx];
    }
    const rampa = oscuro() ? RAMPA_OSCURA : RAMPA;
    if (total <= 1) return rampa[rampa.length - 1];
    const idx = Math.round((i * (rampa.length - 1)) / (total - 1));
    return variable && variable.invertir ? rampa[rampa.length - 1 - idx] : rampa[idx];
  }

  function claseDe(valor, cortes) {
    let i = 0;
    while (i < cortes.length && valor > cortes[i]) i++;
    return i;
  }

  function variableActiva() {
    const ex = estado.explorar;
    if (!ex.capaId || !ex.clave) return null;
    const reg = estado.capas.get(ex.capaId);
    const variable = reg.def.variables.find((v) => claveVar(v) === ex.clave);
    return { reg, variable, st: reg.stats[ex.clave], campo: campoDe(variable, ex.anio) };
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
      fill: !e.soloBorde && def.geometria !== "linea",
      dashArray: e.guiones || null,
      radius: e.radio ?? 6
    };
  }

  // radio de los puntos proporcional a la raíz de un campo (por ejemplo, cantidad de avisos)
  function radioDe(def, feature) {
    const e = def.estilo || {};
    const n = Number(feature.properties[e.radioSegun]);
    if (!e.radioSegun || !isFinite(n) || n <= 0) return e.radio ?? 6;
    return Math.max(e.radioMin ?? 4, Math.min(e.radioMax ?? 16, (e.radioMin ?? 4) + 1.8 * (Math.sqrt(n) - 1)));
  }

  function estiloElemento(def, feature) {
    const base = estiloBase(def);
    const cs = def.estilo && def.estilo.colorSegun;
    if (cs) {
      const col = colorFijo(def, feature.properties[cs]);
      if (col) { base.color = def.geometria === "linea" ? col : base.color; base.fillColor = col; }
    }
    if (def.geometria === "punto") base.radius = radioDe(def, feature);
    if (def.geometria === "linea" && def.estilo && def.estilo.grosorSegun) {
      const n = Number(feature.properties[def.estilo.grosorSegun]);
      if (isFinite(n)) base.weight = Math.min(def.estilo.grosorMax ?? 9, (def.estilo.grosorMin ?? 1.5) + (def.estilo.grosorPaso ?? 0.6) * (n - 1));
    }
    const ex = estado.explorar;
    if (ex.capaId !== def.id || !ex.clave) {
      // capas que ya se muestran coloreadas por un valor, sin pasar por "Explorar datos"
      const cp = def.estilo && def.estilo.colorearPor;
      if (cp) {
        const reg = estado.capas.get(def.id);
        const v = (def.variables || []).find((x) => x.campo === cp);
        const st = reg && reg.stats[cp];
        const n = Number(feature.properties[cp]);
        if (st && st.tipo === "numero" && esNumero(n)) {
          const col = colorDeClase(claseDe(n, st.cortes), st.cortes.length + 1, v);
          return { ...base, fillColor: col, fillOpacity: 0.8, color: bordeDato(), weight: 0.4 };
        }
      }
      return base;
    }
    const { variable, st, campo } = variableActiva();
    const v = feature.properties[campo];

    if (st.tipo === "categoria") {
      const k = v === null || v === undefined || v === "" ? "Sin dato" : String(v);
      if (!ex.categorias.has(k)) return apagado(base, def);
      if (def.geometria === "linea") return { ...base, color: st.colores[k], weight: Math.max(base.weight, 2.5), opacity: 0.95, dashArray: null };
      return { ...base, fillColor: st.colores[k], fillOpacity: 0.78, color: bordeDato(), weight: 0.8 };
    }
    if (st.tipo !== "numero" || !esNumero(v)) return apagado(base, def);
    const n = Number(v);
    if (ex.rango && (n < ex.rango[0] || n > ex.rango[1])) return apagado(base, def);
    const col = colorDeClase(claseDe(n, st.cortes), st.cortes.length + 1, variable);
    if (def.geometria === "linea") return { ...base, color: col, weight: Math.max(base.weight, 2.5), opacity: 0.95 };
    return { ...base, fillColor: col, fillOpacity: 0.85, color: bordeDato(), weight: 0.6 };
  }

  const bordeDato = () => (oscuro() ? "#0E1A1A" : "#FFFFFF");

  // color estable por valor: el definido en config.json o uno de la paleta, por orden alfabético
  function colorFijo(def, valor) {
    const e = def.estilo || {};
    const k = valor === null || valor === undefined || valor === "" ? "Sin dato" : String(valor);
    if (e.colores && e.colores[k]) return e.colores[k];
    const reg = estado.capas.get(def.id);
    if (!reg || !reg.datos) return null;
    if (!reg.clavesColor) {
      reg.clavesColor = [...new Set(reg.datos.features.map((f) => String(f.properties[e.colorSegun] ?? "Sin dato")))]
        .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
    }
    const i = reg.clavesColor.indexOf(k);
    return i < 0 ? null : CATEGORICA[i % CATEGORICA.length];
  }

  function apagado(base, def) {
    if (def.geometria === "linea") return { ...base, color: GRIS, weight: 1, dashArray: null, opacity: 0.12 };
    return { ...base, color: GRIS, weight: def.geometria === "linea" ? 1 : 0.4, dashArray: "3 3", fillColor: GRIS, fillOpacity: 0.06, opacity: 0.5 };
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
    const capasBase = [];
    let inicial = null;
    (cfg.mapasBase || []).forEach((b, i) => {
      const t = L.tileLayer(b.url, { attribution: b.atribucion || "", maxZoom: b.zoomMaximo || 19, subdomains: b.subdominios || "abc" });
      t._nombreBase = b.nombre;
      bases[b.nombre] = t;
      capasBase.push(t);
      if (b.inicial || (!inicial && i === 0)) inicial = t;
    });
    if (inicial) inicial.addTo(mapa);
    // si el servidor del mapa base no responde, se pasa solo al siguiente
    capasBase.forEach((t, i) => {
      let fallas = 0, anduvo = false;
      t.on("tileload", () => { anduvo = true; });
      t.on("tileerror", () => {
        fallas++;
        // se busca un mapa base de otro servidor, no otro del mismo que falló
        const host = (u) => { try { return new URL(u.replace("{s}", "a")).host; } catch (e) { return u; } };
        const suplente = capasBase.find((o, j) => j !== i && host(o._url) !== host(t._url)) || capasBase[i + 1] || capasBase[0];
        if (anduvo || fallas < 6 || !mapa.hasLayer(t) || suplente === t) return;
        mapa.removeLayer(t);
        suplente.addTo(mapa);
        avisar(`El mapa base ${t._nombreBase} no está respondiendo. Se cambió a ${suplente._nombreBase}; podés elegir otro con el botón de capas, arriba a la izquierda.`);
        setTimeout(() => { if ($("aviso").textContent.startsWith("El mapa base")) avisar(""); }, 12000);
      });
    });
    if (Object.keys(bases).length > 1) L.control.layers(bases, null, { position: "topleft" }).addTo(mapa);

    mapa.createPane("poligonos").style.zIndex = 410;
    mapa.createPane("lineas").style.zIndex = 420;
    mapa.createPane("puntos").style.zIndex = 430;
    mapa.createPane("prueba").style.zIndex = 440;

    mapa.on("click", () => cerrarFicha());
    mapa.on("moveend", guardarEnUrl);
    mapa.on("moveend zoomend", actualizarTeselas);
    mapa.on("moveend zoomend", ajustarPorZoom);
    return mapa;
  }

  // Marcador de flecha girada: se usa para el sentido de circulación
  function flechaDe(def, feature, ll) {
    const ang = Number(feature.properties[def.estilo.flecha]) || 0;
    const color = def.estilo.relleno || "#16525A";
    return L.marker(ll, {
      pane: "puntos",
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: "flecha",
        iconSize: [18, 18],
        html: `<svg viewBox="0 0 24 24" style="transform:rotate(${ang}deg)" aria-hidden="true">
          <path d="M12 2 L18 20 L12 16 L6 20 Z" fill="${color}"/></svg>`
      })
    });
  }

  function paneDe(def) {
    return def.geometria === "punto" ? "puntos" : def.geometria === "linea" ? "lineas" : "poligonos";
  }

  function cargarCapa(def) {
    const registro = { def, datos: null, capa: null, stats: {}, error: null, cargada: false, promesa: null };
    estado.capas.set(def.id, registro);
    if (def.tipo === "teselas") {
      // capa partida en teselas: se carga sola al acercar el mapa
      registro.datos = { type: "FeatureCollection", features: [] };
      registro.teselas = new Map();
      registro.cargada = true;
      registro.capa = L.geoJSON(null, {
        pane: paneDe(def),
        style: (f) => estiloElemento(def, f),
        pointToLayer: (f, ll) => L.circleMarker(ll, { ...estiloElemento(def, f), pane: "puntos" }),
        onEachFeature: (f, l) => {
          l.on("click", (e) => { L.DomEvent.stopPropagation(e); seleccionar(def.id, l); });
          const t = tituloDe(def, f);
          if (t && def.etiquetaFija) l.bindTooltip(escapar(t), { permanent: true, direction: "center", className: "etiqueta", opacity: 1 });
          else if (t) l.bindTooltip(escapar(t), { sticky: true, direction: "top", opacity: 0.95 });
        }
      });
    }
    return registro;
  }

  // Trae el archivo de una capa. Solo se llama cuando hace falta: al abrir el sitio
  // con las capas visibles, al prender una capa o al explorar sus datos.
  function asegurarCapa(id) {
    const reg = estado.capas.get(id);
    if (!reg || reg.cargada || reg.error) return Promise.resolve(reg);
    if (!reg.promesa) reg.promesa = traerDatos(reg);
    return reg.promesa;
  }

  async function traerDatos(registro) {
    const def = registro.def;
    try {
      const r = await fetch(def.archivo, { cache: "no-cache" });
      if (!r.ok) throw new Error(`respuesta ${r.status}`);
      registro.datos = await r.json();
      if (!registro.datos.features) throw new Error("el archivo no es un FeatureCollection");
      registro.stats = calcularStats(def, registro.datos);
      registro.capa = L.geoJSON(registro.datos, {
        pane: paneDe(def),
        style: (f) => estiloElemento(def, f),
        pointToLayer: (f, ll) => (def.estilo && def.estilo.flecha
          ? flechaDe(def, f, ll)
          : L.circleMarker(ll, { ...estiloElemento(def, f), pane: "puntos" })),
        onEachFeature: (f, l) => {
          l.on("click", (e) => { L.DomEvent.stopPropagation(e); seleccionar(def.id, l); });
          const t = tituloDe(def, f);
          if (t && def.etiquetaFija) l.bindTooltip(escapar(t), { permanent: true, direction: "center", className: "etiqueta", opacity: 1 });
          else if (t) l.bindTooltip(escapar(t), { sticky: true, direction: "top", opacity: 0.95 });
        }
      });
      registro.cargada = true;
      indexar(def, registro);
    } catch (err) {
      registro.error = `No se pudo cargar ${def.archivo} (${err.message}). Revisá que el archivo exista y que la ruta en config.json sea la correcta.`;
      console.error(err);
    }
    actualizarFilaCapa(def.id);
    return registro;
  }

  function tituloDe(def, f) {
    const p = f.properties || {};
    return p[def.titulo] ?? p[def.busqueda] ?? p.nombre ?? p.name ?? "";
  }

  // La primera capa de config.json queda arriba de todo
  function ordenDibujo() {
    return estado.config.capas
      .map((def, i) => ({ def, o: def.ordenMapa ?? i }))
      .sort((a, b) => a.o - b.o)
      .map((x) => x.def);
  }

  function ordenarCapas() {
    [...ordenDibujo()].reverse().forEach((def) => {
      const reg = estado.capas.get(def.id);
      if (reg && reg.capa && estado.mapa.hasLayer(reg.capa)) reg.capa.bringToFront();
    });
  }

  // Capas con zoom mínimo o que solo dibujan lo que entra en pantalla
  function ajustarPorZoom() {
    (estado.config.capas || []).forEach((def) => {
      if (def.tipo === "teselas" || (!def.zoomMinimo && !def.soloEnVista)) return;
      const reg = estado.capas.get(def.id);
      const chk = $(`capa-${def.id}`);
      if (!reg || !reg.capa || !chk) return;
      const cerca = !def.zoomMinimo || estado.mapa.getZoom() >= def.zoomMinimo;
      if (chk.checked && cerca) {
        if (!estado.mapa.hasLayer(reg.capa)) { reg.capa.addTo(estado.mapa); ordenarCapas(); }
        if (def.soloEnVista) dibujarEnVista(def, reg);
      } else if (estado.mapa.hasLayer(reg.capa)) {
        estado.mapa.removeLayer(reg.capa);
      }
    });
  }

  function dibujarEnVista(def, reg) {
    if (!reg.datos) return;
    const b = estado.mapa.getBounds();
    const dentro = reg.datos.features.filter((f) => {
      const c = f.geometry && f.geometry.coordinates;
      return c && typeof c[0] === "number" && b.contains([c[1], c[0]]);
    }).slice(0, def.maximoEnVista || 900);
    reg.capa.clearLayers();
    reg.capa.addData({ type: "FeatureCollection", features: dentro });
  }

  // ---------- capas en teselas ----------
  function teselasEnVista(def) {
    const z = def.zoomTeselas;
    const n = 2 ** z;
    const b = estado.mapa.getBounds().pad(0.15);
    const aX = (lng) => Math.floor(((lng + 180) / 360) * n);
    const aY = (lat) => {
      const r = (lat * Math.PI) / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    };
    const x0 = aX(b.getWest()), x1 = aX(b.getEast());
    const y0 = aY(b.getNorth()), y1 = aY(b.getSouth());
    const lista = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) lista.push([x, y]);
    return lista;
  }

  async function actualizarTeselas() {
    for (const def of estado.config.capas.filter((d) => d.tipo === "teselas")) {
      const reg = estado.capas.get(def.id);
      if (!reg || !reg.capa || !estado.mapa.hasLayer(reg.capa)) continue;
      if (estado.mapa.getZoom() < (def.zoomMinimo ?? 16)) {
        if (reg.teselas.size) {
          reg.capa.clearLayers();
          reg.teselas.clear();
          reg.datos.features = [];
        }
        avisar(`Acercá el mapa para ver la capa ${def.nombre}.`);
        continue;
      }
      if ($("aviso").textContent.startsWith("Acercá")) avisar("");
      const vista = teselasEnVista(def);
      // si hay demasiadas teselas cargadas, se limpia y se vuelve a cargar lo que se ve
      if (reg.teselas.size > 80) {
        reg.capa.clearLayers();
        reg.teselas.clear();
        reg.datos.features = [];
      }
      for (const [x, y] of vista) {
        const clave = `${x}/${y}`;
        if (reg.teselas.has(clave)) continue;
        reg.teselas.set(clave, true);
        const url = def.plantilla.replace("{z}", def.zoomTeselas).replace("{x}", x).replace("{y}", y);
        try {
          const r = await fetch(url, { cache: "force-cache" });
          if (!r.ok) continue;            // tesela sin datos
          const datos = await r.json();
          if (!estado.mapa.hasLayer(reg.capa)) return;
          reg.capa.addData(datos);
          reg.datos.features.push(...datos.features);
          ordenarCapas();
        } catch (err) { /* sin datos en esa tesela */ }
      }
    }
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
        const multicolor = def.estilo && def.estilo.colorSegun;
        const fila = document.createElement("div");
        fila.className = "capa";
        fila.dataset.capa = def.id;
        const idc = `capa-${def.id}`;
        const tipoMuestra = def.geometria === "punto" ? "punto" : def.geometria === "linea" ? "linea" : "";
        const fondo = def.geometria === "linea" || !b.fill ? "transparent" : b.fillColor;
        fila.innerHTML = `
          <input type="checkbox" id="${idc}" ${reg.capa && estado.mapa.hasLayer(reg.capa) ? "checked" : ""} ${reg.error ? "disabled" : ""}>
          <span class="muestra ${tipoMuestra}${multicolor ? " multicolor" : ""}" style="${multicolor ? "" : `border-color:${b.color};background:${fondo}`}"></span>
          <label for="${idc}">${escapar(def.nombre)}${def.tipo === "teselas" || def.zoomMinimo ? ` <small>(al acercar)</small>` : ""}</label>
          ${reg.error ? "" : `<span class="descargas">${def.archivo ? `<a href="${escapar(def.archivo)}" download title="Descargar ${escapar(def.nombre)} como GeoJSON, para usar en QGIS">GeoJSON</a>` : ""}
            <button type="button" class="enlace" data-csv="${escapar(def.id)}" title="${def.tipo === "teselas" ? "Descargar en CSV lo que está cargado en pantalla" : `Descargar la tabla de datos de ${escapar(def.nombre)} en CSV, para abrir en Excel`}">CSV</button></span>`}
          ${reg.error ? `<span class="error">${escapar(reg.error)}</span>` : ""}`;
        const btn = fila.querySelector("button[data-csv]");
        if (btn) btn.addEventListener("click", () => descargarCsv(def.id));
        const chk = fila.querySelector("input");
        chk.addEventListener("change", () => alternarCapa(def.id, chk.checked));
        div.appendChild(fila);
      });
      cont.appendChild(div);
    });
  }

  // CSV con todos los atributos de la capa, más el centro de cada elemento
  function descargarCsv(id) {
    const reg = estado.capas.get(id);
    if (!reg || !reg.datos) return;
    const feats = reg.datos.features;
    const alias = reg.def.campos || {};
    const claves = [...new Set(feats.flatMap((f) => Object.keys(f.properties || {})))];
    const cabecera = claves.map((k) => alias[k] || k).concat(["lat", "lon"]);
    const celda = (v) => {
      if (v === null || v === undefined) return "";
      const t = String(v).replace(/"/g, '""');
      return /[;"\n]/.test(t) ? `"${t}"` : t;
    };
    const filas = feats.map((f) => {
      const capa = L.geoJSON(f);
      const c = capa.getBounds().isValid() ? capa.getBounds().getCenter() : { lat: "", lng: "" };
      return claves.map((k) => celda(f.properties[k])).concat([
        c.lat === "" ? "" : c.lat.toFixed(6), c.lng === "" ? "" : c.lng.toFixed(6)]).join(";");
    });
    const csv = "\uFEFF" + [cabecera.map(celda).join(";"), ...filas].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${id}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function alternarCapa(id, visible) {
    let reg = estado.capas.get(id);
    if (!reg) return;
    if (visible && !reg.cargada && !reg.error) {
      marcarCargando(id, true);
      reg = await asegurarCapa(id);
      marcarCargando(id, false);
    }
    if (!reg.capa) return;
    if (visible) {
      const def = reg.def;
      if (def.zoomMinimo && estado.mapa.getZoom() < def.zoomMinimo) {
        avisar(`Acercá el mapa para ver la capa ${def.nombre}.`);
        setTimeout(() => { if ($("aviso").textContent.startsWith("Acercá")) avisar(""); }, 6000);
      } else {
        reg.capa.addTo(estado.mapa);
        ordenarCapas();
        if (def.soloEnVista) dibujarEnVista(def, reg);
      }
      if (def.tipo === "teselas") actualizarTeselas();
    }
    else {
      estado.mapa.removeLayer(reg.capa);
      if (estado.seleccion && estado.seleccion.id === id) cerrarFicha();
    }
    const chk = $(`capa-${id}`);
    if (chk) chk.checked = visible;
  }

  function marcarCargando(id, cargando) {
    const fila = document.querySelector(`.capa[data-capa="${CSS.escape(id)}"]`);
    if (fila) fila.classList.toggle("cargando", cargando);
  }

  // Redibuja una fila de la lista cuando la capa termina de cargar o falla
  function actualizarFilaCapa(id) {
    const fila = document.querySelector(`.capa[data-capa="${CSS.escape(id)}"]`);
    if (!fila) return;
    const reg = estado.capas.get(id);
    fila.classList.remove("cargando");
    const aviso = fila.querySelector(".error");
    if (reg.error && !aviso) {
      fila.insertAdjacentHTML("beforeend", `<span class="error">${escapar(reg.error)}</span>`);
      const chk = fila.querySelector("input");
      if (chk) { chk.checked = false; chk.disabled = true; }
    }
  }

  // ---------- explorar datos ----------
  function prepararExplorar() {
    const conVars = estado.config.capas.filter((d) => d.variables && d.variables.length && !estado.capas.get(d.id).error);
    if (!conVars.length) return;
    $("seccionExplorar").hidden = false;
    const selCapa = $("selCapa");
    selCapa.innerHTML = `<option value="">Ninguna</option>` +
      conVars.map((d) => `<option value="${escapar(d.id)}">${escapar(d.nombre)}</option>`).join("");
    selCapa.addEventListener("change", () => elegirCapa(selCapa.value));
    $("selVariable").addEventListener("change", (e) => elegirVariable(e.target.value));
  }

  async function elegirCapa(id, clave, anio, rango) {
    if (id && !estado.capas.get(id).cargada && !estado.capas.get(id).error) {
      $("selCapa").disabled = true;
      await asegurarCapa(id);
      $("selCapa").disabled = false;
    }
    if (id && estado.capas.get(id).error) return;
    const anterior = estado.explorar.capaId;
    estado.explorar = { capaId: id || null, clave: null, anio: null, rango: null, categorias: null };
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
    await alternarCapa(id, true);
    selVar.disabled = false;
    // agrupa las variables en el desplegable si tienen "grupo"
    const grupos = new Map();
    def.variables.forEach((v) => {
      const g = v.grupo || "";
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(v);
    });
    selVar.innerHTML = [...grupos].map(([g, vs]) => {
      const ops = vs.map((v) => `<option value="${escapar(claveVar(v))}">${escapar(v.nombre)}</option>`).join("");
      return g ? `<optgroup label="${escapar(g)}">${ops}</optgroup>` : ops;
    }).join("");
    $("fuenteVariable").textContent = def.fuente ? `Fuente: ${def.fuente}` : "";
    const existe = clave && def.variables.some((v) => claveVar(v) === clave);
    elegirVariable(existe ? clave : claveVar(def.variables[0]), anio, rango);
  }

  function elegirVariable(clave, anio, rango) {
    const ex = estado.explorar;
    const reg = estado.capas.get(ex.capaId);
    const variable = reg.def.variables.find((v) => claveVar(v) === clave);
    const st = reg.stats[clave];
    const anios = aniosDe(variable);
    ex.clave = clave;
    // conserva el año elegido si la nueva variable también lo tiene
    const pedido = anio || ex.anio;
    ex.anio = anios.length ? (anios.includes(String(pedido)) ? String(pedido) : (variable.anioInicial || anios[anios.length - 1])) : null;
    $("selVariable").value = clave;
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

  function elegirAnio(anio) {
    estado.explorar.anio = anio;
    dibujarLeyenda();
    repintar(estado.explorar.capaId);
    if (estado.seleccion) mostrarFicha(estado.seleccion.id, estado.seleccion.capaLeaflet);
    guardarEnUrl();
  }

  function dibujarLeyenda() {
    const ex = estado.explorar;
    const { reg, variable, st, campo } = variableActiva();
    const cont = $("leyenda");
    const feats = reg.datos.features;

    if (st.tipo === "vacio") {
      cont.innerHTML = `<p class="nota">Esta variable no tiene valores numéricos en la capa. Revisá el nombre del campo en config.json.</p>`;
      return;
    }

    if (st.tipo === "categoria") {
      cont.innerHTML = `<ul class="clases">${st.cats.map((c, i) => `
        <li><label><input type="checkbox" data-cat="${i}">
          <span class="sw" style="background:${st.colores[c]}"></span>${escapar(c)}
          <span class="n">${st.conteos.get(c)}</span></label></li>`).join("")}</ul>
        ${st.cats.length > 3 ? `<div class="acciones-cat">
          <button type="button" class="boton" data-todas="1">Mostrar todas</button>
          <button type="button" class="boton" data-todas="0">Ocultar todas</button></div>` : ""}
        <p class="conteo" id="conteo"></p>`;
      cont.querySelectorAll("button[data-todas]").forEach((btn) => btn.addEventListener("click", () => {
        ex.categorias = btn.dataset.todas === "1" ? new Set(st.cats) : new Set();
        cont.querySelectorAll("input[data-cat]").forEach((chk) => { chk.checked = ex.categorias.has(st.cats[+chk.dataset.cat]); });
        repintar(ex.capaId);
        actualizarConteo();
        guardarEnUrl();
      }));
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

    const anios = aniosDe(variable);
    const selectorAnio = anios.length > 1 ? `
      <div class="anios" role="group" aria-label="Año del censo">
        ${anios.map((a) => `<button type="button" class="anio" data-anio="${a}" aria-pressed="${a === ex.anio}">${a}</button>`).join("")}
      </div>` : "";

    const nums = st.porCampo[campo] ? st.porCampo[campo].nums : [];
    const nClases = st.cortes.length + 1;
    const limites = [st.min, ...st.cortes, st.max];
    const W = 300, H = 74;
    const nBins = Math.max(6, Math.min(24, Math.ceil(Math.sqrt(nums.length)) * 2));
    const ancho = (st.dmax - st.dmin) / nBins || 1;
    const bins = new Array(nBins).fill(0);
    nums.forEach((x) => {
      const b = Math.floor((Math.min(Math.max(x, st.dmin), st.dmax) - st.dmin) / ancho);
      bins[Math.min(nBins - 1, Math.max(0, b))]++;
    });
    const maxBin = Math.max(1, ...bins);
    const bw = W / nBins;
    const barras = bins.map((c, i) => {
      const desde = i === 0 ? st.min : st.dmin + ancho * i;
      const hasta = i === nBins - 1 ? st.max : st.dmin + ancho * (i + 1);
      const medio = st.dmin + ancho * (i + 0.5);
      const h = c ? Math.max(3, (c / maxBin) * (H - 4)) : 0;
      return `<rect class="barra" data-desde="${desde}" data-hasta="${hasta}"
        x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}"
        fill="${colorDeClase(claseDe(medio, st.cortes), nClases, variable)}" stroke="var(--borde)" stroke-width="0.5"><title>${c} elemento(s)</title></rect>`;
    }).join("");
    const paso = (st.dmax - st.dmin) / 200 || 1;
    const valRango = (x, extremo) => (extremo === "min" ? Math.max(x, st.dmin) : Math.min(x, st.dmax));
    const recorte = st.dmin > st.min || st.dmax < st.max;

    cont.innerHTML = `${selectorAnio}
      <svg class="histograma" viewBox="0 0 ${W} ${H + 2}" role="img" aria-label="Distribución de ${escapar(variable.nombre)}${ex.anio ? " en " + ex.anio : ""}">
        ${barras}<line x1="0" x2="${W}" y1="${H + 1}" y2="${H + 1}" stroke="var(--apagado)"/>
      </svg>
      <div class="doble-rango">
        <input type="range" id="rangoMin" min="${st.dmin}" max="${st.dmax}" step="${paso}" value="${valRango(ex.rango[0], "min")}" aria-label="Valor mínimo">
        <input type="range" id="rangoMax" min="${st.dmin}" max="${st.dmax}" step="${paso}" value="${valRango(ex.rango[1], "max")}" aria-label="Valor máximo">
      </div>
      <div class="rango-valores"><span id="valMin"></span><span id="valMax"></span></div>
      ${recorte ? `<p class="nota">Las barras de los extremos agrupan los valores más allá de ${formatear(st.dmin, variable)} y ${formatear(st.dmax, variable)}.</p>` : ""}
      <p class="conteo" id="conteo"></p>
      <ul class="clases">${limites.slice(0, -1).map((a, i) => `
        <li><span class="sw" style="background:${colorDeClase(i, nClases, variable)}"></span>
          ${formatear(a, variable)} a ${formatear(limites[i + 1], variable)}
          <span class="n">${nums.filter((x) => claseDe(x, st.cortes) === i).length}</span></li>`).join("")}
      </ul>
      ${anios.length > 1 ? `<p class="nota">Los colores usan los mismos cortes en todos los años, así se pueden comparar.</p>` : ""}`;

    cont.querySelectorAll("button.anio").forEach((b) => b.addEventListener("click", () => elegirAnio(b.dataset.anio)));

    const rMin = $("rangoMin"), rMax = $("rangoMax");
    const alMover = () => {
      let a = +rMin.value, b = +rMax.value;
      if (a > b) { [a, b] = [b, a]; }
      // en los extremos del control se toma el valor real, para no perder elementos recortados
      ex.rango = [a <= st.dmin + paso / 2 ? st.min : a, b >= st.dmax - paso / 2 ? st.max : b];
      actualizarRango();
      repintar(ex.capaId);
    };
    rMin.addEventListener("input", alMover);
    rMax.addEventListener("input", alMover);
    rMin.addEventListener("change", guardarEnUrl);
    rMax.addEventListener("change", guardarEnUrl);
    actualizarRango();
  }

  function actualizarRango() {
    const { variable } = variableActiva();
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
    const { reg, variable, st, campo } = variableActiva();
    const feats = reg.datos.features;
    let visibles, filtrado;
    const valor = (f) => f.properties[campo];
    if (st.tipo === "categoria") {
      visibles = feats.filter((f) => ex.categorias.has(valor(f) == null || valor(f) === "" ? "Sin dato" : String(valor(f)))).length;
      filtrado = ex.categorias.size < st.cats.length;
    } else {
      visibles = feats.filter((f) => esNumero(valor(f)) && +valor(f) >= ex.rango[0] && +valor(f) <= ex.rango[1]).length;
      filtrado = ex.rango[0] > st.min || ex.rango[1] < st.max;
    }
    const el = $("conteo");
    el.innerHTML = `${visibles} de ${feats.length} elementos resaltados` +
      (filtrado ? ` <button type="button" class="boton" id="quitarFiltro">Quitar filtro</button>` : "");
    const q = $("quitarFiltro");
    if (q) q.addEventListener("click", () => elegirVariable(ex.clave, ex.anio));
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
    const ex = estado.explorar;
    const campos = def.campos || Object.fromEntries(Object.keys(p).map((k) => [k, k]));
    const formatoDe = {};
    (def.variables || []).filter((v) => v.tipo !== "categoria").forEach((v) => {
      (v.series ? Object.values(v.series) : [v.campo]).forEach((c) => { formatoDe[c] = v; });
    });
    const textual = new Set((def.variables || []).filter((v) => v.tipo === "categoria").map((v) => v.campo));

    const filas = Object.entries(campos).map(([k, alias]) =>
      `<dt>${escapar(alias)}</dt><dd>${(typeof p[k] === "string" && !formatoDe[k]) || textual.has(k) ? escapar(p[k] ?? "Sin dato") : formatear(p[k], formatoDe[k])}</dd>`).join("");

    let comparacion = "";
    const numericas = (def.variables || []).filter((v) => reg.stats[claveVar(v)] && reg.stats[claveVar(v)].tipo === "numero");
    if (numericas.length && reg.datos.features.length > 1) {
      comparacion = `<div class="comparacion"><h3>Frente al resto de ${escapar(def.nombre.charAt(0).toLowerCase() + def.nombre.slice(1))}</h3>` +
        numericas.map((v) => {
          const st = reg.stats[claveVar(v)];
          const activa = ex.capaId === id && ex.clave === claveVar(v);
          const anio = activa && ex.anio ? ex.anio : aniosDe(v).slice(-1)[0];
          const campo = campoDe(v, anio);
          const x = p[campo];
          const etiqueta = `${escapar(v.nombre)}${v.series ? ` <small>(${anio})</small>` : ""}`;
          const serie = v.series && aniosDe(v).length > 1
            ? `<div class="serie">${aniosDe(v).map((a) => `${a}: ${formatear(p[v.series[a]], v)}`).join(" · ")}</div>` : "";
          if (!esNumero(x)) return `<div class="comp-item${activa ? " activa" : ""}"><div class="fila"><span>${etiqueta}</span><span class="puesto">Sin dato</span></div>${serie}</div>`;
          const ord = st.porCampo[campo].ordenados;
          const pos = st.max > st.min ? ((Math.min(Math.max(x, st.dmin), st.dmax) - st.dmin) / ((st.dmax - st.dmin) || 1)) * 100 : 50;
          const puesto = ord.indexOf(Number(x)) + 1;
          return `<div class="comp-item${activa ? " activa" : ""}"><div class="fila"><span>${etiqueta}</span>
            <span class="puesto">${formatear(x, v)} · ${puesto}.º de ${ord.length}</span></div>
            <div class="pista"><span style="left:${pos.toFixed(1)}%"></span></div>${serie}</div>`;
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
    const ir = async (r) => {
      await alternarCapa(r.id, true);
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
    if (ex.capaId && ex.clave) {
      ps.set("capa", ex.capaId);
      ps.set("var", ex.clave);
      if (ex.anio) ps.set("anio", ex.anio);
      const st = estado.capas.get(ex.capaId).stats[ex.clave];
      if (ex.rango && st && (ex.rango[0] > st.min || ex.rango[1] < st.max)) ps.set("rango", ex.rango.map((x) => +x.toPrecision(8)).join(","));
    }
    history.replaceState(null, "", `${location.pathname}${location.search}#${ps.toString()}`);
  }

  async function leerUrl() {
    const ps = new URLSearchParams(location.hash.slice(1));
    const z = ps.get("z"), c = ps.get("c");
    if (z && c) {
      const [lat, lng] = c.split(",").map(Number);
      if (isFinite(lat) && isFinite(lng)) estado.mapa.setView([lat, lng], Number(z));
    }
    const valida = (id) => id && estado.capas.get(id) && !estado.capas.get(id).error &&
      $("selCapa").querySelector(`option[value="${CSS.escape(id)}"]`);
    const capa = ps.get("capa");
    if (valida(capa)) {
      const r = ps.get("rango");
      const rango = r ? r.split(",").map(Number) : null;
      await elegirCapa(capa, ps.get("var"), ps.get("anio"), rango && rango.every(isFinite) ? rango : null);
      return;
    }
    const ini = estado.config.explorarInicial;
    if (ini && valida(ini.capa)) await elegirCapa(ini.capa, ini.variable, ini.anio);
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

  // Las capas apagadas se traen de a una, sin frenar el uso del mapa
  async function cargarRestantes() {
    // con datos móviles limitados o conexión lenta, cada capa se trae recién al prenderla
    const con = navigator.connection || {};
    if (con.saveData || /2g/.test(con.effectiveType || "")) return;
    for (const def of estado.config.capas) {
      const reg = estado.capas.get(def.id);
      if (reg.cargada || reg.error || def.soloAlPrender) continue;
      await asegurarCapa(def.id);
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  // ---------- "Dar mi aporte": formulario que llega por correo (FormSubmit) ----------
  function prepararAporte() {
    const dlg = $("dialogoAporte");
    const form = $("formAporte");
    const cfg = estado.config.aportes || {};
    const correo = (cfg.correo || "").trim();
    const capas = $("aporteCapa");
    capas.insertAdjacentHTML("beforeend", estado.config.capas
      .map((d) => `<option value="${escapar(d.nombre)}">${escapar(d.grupo)} · ${escapar(d.nombre)}</option>`).join(""));

    const abrir = () => {
      $("aporteError").hidden = true;
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
      $("aporteTipo").focus();
    };
    const cerrar = () => { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); };
    $("abrirAporte").addEventListener("click", abrir);
    $("cerrarAporte").addEventListener("click", cerrar);
    $("cancelarAporte").addEventListener("click", cerrar);

    form.addEventListener("submit", (e) => {
      const error = (msg) => { e.preventDefault(); $("aporteError").textContent = msg; $("aporteError").hidden = false; };
      if (!correo) return error("El formulario todavía no tiene un correo de destino configurado.");
      const archivo = $("aporteArchivo").files[0];
      if (archivo && archivo.size > 10 * 1024 * 1024) return error("El archivo pesa más de 10 MB. Comprimilo o mandá un link de descarga en el comentario.");
      form.action = `https://formsubmit.co/${encodeURIComponent(correo)}`;
      $("aporteAsunto").value = `${cfg.asunto || "Nuevo aporte al Geoportal de Tigre"}: ${$("aporteTipo").value}`;
      $("aporteLink").value = $("aporteVista").checked ? location.href : "No incluida";
      const vuelta = new URL(location.href);
      vuelta.searchParams.set("aporte", "enviado");
      $("aporteSiguiente").value = vuelta.toString();
      $("enviarAporte").disabled = true;
      $("enviarAporte").textContent = "Enviando…";
    });

    // al volver del envío, se agradece y se limpia la dirección
    const ps = new URLSearchParams(location.search);
    if (ps.get("aporte") === "enviado") {
      avisar("¡Gracias! Tu aporte llegó al equipo de IDEAR Tigre.");
      setTimeout(() => { if ($("aviso").textContent.startsWith("¡Gracias")) avisar(""); }, 8000);
      ps.delete("aporte");
      history.replaceState(null, "", `${location.pathname}${ps.toString() ? "?" + ps : ""}${location.hash}`);
    }
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
    document.title = cfg.titulo ? `${cfg.titulo} · IDEAR Tigre` : document.title;
    $("titulo").textContent = cfg.titulo || "";
    $("subtitulo").textContent = cfg.subtitulo || "";

    estado.mapa = crearMapa(cfg);
    (cfg.capas || []).forEach(cargarCapa);
    // primero solo las capas que se muestran al abrir: el resto llega después
    await Promise.all((cfg.capas || []).filter((d) => d.visible).map((d) => asegurarCapa(d.id)));
    [...ordenDibujo()].reverse().forEach((def) => {
      const reg = estado.capas.get(def.id);
      if (def.visible && reg.capa) reg.capa.addTo(estado.mapa);
    });
    dibujarListaCapas();
    prepararExplorar();
    prepararBusqueda();
    prepararEquipo();
    prepararAporte();
    await leerUrl();
    cargarRestantes();

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      estado.capas.forEach((_, id) => repintar(id));
      if (estado.explorar.clave) dibujarLeyenda();
    });
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
