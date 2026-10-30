"""GET /staff: the coaches and owners an owner can choose as a class's coach."""

from app.models import ClassType


async def ask(client, two_tenants, studio, role):
    return await client.get("/staff", headers=two_tenants.headers(studio.users[role], studio.id))


async def test_the_owner_sees_the_coaches_and_owners_by_name(client, two_tenants):
    a = two_tenants.a

    response = await ask(client, two_tenants, a, "owner")

    assert response.status_code == 200
    assert response.json() == [
        {"id": str(a.users["coach"]), "name": "coach of studio-a", "role": "coach"},
        {"id": str(a.users["owner"]), "name": "owner of studio-a", "role": "owner"},
    ]


async def test_members_and_other_studios_staff_are_not_listed(client, two_tenants):
    a, b = two_tenants.a, two_tenants.b

    ids = {s["id"] for s in (await ask(client, two_tenants, a, "owner")).json()}

    assert str(a.users["member"]) not in ids
    assert not ids & {str(user) for user in b.users.values()}


async def test_a_coach_and_a_member_cannot_list_staff(client, two_tenants):
    for role in ("coach", "member"):
        response = await ask(client, two_tenants, two_tenants.a, role)

        assert (response.status_code, response.json()) == (403, {"detail": "insufficient_role"})


async def test_the_staff_list_needs_a_login(client):
    assert (await client.get("/staff")).status_code == 401


async def test_everyone_listed_can_be_named_as_the_coach(client, two_tenants, db_session):
    """The list and `POST /sessions` are one rule: what the list offers, the create route accepts."""
    a = two_tenants.a
    class_type = ClassType(tenant_id=a.id, name="Yoga")
    db_session.add(class_type)
    await db_session.flush()
    class_type_id = str(class_type.id)  # an endpoint's commit expires the object

    for person in (await ask(client, two_tenants, a, "owner")).json():
        response = await client.post(
            "/sessions",
            json={
                "class_type_id": class_type_id,
                "starts_at": "2030-01-01T10:00:00+00:00",
                "ends_at": "2030-01-01T11:00:00+00:00",
                "coach_id": person["id"],
            },
            headers=two_tenants.headers(a.users["owner"], a.id),
        )
        assert response.status_code == 201
