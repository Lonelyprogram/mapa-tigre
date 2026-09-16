# Mapa de Tigre — geoportal

Sitio estático en Leaflet para publicar capas del Municipio de Tigre. No necesita servidor ni base de datos: todo se define en `data/config.json` y las capas son archivos GeoJSON dentro de `data/`.

## Qué hace

- Muestra las capas agrupadas, con descarga en GeoJSON de cada una.
- Tiene tres mapas base: calles (CARTO), Argenmap (IGN) y satelital (Esri).
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
| `estilo` | `color` (borde), `relleno`, `opacidadRelleno`, `grosor`, `radio` (puntos). |
| `campos` | Campos que muestra la ficha, con su nombre visible: `{"campo": "Nombre visible"}`. Si falta, muestra todos. |
| `variables` | Lista de variables para explorar (ver abajo). |
| `clasificacion` | `cuantiles` (por defecto) o `intervalos`. |
| `clases` | Cantidad de clases, de 2 a 5. |

Cada variable admite `campo`, `nombre`, `unidad`, `decimales`, `descripcion` y `tipo` (`categoria` para variables de texto; si no se indica, se trata como número).

El orden de las capas en `config.json` define qué queda arriba en el mapa: la primera de la lista se dibuja por encima de las demás.

## Probar en la computadora

El navegador no deja leer las capas si se abre `index.html` con doble clic. Desde la carpeta del proyecto:

```
python -m http.server 8000
```

y abrir `http://localhost:8000`.

## Datos incluidos

- `tigre_limite.geojson`: límite del partido de Tigre.
- `region_partidos.geojson`: Tigre y partidos limítrofes, con superficie, perímetro y compacidad (índice de Polsby-Popper) calculados en POSGAR 2007 faja 5.

Ambas capas provienen del SIG250 del Instituto Geográfico Nacional (a través del repositorio `mgaitan/departamentos_argentina`). Es cartografía a escala 1:250.000: sirve de referencia general, pero conviene reemplazarla por el límite oficial municipal cuando esté disponible.
