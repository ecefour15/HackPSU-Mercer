"""App settings, read from environment variables."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./confidence.db")
    # Optional: when a key is set, the Devil's Advocate adds an LLM-written narrative
    # on top of the rule-based findings. Without one everything still works.
    # OpenAI is used if both are set (same key as the Streamlit app).
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    anthropic_api_key: str | None = os.getenv("ANTHROPIC_API_KEY")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
    # Peer benchmarks are only shown when a cohort has at least this many
    # people, so no individual can be singled out (k-anonymity).
    min_cohort_size: int = int(os.getenv("MIN_COHORT_SIZE", "10"))
    # Hours a "pressured" or "impulsive" decision should wait before it can be locked.
    cooling_off_hours: int = int(os.getenv("COOLING_OFF_HOURS", "24"))


settings = Settings()
