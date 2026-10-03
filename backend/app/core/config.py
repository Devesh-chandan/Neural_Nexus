"""
Application configuration.
Loads settings from environment variables / .env file and YAML configs.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # backend/
CONFIG_DIR = BASE_DIR / "config"


class Settings:
    """Runtime settings read from environment."""

    llm_provider: str = os.getenv("LLM_PROVIDER", "none").lower()
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "")
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    database_url: str = os.getenv("DATABASE_URL", "")
    db_path: str = os.getenv("DB_PATH", "data/nexus.db")
    supabase_url: str = os.getenv("SUPABASE_URL", "").rstrip("/")
    supabase_anon_key: str = os.getenv("SUPABASE_ANON_KEY", "")
    supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    cors_origins: list[str] = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
        if o.strip()
    ]
    log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()

    # Derived paths
    data_dir: Path = BASE_DIR / "data"
    seed_dir: Path = BASE_DIR / "data" / "seed"
    cache_dir: Path = BASE_DIR / "data" / "cache"
    cache_ttl_seconds: int = 12 * 3600  # 12 hours


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def load_yaml(filename: str) -> dict[str, Any]:
    """Load a YAML config file from the config directory."""
    path = CONFIG_DIR / filename
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


@lru_cache
def get_underlyings() -> dict[str, Any]:
    return load_yaml("underlyings.yaml")


@lru_cache
def get_products_config() -> dict[str, Any]:
    return load_yaml("products.yaml")


@lru_cache
def get_suitability_rules() -> dict[str, Any]:
    return load_yaml("suitability_rules.yaml")


@lru_cache
def get_registration_config() -> dict[str, Any]:
    """KYC / RBAC / jurisdiction configuration for the registration surfaces."""
    return load_yaml("registration.yaml")
