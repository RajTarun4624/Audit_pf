"""Vercel serverless entry point. Everything lives in backend/app; this file only imports it."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from app.main import app  # noqa: E402,F401  (ASGI app picked up by @vercel/python)
