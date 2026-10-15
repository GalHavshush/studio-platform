from app.security import hash_password, verify_password


def test_hash_is_not_the_password_and_is_salted():
    h1, h2 = hash_password("s3cret-pw"), hash_password("s3cret-pw")

    assert "s3cret-pw" not in h1
    assert h1.startswith("$argon2id$")
    assert h1 != h2  # random salt: same password, different hash


def test_verify_accepts_right_password_and_rejects_wrong_one():
    h = hash_password("s3cret-pw")

    assert verify_password("s3cret-pw", h)
    assert not verify_password("wrong-pw", h)
