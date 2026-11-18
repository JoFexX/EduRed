"""
TB1 - Distribución de donaciones a II.EE. públicas de Lima
==========================================================

Toda la lógica del proyecto

  * Construcción del grafo (lista de adyacencia)
  * Modelo de tráfico (hora, tipo de día, clima y congestión por distrito)
  * UFDS - Quick-Union ponderado (componentes conexas)
  * Bellman-Ford + reconstrucción del camino
  * Algoritmo voraz de distribución (siempre el destino pendiente más cercano)

La interfaz web ejecuta ESTE MISMO archivo en el navegador con Pyodide
"""
import json

# ============================================================
# 1. Datos y tramos de cada integrante
# ============================================================
TRAMOS = [
    ("Josue",   1,    375,  "#e0b100"),
    ("Alexs",   376,  750,  "#ff4500"),
    ("Maria",   751,  1125, "#2e8b57"),
    ("Gabriel", 1126, 1500, "#4682b4"),
]

nodos = []       # dicts con id, nom, dis, lat, lon, ...
aristas = []     # [origen, destino, distancia_km, factor_trafico_08, peso_08]
labels = []      # índice -> nombre
ids = []         # índice -> ID_Nodo
w2i = {}         # ID_Nodo -> índice
G_KM = []        # grafo con peso = distancia_km


def cargar(texto_json):
    """Carga data/grafo.json (generado por scripts/exportar_datos.py) y arma G_KM."""
    global nodos, aristas, labels, ids, w2i, G_KM
    data = json.loads(texto_json)
    nodos = data["nodos"]
    aristas = data["aristas"]
    labels, ids, w2i = [], [], {}
    for fila in nodos:
        w2i[fila["id"]] = len(labels)
        labels.append(fila["nom"])
        ids.append(fila["id"])
    G_KM = construir_grafo({"metrica": "km"})
    return len(nodos), len(aristas)


# ============================================================
# 2. Modelo de tráfico
#    peso = distancia_km x f_hora x f_dia x f_clima x f_zona
# ============================================================
# factor de la hora y qué tan hora punta es (0 = nada, 1 = máxima)
HORAS = {
    "06:00": (1.3, 0.3),
    "08:00": (2.0, 1.0),   # coincide con factor_trafico_08 del dataset
    "11:00": (1.4, 0.4),
    "13:00": (1.6, 0.6),
    "15:00": (1.3, 0.3),
    "18:00": (2.2, 1.0),
    "21:00": (1.2, 0.2),
    "23:00": (1.0, 0.0),
}
DIAS = {"Laborable": 1.0, "Sábado": 0.85, "Domingo / feriado": 0.7}
CLIMAS = {"Despejado": 1.0, "Garúa": 1.1, "Lluvia fuerte": 1.3}

# Congestion tipica por distrito
ZONA_ALTA = {
    "LIMA", "LA VICTORIA", "SAN JUAN DE LURIGANCHO", "ATE", "SAN MARTIN DE PORRES",
    "LOS OLIVOS", "COMAS", "INDEPENDENCIA", "BREÑA", "RIMAC", "SANTA ANITA",
    "EL AGUSTINO", "SANTIAGO DE SURCO", "MIRAFLORES", "SAN ISIDRO", "LINCE",
    "SURQUILLO", "SAN JUAN DE MIRAFLORES",
}
ZONA_BAJA = {
    "ANCON", "SANTA ROSA", "PUCUSANA", "SAN BARTOLO", "PUNTA NEGRA", "PUNTA HERMOSA",
    "CIENEGUILLA", "CHACLACAYO", "PACHACAMAC", "LURIN", "LURIGANCHO", "CARABAYLLO",
}
EXTRA_ZONA = {"alta": 0.35, "media": 0.15, "baja": 0.0}


def nivel_zona(distrito):
    if distrito in ZONA_ALTA:
        return "alta"
    if distrito in ZONA_BAJA:
        return "baja"
    return "media"


def factor_zona(u, v, pico):
    """Recargo por congestión del distrito: mayor en hora punta."""
    extra = (EXTRA_ZONA[nivel_zona(nodos[u]["dis"])] + EXTRA_ZONA[nivel_zona(nodos[v]["dis"])]) / 2
    return 1 + extra * pico


def peso_arista(fila, escenario, u, v):
    origen, destino, km, f08, p08 = fila
    metrica = escenario.get("metrica", "km")
    if metrica == "km":
        return km
    if metrica == "peso08":
        return round(p08, 2)
    # metrica == "trafico"
    f_hora, pico = HORAS[escenario.get("hora", "08:00")]
    f = f_hora * DIAS[escenario.get("dia", "Laborable")] * CLIMAS[escenario.get("clima", "Despejado")]
    if escenario.get("zonas", True):
        f *= factor_zona(u, v, pico)
    return km * f


def construir_grafo(escenario):
    """Lista de adyacencia no dirigida: G[u] = [(v, peso), ...]."""
    n = len(nodos)
    G = [[] for _ in range(n)]
    for fila in aristas:
        u = w2i[fila[0]]
        v = w2i[fila[1]]
        w = peso_arista(fila, escenario, u, v)
        if w < 0:
            raise ValueError("Se encontró un peso negativo.")
        G[u].append((v, w))
        G[v].append((u, w))
    return G


# ============================================================
# 3. UFDS - Quick-Union ponderado
#    s[i] < 0 indica raíz y -s[i] es el tamaño del grupo
# ============================================================
def find(s, a):
    i = a
    while s[i] >= 0:
        i = s[i]
    return i


def union(s, a, b):
    pa = find(s, a)
    pb = find(s, b)
    if pa == pb:
        return
    if s[pa] <= s[pb]:
        s[pa] += s[pb]
        s[pb] = pa
    else:
        s[pb] += s[pa]
        s[pa] = pb


def componentes(G):
    s = [-1] * len(G)
    for u in range(len(G)):
        for v, w in G[u]:
            union(s, u, v)
    tamaños = sorted([-x for x in s if x < 0], reverse=True)
    return s, tamaños


def subgrafo(G, conjunto):
    sub = sorted(conjunto)
    idx = {u: i for i, u in enumerate(sub)}
    Gs = [[] for _ in sub]
    for u in sub:
        for v, w in G[u]:
            if v in idx:
                Gs[idx[u]].append((idx[v], w))
    return Gs, sub


# ============================================================
# 4. Bellman-Ford y reconstrucción del camino
# ============================================================
def bellman_ford(G, origen):
    n = len(G)
    dist = [float("inf")] * n
    pred = [-1] * n
    dist[origen] = 0
    iteraciones = 0
    relajaciones = 0

    for _ in range(n - 1):
        cambio = False
        iteraciones += 1
        for u in range(n):
            if dist[u] == float("inf"):
                continue
            for v, peso in G[u]:
                nueva_distancia = dist[u] + peso
                if nueva_distancia < dist[v]:
                    dist[v] = nueva_distancia
                    pred[v] = u
                    cambio = True
                    relajaciones += 1
        if not cambio:
            break

    return dist, pred, iteraciones, relajaciones


def reconstruir_camino(pred, origen, destino):
    if origen == destino:
        return [origen]
    if pred[destino] == -1:
        return []
    camino = []
    actual = destino
    while actual != -1:
        camino.append(actual)
        if actual == origen:
            break
        actual = pred[actual]
    if camino[-1] != origen:
        return []
    camino.reverse()
    return camino


# ============================================================
# 5. Algoritmo voraz de distribución
# ============================================================
def planificar_distribucion(G, origen_idx, destinos_idx):
    pendientes = set(destinos_idx)
    actual = origen_idx
    ruta = [actual]
    entregas = []
    distancia_total = 0
    # Bellman-Ford desde cada punto de partida (se reutiliza para comparar órdenes)
    cache_bf = {}

    while pendientes:
        dist, pred, iteraciones, relajaciones = bellman_ford(G, actual)
        cache_bf[actual] = dist

        mejor_destino = -1
        menor_distancia = float("inf")
        for destino in sorted(pendientes):
            if dist[destino] < menor_distancia:
                menor_distancia = dist[destino]
                mejor_destino = destino
        if mejor_destino == -1:
            break

        camino = reconstruir_camino(pred, actual, mejor_destino)
        if not camino:
            break

        ruta.extend(camino[1:])
        distancia_total += menor_distancia
        candidatos = sorted(((dist[p], p) for p in pendientes))
        entregas.append({
            "desde": actual,
            "destino": mejor_destino,
            "camino": camino,
            "costo": menor_distancia,
            "iteraciones": iteraciones,
            "relajaciones": relajaciones,
            "candidatos": [{"idx": p, "dist": d} for d, p in candidatos],
        })
        pendientes.remove(mejor_destino)
        actual = mejor_destino

    return ruta, entregas, distancia_total, pendientes, cache_bf


def costo_orden_fijo(G, origen_idx, destinos_idx, cache_bf=None):
    """Costo de visitar los destinos en el orden dado (para comparar con el voraz)."""
    cache_bf = cache_bf or {}
    actual = origen_idx
    total = 0
    for d in destinos_idx:
        if actual not in cache_bf:
            cache_bf[actual] = bellman_ford(G, actual)[0]
        dist = cache_bf[actual]
        if dist[d] == float("inf"):
            return float("inf")
        total += dist[d]
        actual = d
    return total


# ============================================================
# 6. Funciones que usa la interfaz web (devuelven JSON)
# ============================================================
_cache_grafos = {}


def grafo_de(escenario):
    clave = json.dumps(escenario, sort_keys=True)
    if clave not in _cache_grafos:
        _cache_grafos[clave] = construir_grafo(escenario)
    return _cache_grafos[clave]


def _num(x):
    return None if x == float("inf") else x


def simular(origen_id, destinos_ids, escenario_json):
    """Valida con UFDS, planifica con voraz + Bellman-Ford y devuelve el resultado en JSON."""
    import time
    escenario = json.loads(escenario_json)
    G = grafo_de(escenario)
    origen_idx = w2i[int(origen_id)]
    destinos_idx = [w2i[int(x)] for x in destinos_ids]

    # 1) Validación de conectividad con UFDS
    s, _ = componentes(G)
    raiz = find(s, origen_idx)
    alcanzables = [d for d in destinos_idx if find(s, d) == raiz]
    inaccesibles = [d for d in destinos_idx if find(s, d) != raiz]

    # 2) Voraz + Bellman-Ford
    t0 = time.perf_counter()
    ruta, entregas, total, pendientes, cache = planificar_distribucion(G, origen_idx, alcanzables)
    ms = (time.perf_counter() - t0) * 1000
    fijo = costo_orden_fijo(G, origen_idx, alcanzables, cache)

    for e in entregas:
        e["candidatos"] = [{"idx": c["idx"], "dist": _num(c["dist"])} for c in e["candidatos"]]
    return json.dumps({
        "ruta": ruta,
        "entregas": entregas,
        "distanciaTotal": total,
        "pendientes": sorted(pendientes),
        "inaccesibles": inaccesibles,
        "alcanzables": alcanzables,
        "costoFijo": _num(fijo),
        "ms": ms,
    })


def info_componentes():
    """Componente de cada nodo (0 = la más grande) y tamaños."""
    s, tamaños = componentes(G_KM)
    raices = sorted({find(s, i) for i in range(len(G_KM))}, key=lambda r: s[r])
    indice = {r: k for k, r in enumerate(raices)}
    return json.dumps({"compDe": [indice[find(s, i)] for i in range(len(G_KM))], "tamanos": tamaños})


def subgrafo_tramo(ini, fin):
    mios = set(w2i[i] for i in range(ini, fin + 1))
    vecinos = set()
    for u in mios:
        for v, w in G_KM[u]:
            if v not in mios:
                vecinos.add(v)
    return mios, vecinos


def resumen_tramo(ini, fin):
    """indicadores"""
    mios, vecinos = subgrafo_tramo(ini, fin)
    G_mio, _ = subgrafo(G_KM, mios)
    G_ext, _ = subgrafo(G_KM, mios | vecinos)
    _, tam_mio = componentes(G_mio)
    _, tam_ext = componentes(G_ext)
    internas = frontera = 0
    suma_km = 0.0
    for o, d, km, f, p in aristas:
        a = ini <= o <= fin
        b = ini <= d <= fin
        if a and b:
            internas += 1
            suma_km += km
        elif a != b:
            frontera += 1
    grados = [len(G_KM[u]) for u in mios]
    return json.dumps({
        "mios": sorted(mios),
        "vecinos": sorted(vecinos),
        "filas": [
            ["II.EE.", len(mios)],
            ["Vecinos externos", len(vecinos)],
            ["Aristas internas", internas],
            ["Aristas a otros tramos", frontera],
            ["Componentes (solo tramo)", len(tam_mio)],
            ["Componentes (con vecinos)", len(tam_ext)],
            ["Grado promedio", round(sum(grados) / len(grados), 2)],
            ["Dist. media (km)", round(suma_km / internas, 3)],
        ],
    })


def opciones_trafico():
    return json.dumps({
        "horas": list(HORAS.keys()),
        "dias": list(DIAS.keys()),
        "climas": list(CLIMAS.keys()),
        "zonas": {n["dis"]: nivel_zona(n["dis"]) for n in nodos},
    })


# ============================================================
# 7. Ejecución en consola
# ============================================================
if __name__ == "__main__":
    from pathlib import Path

    ruta_json = Path(__file__).resolve().parent.parent / "data" / "grafo.json"
    n, m = cargar(ruta_json.read_text(encoding="utf-8"))
    print("Nodos:", n, "| Aristas:", m)
    _, tam = componentes(G_KM)
    print("Componentes conexas:", len(tam), tam)

    ORIGEN_ID = 210
    DESTINOS_ID = [297, 1297, 1193, 710, 78, 58, 1077, 120, 103]
    for esc in ({"metrica": "km"},
                {"metrica": "trafico", "hora": "18:00", "dia": "Laborable", "clima": "Garúa", "zonas": True}):
        r = json.loads(simular(ORIGEN_ID, DESTINOS_ID, json.dumps(esc)))
        print("\nEscenario:", esc)
        for i, e in enumerate(r["entregas"], start=1):
            print(f"{i} - ID: {ids[e['destino']]} | {labels[e['destino']]} | {e['costo']:.3f}")
        print("COSTO TOTAL:", round(r["distanciaTotal"], 3), f"({r['ms']:.0f} ms)")
