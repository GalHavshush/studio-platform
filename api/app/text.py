"""Rules shared by every piece of text a client can send us."""

from pydantic import AfterValidator


def _no_nul(value: str) -> str:
    # Postgres text cannot hold a NUL byte: the driver would raise and the client would get a 500.
    if "\x00" in value:
        raise ValueError("must not contain a NUL character")
    return value


# Add to the end of every free-text field that is stored: `Annotated[str, StringConstraints(...), NoNul]`.
NoNul = AfterValidator(_no_nul)
