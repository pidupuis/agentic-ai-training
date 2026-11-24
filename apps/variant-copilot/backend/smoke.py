import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()  # reads .env into os.environ
client = OpenAI()  # picks up OPENAI_API_KEY from the environment


def generate_response(messages: list[dict]) -> str:
    """Call the LLM and return its text reply."""
    response = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=messages,
    )
    return response.choices[0].message.content


print(generate_response([{"role": "user", "content": "Say hello"}]))