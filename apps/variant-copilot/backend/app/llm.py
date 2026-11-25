"""LLM client. The only module that knows which provider we use."""

import os
from functools import cache

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()  # reads backend/.env into os.environ (no-op if variables are already set)


@cache
def get_client() -> OpenAI:
    """Shared OpenAI client; the API key is read from OPENAI_API_KEY."""
    return OpenAI()


def get_model() -> str:
    """Model name from LLM_MODEL in .env, never hard-coded."""
    return os.environ["LLM_MODEL"]