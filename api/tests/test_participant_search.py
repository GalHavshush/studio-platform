from datetime import UTC, datetime

import pytest

from app.models import Membership, Participant, User


async def person(db_session, studio, name, *, deleted=False) -> Participant:
    """A member of the studio with this display name (a deleted account when `deleted`)."""
    user = User(
        email=f"{name.lower().replace(' ', '.')}@{studio.id}.example.com",
        name=name,
        deleted_at=datetime.now(UTC) if deleted else None,
    )
    db_session.add(user)
    await db_session.flush()
    row = Participant(tenant_id=studio.id, user_id=user.id, name=name)
    db_session.add_all([Membership(tenant_id=studio.id, user_id=user.id, role="member"), row])
    await db_session.flush()
    return row


async def search(client, two_tenants, studio, role, **params):
    return await client.get(
        "/participants",
        params=params,
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


def names(response):
    return [hit["name"] for hit in response.json()]


# --- who may ask ---


async def test_a_member_gets_403(client, two_tenants):
    response = await search(client, two_tenants, two_tenants.a, "member", q="a")

    assert response.status_code == 403
    assert response.json() == {"detail": "insufficient_role"}


@pytest.mark.parametrize("role", ["coach", "owner"])
async def test_coaches_and_owners_can_search(client, two_tenants, db_session, role):
    await person(db_session, two_tenants.a, "Zelda Quill")

    response = await search(client, two_tenants, two_tenants.a, role, q="quill")

    assert response.status_code == 200
    assert names(response) == ["Zelda Quill"]


# --- matching ---


async def test_a_name_matches_anywhere_ignoring_letter_case(client, two_tenants, db_session):
    a = two_tenants.a
    for name in ("Maya Quill", "Quillian Roe", "Someone Else"):
        await person(db_session, a, name)

    assert names(await search(client, two_tenants, a, "coach", q="QUILL")) == [
        "Maya Quill",
        "Quillian Roe",
    ]
    assert names(await search(client, two_tenants, a, "coach", q="aya q")) == ["Maya Quill"]


async def test_the_search_text_is_trimmed(client, two_tenants, db_session):
    await person(db_session, two_tenants.a, "Maya Quill")

    response = await search(client, two_tenants, two_tenants.a, "coach", q="  quill  ")

    assert names(response) == ["Maya Quill"]


async def test_percent_and_underscore_are_ordinary_characters(client, two_tenants, db_session):
    a = two_tenants.a
    for name in ("Half%Off Hal", "Snake_Case Sam", "Plain Pat"):
        await person(db_session, a, name)

    assert names(await search(client, two_tenants, a, "coach", q="%")) == ["Half%Off Hal"]
    assert names(await search(client, two_tenants, a, "coach", q="_")) == ["Snake_Case Sam"]


async def test_no_match_is_an_empty_list(client, two_tenants):
    response = await search(client, two_tenants, two_tenants.a, "coach", q="nobody-has-this-name")

    assert (response.status_code, response.json()) == (200, [])


# --- the empty search, and the cap ---


async def test_an_empty_search_lists_names_alphabetically_up_to_the_cap(
    client, two_tenants, db_session
):
    a = two_tenants.a
    for i in range(25):
        await person(db_session, a, f"Cap {i:02d}")

    everyone = await search(client, two_tenants, a, "coach")  # default limit 20
    some = await search(client, two_tenants, a, "coach", q="Cap", limit=5)

    assert len(everyone.json()) == 20
    assert names(everyone) == sorted(names(everyone))
    assert names(some) == [f"Cap {i:02d}" for i in range(5)]


@pytest.mark.parametrize("limit", [0, 51, -1])
async def test_a_limit_out_of_range_is_422(client, two_tenants, limit):
    response = await search(client, two_tenants, two_tenants.a, "coach", limit=limit)

    assert response.status_code == 422


async def test_the_largest_allowed_limit_works(client, two_tenants):
    response = await search(client, two_tenants, two_tenants.a, "coach", limit=50)

    assert response.status_code == 200


# --- who can be found ---


async def test_only_this_studios_participants_are_found(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    await person(db_session, a, "Ours Quill")
    await person(db_session, b, "Theirs Quill")

    assert names(await search(client, two_tenants, a, "coach", q="quill")) == ["Ours Quill"]
    assert names(await search(client, two_tenants, b, "coach", q="quill")) == ["Theirs Quill"]


async def test_a_deleted_account_is_left_out_but_a_person_without_an_account_is_kept(
    client, two_tenants, db_session
):
    a = two_tenants.a
    await person(db_session, a, "Gone Quill", deleted=True)
    db_session.add(Participant(tenant_id=a.id, user_id=None, name="Kid Quill"))
    await db_session.flush()

    assert names(await search(client, two_tenants, a, "coach", q="quill")) == ["Kid Quill"]


async def test_a_hit_has_the_id_and_the_name_and_never_an_email(client, two_tenants, db_session):
    row = await person(db_session, two_tenants.a, "Maya Quill")

    response = await search(client, two_tenants, two_tenants.a, "coach", q="quill")

    assert response.json() == [{"id": str(row.id), "name": "Maya Quill"}]
    assert "@" not in response.text


async def test_a_nul_character_is_422_not_500(client, two_tenants):
    response = await search(client, two_tenants, two_tenants.a, "coach", q="a\x00b")

    assert response.status_code == 422
