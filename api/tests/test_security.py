from app.security import (
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)


def test_hash_is_not_the_password_and_is_salted():
    h1, h2 = hash_password("s3cret-pw"), hash_password("s3cret-pw")

    assert "s3cret-pw" not in h1
    assert h1.startswith("$argon2id$")
    assert h1 != h2  # random salt: same password, different hash


def test_verify_accepts_right_password_and_rejects_wrong_one():
    h = hash_password("s3cret-pw")

    assert verify_password("s3cret-pw", h)
    assert not verify_password("wrong-pw", h)


def test_refresh_tokens_are_random_and_hash_deterministically():
    a, b = generate_refresh_token(), generate_refresh_token()

    assert a != b
    assert hash_refresh_token(a) == hash_refresh_token(a)  # lookup needs the same hash every time
    assert hash_refresh_token(a) != hash_refresh_token(b)
    assert len(hash_refresh_token(a)) == 64  # hex SHA-256
