"""trade-trainer バックエンド FastAPI アプリ。"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from trade_trainer_backend.auth import router as auth_router
from trade_trainer_backend.config import get_settings
from trade_trainer_backend.routers.chart import router as chart_router
from trade_trainer_backend.routers.drawings import router as drawings_router
from trade_trainer_backend.routers.sessions import router as sessions_router
from trade_trainer_backend.routers.stats import router as stats_router
from trade_trainer_backend.routers.trades import router as trades_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()

    from shared_schema.database import get_session, init_db
    from shared_schema.seeds import run_all_seeds

    init_db(settings.db_path)
    with next(get_session()) as session:
        run_all_seeds(session)

    from market_data.accessor import configure
    provider = None
    if settings.use_mt5:
        from market_data.providers.mt5 import MT5Provider
        provider = MT5Provider()
    configure(settings.db_path, provider=provider)

    yield

    from market_data.accessor import shutdown
    shutdown()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="trade-trainer API",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.secret_key,
        https_only=False,  # 開発時は HTTP も許可
        same_site="lax",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],  # Vite dev server
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth_router, prefix="/api")
    app.include_router(sessions_router, prefix="/api")
    app.include_router(chart_router, prefix="/api")
    app.include_router(trades_router, prefix="/api")
    app.include_router(drawings_router, prefix="/api")
    app.include_router(stats_router, prefix="/api")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "app": "trade-trainer"}

    return app


app = create_app()
