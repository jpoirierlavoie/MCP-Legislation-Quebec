"""Client D1 minimal, deux dorsales interchangeables :

* CloudD1 — API HTTP D1 (plan §2 : « API HTTP D1 ») : POST .../d1/database/{id}/query.
* LocalD1 — D1 local de dev via `wrangler d1 execute --local` (validation sans réseau).

Les deux exposent `run(sql) -> list[dict]` (résultats de la DERNIÈRE instruction). Le SQL est
inline (littéraux échappés via `q`) pour passer indifféremment par le corps JSON HTTP ou un
fichier `.sql`. À usage batch/migration : petites données, une instruction par appel.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from . import config

ACCOUNT_ID = "6276df02799535c0e96225fdf6184023"
DB_NAME = "qclaw"


class D1Error(Exception):
    pass


def q(v) -> str:
    """Littéral SQL sûr (None -> NULL, int tel quel, str échappée)."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def _database_id() -> str:
    txt = (config.REPO_ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
    m = re.search(r'"database_id"\s*:\s*"([^"]+)"', txt)
    if not m:
        raise D1Error("database_id introuvable dans wrangler.jsonc")
    return m.group(1)


class CloudD1:
    name = "cloud"

    def __init__(self, token: str):
        self._url = (f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}"
                     f"/d1/database/{_database_id()}/query")
        self._token = token

    def run(self, sql: str) -> list[dict]:
        body = json.dumps({"sql": sql}).encode("utf-8")
        req = urllib.request.Request(
            self._url, data=body, method="POST",
            headers={"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"},
        )
        d = json.loads(urllib.request.urlopen(req, timeout=120).read().decode("utf-8"))
        if not d.get("success"):
            raise D1Error(json.dumps(d.get("errors"), ensure_ascii=False))
        results = d.get("result") or []
        return results[-1].get("results", []) if results else []


class LocalD1:
    name = "local"

    def run(self, sql: str) -> list[dict]:
        tmp = Path(tempfile.gettempdir()) / "qclaw_d1_stmt.sql"
        tmp.write_text(sql, encoding="utf-8", newline="\n")
        cmd = f'npx wrangler d1 execute {DB_NAME} --local --file="{tmp}" --json'
        p = subprocess.run(cmd, shell=True, cwd=config.REPO_ROOT,
                           capture_output=True, text=True, encoding="utf-8")
        if p.returncode != 0:
            raise D1Error(p.stderr or p.stdout)
        out = p.stdout.strip()
        start = out.find("[")  # --json peut être précédé d'un avertissement
        data = json.loads(out[start:]) if start >= 0 else []
        return data[-1].get("results", []) if data else []


def make_client(target: str):
    if target == "cloud":
        token = os.environ.get("CLOUDFLARE_API_TOKEN")
        if not token:
            raise D1Error("CLOUDFLARE_API_TOKEN manquant pour --target cloud")
        return CloudD1(token)
    return LocalD1()
