from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.database import Base, engine
from app.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(
    title="Financial Confidence API — Phase 2",
    description="Validation & reassurance: Devil's Advocate reports, privacy-first peer benchmarks, "
                "and a decision journal with emotional check-ins.",
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
