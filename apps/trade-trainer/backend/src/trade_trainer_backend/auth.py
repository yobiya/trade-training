"""パスワード認証 + HttpOnly Cookie セッション(仕様書 15.6)。"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from trade_trainer_backend.config import Settings, get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


def require_auth(request: Request) -> None:
    if not request.session.get("authenticated"):
        raise HTTPException(status_code=401, detail="Not authenticated")


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> dict[str, bool]:
    if body.password != settings.app_password:
        raise HTTPException(status_code=401, detail="Invalid password")
    request.session["authenticated"] = True
    return {"authenticated": True}


@router.post("/logout")
async def logout(request: Request) -> dict[str, str]:
    request.session.clear()
    return {"status": "ok"}


@router.get("/me")
async def me(request: Request) -> dict[str, bool]:
    return {"authenticated": bool(request.session.get("authenticated"))}
