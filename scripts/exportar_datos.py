"""
Convierte el dataset Excel del TB1 a un JSON liviano que usa la interfaz web.

Uso:
    python scripts/exportar_datos.py "ruta/dataset_1500_instituciones_educativas_nodos.xlsx"

Genera: data/grafo.json
"""
import json
import sys
from pathlib import Path

import pandas as pd

ARCHIVO = sys.argv[1] if len(sys.argv) > 1 else "dataset_1500_instituciones_educativas_nodos.xlsx"
SALIDA = Path(__file__).resolve().parent.parent / "data" / "grafo.json"

nodos = pd.read_excel(ARCHIVO, sheet_name="Nodos_1500")
aristas = pd.read_excel(ARCHIVO, sheet_name="Aristas")


def texto(v):
    return "" if pd.isna(v) else str(v).strip()


lista_nodos = []
for _, f in nodos.iterrows():
    lista_nodos.append({
        "id": int(f["ID_Nodo"]),
        "cod": int(f["Código Institución"]),
        "nom": texto(f["Nombre de SS.EE."]),
        "dis": texto(f["Distrito"]),
        "ugel": texto(f["DRE / UGEL"]),
        "dir": texto(f["Dirección"]),
        "niv": texto(f["Nivel / Modalidad"]),
        "lat": round(float(f["Latitud"]), 7),
        "lon": round(float(f["Longitud"]), 7),
    })

# [origen, destino, distancia_km, factor_trafico_08, peso_08]
lista_aristas = []
for _, f in aristas.iterrows():
    lista_aristas.append([
        int(f["origen"]),
        int(f["destino"]),
        float(f["distancia_km"]),          # precisión completa (igual que G_KM)
        float(f["factor_trafico_08"]),
        round(float(f["peso_08"]), 2),     # igual que G en el notebook: round(peso_08, 2)
    ])

SALIDA.parent.mkdir(parents=True, exist_ok=True)
with open(SALIDA, "w", encoding="utf-8") as fh:
    json.dump({"nodos": lista_nodos, "aristas": lista_aristas}, fh,
              ensure_ascii=False, separators=(",", ":"))

print(f"Nodos: {len(lista_nodos)} | Aristas: {len(lista_aristas)} -> {SALIDA}")
