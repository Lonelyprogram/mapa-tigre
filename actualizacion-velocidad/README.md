# Geoportal de Tigre — IDEAR Tigre

Sitio estático en Leaflet para publicar capas del Municipio de Tigre. No necesita servidor ni base de datos: todo se define en `data/config.json` y las capas son archivos GeoJSON dentro de `data/`.

## Marca y encabezado

La barra superior muestra el logo de IDEAR Tigre y el menú de secciones. El logo se toma de `img/logo-idear.png`: subí ahí el archivo (PNG o SVG con fondo transparente, unos 64 px de alto) y aparece solo. Si el archivo no está, queda el texto "IDEAR TIGRE" y no se rompe nada.

Para usar el dominio propio (ideartigre.com), en Settings → Pages del repositorio se carga el dominio en "Custom domain" y en el panel del proveedor del dominio se apuntan los registros que GitHub indica.

## Qué hace

- Muestra las capas agrupadas en categorías (Desarrollo urbano, Desarrollo humano, Seguridad, Movilidad, Espacio público y Censos), cada una con dos descargas: **GeoJSON** (para QGIS) y **CSV** (la tabla de atributos con las coordenadas del centro de cada elemento, para abrir en Excel).
- Tiene cuatro mapas base gratuitos y sin clave: Argenmap gris y Argenmap color (IGN), OpenStreetMap y satelital (Esri).
- En "Explorar datos" se elige una capa y una variable. El mapa se colorea por clases (cuantiles o intervalos iguales) y el panel muestra un histograma con un filtro por rango. Las variables de texto se filtran por categoría.
- Al hacer clic en un elemento se abre una ficha con sus atributos y su posición frente al resto de la capa en cada variable.
- Tiene un buscador por nombre en las capas que lo tengan configurado.
- La vista se guarda en la dirección (zoom, capa, variable y filtro), así que se puede compartir el link exacto.
- Funciona en celulares con el panel desplegable desde abajo y respeta el modo oscuro del sistema.

## Estructura

```
index.html          página
css/estilos.css     estilos
js/app.js           lógica (no hace falta tocarlo para sumar capas)
data/config.json    títulos, mapas base y capas
data/*.geojson      capas
.nojekyll           evita que GitHub Pages procese el sitio
```

## Publicar en GitHub Pages

1. Creá un repositorio público en GitHub (por ejemplo `mapa-tigre`).
2. Subí todo el contenido de esta carpeta a la raíz del repositorio. Desde la web: "Add file" y después "Upload files", arrastrando los archivos y carpetas.
3. En el repositorio, entrá a Settings, luego Pages. En "Build and deployment" elegí "Deploy from a branch", rama `main`, carpeta `/ (root)`, y guardá.
4. En uno o dos minutos el sitio queda en `https://TU-USUARIO.github.io/mapa-tigre/`.

Cada vez que se sube un cambio al repositorio, el sitio se actualiza solo.

## Sumar una capa nueva

### 1. Exportarla desde QGIS

Clic derecho sobre la capa, luego Exportar y "Guardar objetos como…":

- Formato: GeoJSON
- SRC: EPSG:4326 - WGS 84
- Codificación: UTF-8
- En "Opciones de capa", `COORDINATE_PRECISION` = 6
- Nombre de archivo sin espacios ni acentos, por ejemplo `escuelas.geojson`

Si la capa es muy pesada (más de 5 MB), simplificala antes con Vectorial, Herramientas de geometría, Simplificar.

### 2. Revisarla en el modo equipo

Abrí el sitio agregando `?equipo` a la dirección (por ejemplo `https://TU-USUARIO.github.io/mapa-tigre/?equipo`). Aparece la sección "Probar una capa nueva". Al cargar el archivo:

- se dibuja en el mapa (solo en tu navegador, nadie más la ve),
- avisa si el sistema de referencia está mal, si cae fuera de Tigre, si pesa mucho o si tiene acentos rotos (con un botón para repararlos y descargar el archivo corregido),
- arma el bloque de configuración listo para copiar.

### 3. Publicarla

1. Subí el archivo a la carpeta `data/` del repositorio.
2. Abrí `data/config.json` en GitHub (ícono del lápiz), pegá el bloque dentro de la lista `"capas"` y separalo con una coma de la capa anterior.
3. Ajustá los nombres visibles (`nombre`, alias en `campos`, `nombre` de cada variable) y guardá con "Commit changes".

Si el JSON queda mal escrito, el sitio lo avisa en pantalla. Un validador como jsonlint.com ayuda a encontrar la coma o llave que falta.

## Referencia de `config.json`

Cada capa admite:

| Clave | Uso |
|---|---|
| `id` | Identificador único, sin espacios. |
| `nombre` | Nombre visible en el panel. |
| `grupo` | Título del grupo en la lista de capas. |
| `archivo` | Ruta al GeoJSON, por ejemplo `data/escuelas.geojson`. |
| `geometria` | `poligono`, `linea` o `punto`. |
| `visible` | `true` si se muestra al abrir el sitio. |
| `titulo` | Campo que se usa como título de la ficha y en el globo al pasar el mouse. |
| `busqueda` | Campo en el que busca el buscador. Si falta, la capa no aparece en la búsqueda. |
| `fuente` | Texto de la fuente, se muestra en "Explorar datos". |
| `estilo` | `color` (borde), `relleno`, `opacidadRelleno`, `grosor`, `radio` (puntos), `guiones` (línea punteada), `soloBorde`, `radioSegun` (tamaño del punto según un campo), `colorSegun` y `colores` (color fijo por valor de un campo, como cada línea de colectivo). |
| `ordenMapa` | Opcional. Controla qué capa se dibuja encima: menor número, más arriba. Por defecto vale el orden de la lista. |
| `campos` | Campos que muestra la ficha, con su nombre visible: `{"campo": "Nombre visible"}`. Si falta, muestra todos. |
| `variables` | Lista de variables para explorar (ver abajo). |
| `clasificacion` | `cuantiles` (por defecto) o `intervalos`. |
| `clases` | Cantidad de clases, de 2 a 5. |

Cada variable admite:

| Clave | Uso |
|---|---|
| `campo` | Campo de la capa con el valor. |
| `id` y `series` | Para una variable con varios años: `"id": "nbi", "series": {"2001": "nbi_2001", "2022": "nbi_2022"}`. Aparece un selector de año y los colores usan los mismos cortes en todos los años. |
| `nombre`, `grupo` | Nombre visible y grupo dentro del desplegable. |
| `unidad`, `decimales`, `descripcion` | Formato y texto de ayuda. |
| `tipo` | `categoria` para variables de texto; si no se indica, se trata como número. |
| `paleta` | `divergente` para variaciones: los cortes quedan simétricos alrededor de cero. |
| `invertir` | `true` invierte los colores (por ejemplo, para que una baja del NBI se vea en verde azulado). |
| `limites` | `[mínimo, máximo]` del histograma y el filtro, para que unos pocos valores extremos no aplasten el gráfico. |
| `cortes` | Cortes de clase fijos, por ejemplo `[10, 25, 50]`. Útil cuando muchos valores son cero y los cuantiles no sirven. |
| `clasificacion`, `clases` | Igual que a nivel de capa, pero solo para esa variable. |
| `colores` | Para variables de categoría: color fijo por valor, por ejemplo `{"Alto": "#9A4A2B"}`. |

A nivel general, `explorarInicial` define qué capa y variable se muestran al abrir el sitio, y en `estilo` la opción `"soloBorde": true` dibuja solo el contorno (útil para límites que van por encima de otras capas, porque no tapan los clics).

El orden de las capas en `config.json` define qué queda arriba en el mapa: la primera de la lista se dibuja por encima de las demás.

## Probar en la computadora

El navegador no deja leer las capas si se abre `index.html` con doble clic. Desde la carpeta del proyecto:

```
python -m http.server 8000
```

y abrir `http://localhost:8000`.

## Cómo carga el sitio

Al abrir, el sitio trae solo las capas que arrancan encendidas (unos 50 KB). El resto se descarga en segundo plano, sin frenar el mapa, y cualquier capa que se prenda antes de estar lista se trae en el momento. En `config.json`, `"soloAlPrender": true` excluye una capa de esa carga en segundo plano: conviene para las pesadas, como las manzanas. Con ahorro de datos activado o conexión lenta, todas las capas esperan a que las prendan.

## Capas en teselas (parcelario)

El parcelario de ARBA son 103.806 parcelas: demasiado para un solo archivo. Está partido en 122 teselas bajo `data/parcelas/14/{x}/{y}.geojson`, y el sitio carga solo las que entran en pantalla, a partir del zoom 16. En `config.json` la capa se declara con `"tipo": "teselas"`, `"plantilla"`, `"zoomTeselas"` y `"zoomMinimo"`. Para regenerar las teselas desde un shapefile nuevo hay que volver a partirlo con el mismo esquema (z14, coordenadas a 6 decimales) y reemplazar la carpeta.

## Código de zonificación

`zonificacion.html` muestra las planillas de indicadores urbanos por zona (F.O.S., F.O.T., densidad, lote mínimo, retiros, altura y condiciones particulares), a partir de `data/zonas_codigo.json`. Para editar un dato o sumar una zona alcanza con tocar ese archivo.

Falta el plano de zonificación en formato SIG. Cuando esté, se suma como capa de polígonos y se puede colorear el parcelario por zona.

## Datos incluidos

- `parcelas/` y `manzanas.geojson`: parcelario y manzanas de ARBA del partido de Tigre (110.101 y 110.102), con partida, nomenclatura catastral, tipo y superficie.
- `barrios_populares.geojson`: los 67 barrios populares de Tigre del Registro Nacional de Barrios Populares (RENABAP, base 2023 con 6.467 barrios en el país). Además de los campos originales, trae categorías resumidas de luz, agua y cloaca y la cantidad de esos servicios que llegan por red. En `radios_censales.geojson`, `renabap_pct` es la parte de cada radio ocupada por barrios populares y `renabap_fam` reparte las familias de cada barrio según la superficie compartida.

- `valor_suelo.geojson`: mapa de valor del suelo en hexágonos de 500 m (de lado a lado), a partir del Monitor del Mercado Inmobiliario de Tigre, Edición N°2, corte 1/9/2026. Cada celda resume al menos 5 avisos de venta y trae la mediana ponderada de USD/m², el rango habitual, la cantidad de avisos y la diferencia con la mediana del partido. Se descartaron los avisos con coordenadas genéricas (10 o más en el mismo punto) y los que caen fuera de Tigre.
- En `radios_censales.geojson`, los campos `oferta_usd_m2` y `oferta_avisos` resumen esos avisos por radio (mediana ponderada, mínimo 5 avisos, sin coordenadas compartidas).

- `radios_censales.geojson`: radios del Censo 2022 de Tigre con indicadores de 2022 y de 2001. Los datos salen del plugin de QGIS "Censo Argentino" (INDEC vía Source.Coop) y la cartografía de radios es de Rodríguez y de Grande (CONICET). Los conteos de 2001 se llevaron a los radios de 2022 por interpolación de áreas (cada radio de 2001 reparte su población según la superficie que comparte con cada radio de 2022), y los porcentajes se calcularon después de interpolar.

- `tigre_limite.geojson`: límite del partido de Tigre (ARBA, vía IGN).
- Equipamiento y servicios del IGN: `educacion`, `salud`, `seguridad`, `bomberos`, `cultura`, `deporte`, `culto`, `estaciones_servicio`, `reciclaje`, `espacios_verdes` y `areas_industriales`. Los archivos originales tenían los acentos dañados (se habían guardado con otra codificación); se repararon con un diccionario de español y una lista revisada a mano de nombres propios. Conviene corregir en origen cualquier nombre que haya quedado mal.
- Transporte: `estaciones_tren`, `ferrocarril` y `rutas` (IGN) y `colectivos` (recorridos nacionales, provinciales y municipales).
- `localidades.geojson`: punto de referencia de cada localidad según INDEC.
- `region_partidos.geojson`: Tigre y partidos limítrofes, con superficie, perímetro y compacidad (índice de Polsby-Popper) calculados en POSGAR 2007 faja 5.

`region_partidos.geojson` proviene del SIG250 del Instituto Geográfico Nacional (a través del repositorio `mgaitan/departamentos_argentina`). Es cartografía a escala 1:250.000: sirve de referencia general, pero conviene reemplazarla por el límite oficial municipal cuando esté disponible.
