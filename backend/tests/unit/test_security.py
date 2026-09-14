"""app/core/security.py - tokens and password hashing."""

import base64
import json
from datetime import timedelta

import pytest
from jose import jwt
from jose.exceptions import JWTError

from app.core import security
from app.core.config import settings


# --- access tokens ----------------------------------------------------------


def test_a_token_round_trips_its_subject():
    claims = security.decode_token(security.create_access_token(subject=42))
    assert claims["sub"] == "42"


def test_the_subject_is_stringified():
    """JWT sub is a string by spec, and deps.get_current_user calls int() on the
    way back. An int here would decode, but inconsistently."""
    claims = security.decode_token(security.create_access_token(subject=42))
    assert isinstance(claims["sub"], str)


def test_the_college_is_bound_into_the_token():
    """So a token minted for one college cannot be replayed against another."""
    claims = security.decode_token(security.create_access_token(subject=1, college_id=7))
    assert claims["college_id"] == 7


def test_a_platform_admin_token_carries_no_college():
    """super_admin has college_id None and crosses tenants; the claim is simply
    absent rather than null."""
    claims = security.decode_token(security.create_access_token(subject=1, college_id=None))
    assert "college_id" not in claims


def test_college_id_zero_is_still_recorded():
    """Guards the `is not None` check against decaying into a truthiness test."""
    claims = security.decode_token(security.create_access_token(subject=1, college_id=0))
    assert claims["college_id"] == 0


def test_a_token_carries_an_expiry():
    assert "exp" in security.decode_token(security.create_access_token(subject=1))


def test_an_expired_token_is_rejected():
    token = security.create_access_token(subject=1, expires_delta=timedelta(seconds=-1))
    with pytest.raises(JWTError):
        security.decode_token(token)


def test_a_token_inside_its_window_is_accepted():
    token = security.create_access_token(subject=1, expires_delta=timedelta(minutes=5))
    assert security.decode_token(token)["sub"] == "1"


def test_a_tampered_token_is_rejected():
    token = security.create_access_token(subject=1)
    head, payload, signature = token.split(".")
    forged = f"{head}.{payload}.{signature[:-4]}AAAA"
    with pytest.raises(JWTError):
        security.decode_token(forged)


def test_a_token_signed_with_another_key_is_rejected():
    """What a leaked-and-rotated SECRET_KEY looks like, and what an attacker
    minting their own would produce."""
    forged = jwt.encode({"sub": "1"}, "a-different-secret", algorithm=settings.ALGORITHM)
    with pytest.raises(JWTError):
        security.decode_token(forged)


def test_an_unsigned_token_is_rejected():
    """The alg=none attack: a token declaring it needs no signature.

    Hand-assembled, because python-jose refuses to *encode* alg=none at all -
    which is reassuring but means the decode path still needs proving.
    """

    def b64(payload: dict) -> str:
        raw = json.dumps(payload, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    forged = f'{b64({"alg": "none", "typ": "JWT"})}.{b64({"sub": "1"})}.'
    with pytest.raises(JWTError):
        security.decode_token(forged)


@pytest.mark.parametrize("garbage", ["", "not-a-token", "a.b.c", "Bearer x"])
def test_malformed_tokens_raise_jwterror_and_nothing_else(garbage):
    """deps.get_current_user catches only JWTError; anything else escapes as a
    500 where a 401 belongs."""
    with pytest.raises(JWTError):
        security.decode_token(garbage)


# --- passwords --------------------------------------------------------------
# bcrypt is deliberately slow, so this section stays small on purpose.


def test_a_password_verifies_against_its_own_hash():
    hashed = security.get_password_hash("correct horse battery staple")
    assert security.verify_password("correct horse battery staple", hashed) is True


def test_the_wrong_password_does_not_verify():
    hashed = security.get_password_hash("correct horse battery staple")
    assert security.verify_password("Correct Horse Battery Staple", hashed) is False


def test_hashes_are_salted():
    """Two accounts sharing a password must not share a hash."""
    assert security.get_password_hash("same") != security.get_password_hash("same")
