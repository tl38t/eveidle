#!/usr/bin/env python3
"""HTTP server with no-cache headers for EVE IDLE development."""
import http.server
import sys
import os

PORT = 8020
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    with http.server.HTTPServer(('0.0.0.0', PORT), NoCacheHandler) as httpd:
        print(f"Serving {DIRECTORY} at http://localhost:{PORT} (no-cache)")
        httpd.serve_forever()
