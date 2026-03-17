import os
import sys
from pathlib import Path


def _add_project_venv_site_packages() -> None:
    root = Path(__file__).resolve().parents[1]
    site_packages = root / ".venv" / "Lib" / "site-packages"
    if site_packages.exists():
        sys.path.insert(0, str(site_packages))


_add_project_venv_site_packages()

import uvicorn


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
