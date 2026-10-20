# PayFlow configuration. All values are overridable with PAYFLOW_* environment variables.

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PAYFLOW_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = "dev"
    database_url: str = "sqlite+pysqlite:///./payflow.db"

    # Used to hash API keys. A leaked database alone must not yield usable keys.
    api_key_pepper: str = "dev-pepper-change-me"

    # Background processing.
    worker_enabled: bool = True
    worker_poll_interval: float = 0.5
    worker_lease_seconds: int = 60
    max_job_attempts: int = 5

    # Test-only controls. Must be false outside development.
    allow_simulator_controls: bool = True

    idempotency_ttl_hours: int = 24
    default_page_size: int = 25
    max_page_size: int = 100
    max_request_bytes: int = 64 * 1024

    @model_validator(mode="after")
    def _reject_dev_defaults_outside_dev(self) -> "Settings":
        if self.environment not in ("dev", "test"):
            if self.api_key_pepper == "dev-pepper-change-me":
                raise ValueError("PAYFLOW_API_KEY_PEPPER must be set outside development")
            if self.allow_simulator_controls:
                raise ValueError(
                    "PAYFLOW_ALLOW_SIMULATOR_CONTROLS must be false outside development"
                )
        return self
