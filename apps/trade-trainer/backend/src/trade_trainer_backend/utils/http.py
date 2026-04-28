"""HTTPException ファクトリ(ver 1.60 で utils へ統合)。

各 router で散在していた `HTTPException(404, ...)` 等を共通化する。
"""
from fastapi import HTTPException


def not_found(detail: str = "Not found") -> HTTPException:
    return HTTPException(status_code=404, detail=detail)


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status_code=401, detail=detail)
