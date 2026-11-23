# EduRed – TB1 Complejidad Algorítmica

Interfaz web interactiva para el grafo de 1500 II.EE. públicas de Lima.

**Todo el código de algoritmos está en Python**: `python/grafo_donaciones.py`
(UFDS, Bellman-Ford, reconstrucción de caminos, voraz de distribución, modelo de tráfico
y resumen por tramo). La web ejecuta ese mismo archivo en el navegador con
[Pyodide](https://pyodide.org) (Python compilado a WebAssembly), así que no hace falta
servidor ni pagar hosting. JavaScript solo dibuja el mapa y maneja los clics.

## Ejecutar el código Python en consola

```
python python/grafo_donaciones.py
```

Imprime las componentes del UFDS y el plan de distribución del ejemplo
(origen 210 → 9 destinos: **39.767 km**, igual que el notebook) y el mismo caso con tráfico.
Solo usa la librería estándar.

## Qué se puede hacer en la web

- **Simulación**: elegir origen y destinos haciendo clic en el mapa o con el buscador,
  ejecutar el plan (UFDS valida conectividad → voraz + Bellman-Ford en Python), ver el
  orden de entregas, el costo de cada tramo, iteraciones/relajaciones de Bellman-Ford,
  comparar con el orden en que se eligieron los destinos y **animar el recorrido**.
- **Peso de las aristas**:
  - `distancia_km`
  - **Modelo de tráfico**: `peso = distancia × f_hora × f_día × f_clima × f_zona`
    - Hora: 06:00, 08:00 (=2.0, igual al dataset), 11:00, 13:00, 15:00, 18:00, 21:00, 23:00
    - Día: laborable, sábado, domingo/feriado
    - Clima: despejado, garúa, lluvia fuerte
    - Congestión por distrito (alta / media / baja), mayor en hora punta. Como varía por
      arista, puede cambiar la ruta y no solo el costo.
    Los factores son supuestos del modelo y se ajustan en la sección 2 del archivo Python.
- **Explorar grafo**: colorear por integrante, componente, grado o congestión; ver el
  subgrafo de cada tramo (Josue, Alexs, Maria, Gabriel) y su resumen (sección 9 del notebook).
- **Conectividad**: las 6 componentes del UFDS; clic para resaltarlas.

## Estructura

```
index.html                  página
css/styles.css              estilos (paleta: #080708, #3772FF, #DF2935, #E6E8E6)
js/app.js                   mapa Leaflet + interacción (llama a Python vía Pyodide)
python/grafo_donaciones.py  TODA la lógica de grafos
data/grafo.json             nodos y aristas exportados del Excel
scripts/exportar_datos.py   regenera data/grafo.json desde el Excel
```

Si cambian el Excel:

```
python scripts/exportar_datos.py "dataset_1500_instituciones_educativas_nodos.xlsx"
```

## Probar en tu computadora

```
python -m http.server 8000
```

y abrir http://localhost:8000. La primera carga descarga Pyodide (~10 MB, unos segundos).

## Desplegar gratis

### Opción A – GitHub Pages (recomendada, sin instalar nada)
1. Crear cuenta en https://github.com (gratis).
2. **New repository** → nombre p. ej. `tb1-donaciones` → **Public** → Create.
3. **uploading an existing file** → arrastrar *el contenido* de esta carpeta
   (`index.html`, `css`, `js`, `python`, `data`, `scripts`, `README.md`) → **Commit changes**.
4. **Settings → Pages → Branch: `main` / `(root)` → Save**.
5. En 1–2 minutos queda en `https://TU-USUARIO.github.io/tb1-donaciones/`.

### Opción B – Netlify Drop
1. Crear cuenta gratis en https://app.netlify.com.
2. Ir a https://app.netlify.com/drop y arrastrar la carpeta `tb1-donaciones-web`.

Todo lo usado es gratuito y libre: Python, Pyodide (MPL-2.0), Leaflet (BSD) y
OpenStreetMap (ODbL, con atribución).
