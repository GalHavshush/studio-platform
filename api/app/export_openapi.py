"""Writes the API's OpenAPI schema to a file: the input of the app's `npm run gen:api`.

    uv run python -m app.export_openapi ../app/openapi.json

Needs no database or environment variables. The file is only written once the schema is built, so
a failure cannot leave a half-written snapshot behind.
"""

import json
import sys
from pathlib import Path

from app.main import app


def main(path: str) -> None:
    # sort_keys + indent: the same schema always gives the same bytes, so git diffs are readable.
    Path(path).write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
