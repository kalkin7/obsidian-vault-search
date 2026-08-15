"""Shared service error type.

Defined in its own module so both service.py and indexing.py can raise coded
errors without a circular import. The protocol maps ServiceError to
``{code, message, details}`` responses.
"""

from __future__ import annotations


class ServiceError(RuntimeError):
    code: str
    message: str
    details: dict[str, object] | None

    def __init__(
        self, code: str, message: str, details: dict[str, object] | None = None
    ):
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)
