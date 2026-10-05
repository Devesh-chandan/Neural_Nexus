"""Test environment: the shared in-process limiter must not throttle the functional test suite."""
import os

os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
