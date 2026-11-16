"""Refresh the educational WTI/Henry Hub monthly price snapshot from FRED.

The FRED series source is the U.S. Energy Information Administration.
Run from any directory: python3 automation/refresh-decision-prices.py
The newest month is partial until all daily observations are published.
"""
import collections
import csv
import datetime
import io
import json
from pathlib import Path
from urllib.request import urlopen

SERIES = {"oil": "DCOILWTICO", "gas": "DHHNGSP"}
monthly = {}
for name, code in SERIES.items():
    with urlopen("https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + code, timeout=30) as response:
        text = response.read().decode("utf-8")
    values = collections.defaultdict(list)
    for row in csv.DictReader(io.StringIO(text)):
        try:
            date = row["observation_date"]
            if date >= "2010-01-01":
                values[date[:7]].append(float(row[code]))
        except (ValueError, KeyError):
            continue
    monthly[name] = {key: round(sum(items) / len(items), 4) for key, items in values.items()}

months = sorted(set(monthly["oil"]) & set(monthly["gas"]))
if len(months) < 60:
    raise RuntimeError("Insufficient paired price observations; existing snapshot retained.")
output = {
    "source": "FRED / U.S. Energy Information Administration",
    "retrieved": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
    "series": {
        "oil": "DCOILWTICO, Cushing WTI spot dollars per barrel",
        "gas": "DHHNGSP, Henry Hub spot dollars per million Btu",
    },
    "aggregation": "Arithmetic mean of available daily observations within each month; latest month can be partial.",
    "rows": [{"month": month, "oil": monthly["oil"][month], "gas": monthly["gas"][month]} for month in months],
}
destination = Path(__file__).resolve().parents[1] / "courses/data/eia-monthly-prices.json"
destination.write_text(json.dumps(output, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"Wrote {len(months)} monthly observations through {months[-1]} to {destination}")
