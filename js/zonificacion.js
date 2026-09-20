/* Código de zonificación de Tigre — lee data/zonas_codigo.json */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const escapar = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const num = (v, dec = 2) => (v === undefined || v === null ? "—" :
    Number(v).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
  const ent = (v) => (v === undefined || v === null ? "—" : Number(v).toLocaleString("es-AR"));

  let ZONAS = [];
  let tabla = false;

  function ficha(z) {
    const filas = [
      ["F.O.S.", z.fos !== undefined ? num(z.fos) : "—"],
      ["F.O.T.", z.fot !== undefined ? num(z.fot) + (z.fot_alt ? ` <small>· ${escapar(z.fot_alt)}</small>` : "") : "—"],
      ["Densidad neta", z.densidad !== undefined ? `${ent(z.densidad)} hab/ha` : "—"],
      ["Lote mínimo", z.superficie ? `${ent(z.superficie)} m² · frente ${ent(z.frente)} m · fondo ${ent(z.fondo)} m` : "—"],
      ["Retiro de frente", z.retiro_frente || "—"],
      ["Retiro de fondo", z.retiro_fondo || "—"],
      ["Retiro lateral", z.retiro_lateral || "—"],
      ["Altura", z.altura || "—"],
      ["Viviendas por lote", z.viviendas || "—"],
      ["Uso dominante", z.dominante || "—"],
      ["Uso complementario", z.complementario || "Según planilla general de usos"],
      ["Característica edilicia", z.edilicia || "—"]
    ];
    return `<article class="zona zona-${escapar(z.familia.toLowerCase())}">
      <header>
        <span class="codigo">${escapar(z.codigo)}</span>
        <h2>${escapar(z.nombre)}</h2>
      </header>
      <dl>${filas.map(([k, v]) => `<dt>${escapar(k)}</dt><dd>${v === "—" ? "—" : (k === "F.O.T." ? v : escapar(v))}</dd>`).join("")}</dl>
      ${z.notas && z.notas.length ? `<details><summary>Condiciones particulares (${z.notas.length})</summary>
        <ul>${z.notas.map((n) => `<li>${escapar(n)}</li>`).join("")}</ul></details>` : ""}
    </article>`;
  }

  function comoTabla(lista) {
    const cab = ["Zona", "Área", "F.O.S.", "F.O.T.", "Densidad (hab/ha)", "Lote mínimo (m²)", "Frente (m)", "Altura"];
    return `<table class="tabla">
      <thead><tr>${cab.map((c) => `<th>${escapar(c)}</th>`).join("")}</tr></thead>
      <tbody>${lista.map((z) => `<tr>
        <td><strong>${escapar(z.codigo)}</strong></td>
        <td>${escapar(z.nombre)}</td>
        <td>${z.fos !== undefined ? num(z.fos) : "—"}</td>
        <td>${z.fot !== undefined ? num(z.fot) : "—"}</td>
        <td>${ent(z.densidad)}</td>
        <td>${ent(z.superficie)}</td>
        <td>${ent(z.frente)}</td>
        <td>${escapar(z.altura || "—")}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  function pintar() {
    const q = normalizar($("buscar").value.trim());
    const fam = $("familia").value;
    const orden = $("orden").value;
    let lista = ZONAS.filter((z) => {
      if (fam && z.familia !== fam) return false;
      if (!q) return true;
      return normalizar(JSON.stringify(z)).includes(q);
    });
    const desc = (campo) => (a, b) => (b[campo] ?? -1) - (a[campo] ?? -1);
    if (orden !== "codigo") lista = [...lista].sort(desc(orden));
    $("conteo").textContent = `${lista.length} ${lista.length === 1 ? "zona" : "zonas"} de ${ZONAS.length}`;
    $("zonas").innerHTML = lista.length ? lista.map(ficha).join("") : `<p class="nota">No hay zonas que coincidan con la búsqueda.</p>`;
    $("tabla").innerHTML = comoTabla(lista);
    $("zonas").hidden = tabla;
    $("tabla").hidden = !tabla;
  }

  async function iniciar() {
    try {
      const r = await fetch("data/zonas_codigo.json", { cache: "no-cache" });
      const d = await r.json();
      ZONAS = d.zonas;
      $("referencia").textContent = d.referencia;
      $("advertencia").textContent = d.advertencia;
      const familias = [...new Set(ZONAS.map((z) => z.familia))].sort((a, b) => a.localeCompare(b, "es"));
      $("familia").insertAdjacentHTML("beforeend", familias.map((f) => `<option value="${escapar(f)}">${escapar(f)}</option>`).join(""));
    } catch (err) {
      $("zonas").innerHTML = `<p class="nota">No se pudo leer data/zonas_codigo.json.</p>`;
      return;
    }
    ["buscar", "familia", "orden"].forEach((id) => $(id).addEventListener("input", pintar));
    $("verTabla").addEventListener("click", () => {
      tabla = !tabla;
      $("verTabla").textContent = tabla ? "Ver como fichas" : "Ver como tabla";
      pintar();
    });
    pintar();
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
