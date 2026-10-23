import json
from pathlib import Path

from app.main import app

SNAPSHOT = Path(__file__).resolve().parents[2] / "app" / "openapi.json"


def test_the_apps_openapi_snapshot_is_up_to_date():
    """The app's TypeScript types are generated from `app/openapi.json`. If a route or a field
    changed and the snapshot was not refreshed, the app would be checked against an old API."""
    assert json.loads(SNAPSHOT.read_text()) == app.openapi(), (
        "app/openapi.json is out of date: run `npm run gen:api` in app/ and commit the result"
    )
