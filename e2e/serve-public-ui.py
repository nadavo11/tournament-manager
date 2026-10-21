"""Serve both native /live-assets URLs and the generated Pages layout for UI tests."""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith("/live-assets/"):
            path = path.removeprefix("/live-assets")
        return super().translate_path(path)


if __name__ == "__main__":
    handler = partial(Handler, directory=sys.argv[1])
    ThreadingHTTPServer(("127.0.0.1", 18766), handler).serve_forever()
