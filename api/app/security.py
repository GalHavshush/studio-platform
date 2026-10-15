from pwdlib import PasswordHash

# recommended() = argon2id with library defaults. Each hash embeds its own random salt and
# parameters, so verify needs only the stored string.
_hasher = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _hasher.verify(password, password_hash)
