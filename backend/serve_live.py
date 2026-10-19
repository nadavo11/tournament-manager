from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".local" / "runtime.env")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("bracket.app:app", host="127.0.0.1", port=8400, proxy_headers=True)
