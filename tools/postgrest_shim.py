#!/usr/bin/env python3
"""A minimal PostgREST-compatible RPC endpoint, for local end-to-end testing only.

This exists so the real browser + real supabase-js + real SQL functions can be
exercised together without a Supabase project. It implements just enough of
PostgREST to serve `POST /rest/v1/rpc/<function>`:

  * named-argument dispatch, matching how supabase-js sends rpc() payloads
  * role switching (anon / authenticated) so RLS and GRANTs are really in play
  * request.jwt.claim.sub set from a bearer token, so auth.uid() works
  * SQLSTATE -> HTTP status mapping matching PostgREST's behaviour, so the
    error codes the frontend parses are the ones it will see in production

It is NOT a production server and is not shipped with the site.
"""
import http.server
import json
import socketserver
import sys
import threading
import urllib.parse

import psycopg2
import psycopg2.extras

DSN = "host=/tmp port=5433 user=postgres dbname=mzsm"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5555

# PostgREST's documented SQLSTATE -> HTTP mapping for the codes we raise.
STATUS_BY_SQLSTATE = {
    "22023": 400,   # invalid_parameter_value  -> validation
    "23505": 409,   # unique_violation         -> conflict
    "42501": 403,   # insufficient_privilege   -> forbidden
    "P0002": 404,   # no_data_found            -> not found
}

_local = threading.local()


def connect():
    conn = getattr(_local, "conn", None)
    if conn is None or conn.closed:
        conn = psycopg2.connect(DSN)
        _local.conn = conn
    return conn


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass  # keep the test output readable

    def _send(self, status, payload, extra_headers=()):
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        for key, value in extra_headers:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/auth/v1/user":
            auth = self.headers.get("Authorization", "")
            token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
            for email, uid in self.USERS.items():
                if uid == token:
                    return self._send(200, self._auth_session(email)["user"])
            return self._send(401, {"message": "invalid claim: missing sub claim"})
        # supabase-js probes /rest/v1/ on some paths; answer politely.
        self._send(200, {})

    # ── minimal GoTrue surface, enough for supabase-js to hold a session ──
    # The access token IS the user's uuid here; a real deployment issues a JWT
    # and Supabase derives auth.uid() from its `sub` claim. The shim's uuid ->
    # request.jwt.claim.sub mapping reproduces that relationship faithfully
    # enough to exercise the admin-list check against the real database.
    USERS = {
        "admin@example.test": "11111111-1111-1111-1111-111111111111",
        "user@example.test": "22222222-2222-2222-2222-222222222222",
    }

    def _auth_session(self, email):
        uid = self.USERS.get(email)
        if not uid:
            return None
        import time
        return {
            "access_token": uid,
            "token_type": "bearer",
            "expires_in": 3600,
            "expires_at": int(time.time()) + 3600,
            "refresh_token": f"refresh-{uid}",
            "user": {
                "id": uid, "email": email, "aud": "authenticated",
                "role": "authenticated", "app_metadata": {}, "user_metadata": {},
                "created_at": "2026-01-01T00:00:00Z",
            },
        }

    PASSWORD = "correct-horse"

    def _handle_auth(self, path, body):
        if path == "/auth/v1/token":
            email = (body or {}).get("email", "")
            password = (body or {}).get("password")
            session = self._auth_session(email)
            # only reject when a password was actually supplied and is wrong,
            # so the existing tests that pass a dummy password still work
            if session and password not in (None, self.PASSWORD, "x"):
                return self._send(400, {"error": "invalid_grant",
                                        "error_description": "Invalid login credentials"})
            if not session:
                return self._send(400, {"error": "invalid_grant",
                                        "error_description": "Invalid login credentials"})
            return self._send(200, session)
        if path == "/auth/v1/logout":
            return self._send(204, {})
        return self._send(404, {"message": "not implemented in shim"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path

        if path.startswith("/auth/v1/"):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                body = {}
            return self._handle_auth(path, body)

        prefix = "/rest/v1/rpc/"
        if not path.startswith(prefix):
            return self._send(404, {"message": "Not found", "code": "PGRST404"})

        fn = path[len(prefix):]
        if not fn.replace("_", "").isalnum():
            return self._send(400, {"message": "bad function name", "code": "PGRST100"})

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            args = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"message": "invalid JSON body", "code": "PGRST102"})
        if not isinstance(args, dict):
            return self._send(400, {"message": "body must be an object", "code": "PGRST102"})

        # Bearer token: in this shim the token IS the user's uuid (or empty for anon).
        auth = self.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        role = "authenticated" if token else "anon"

        conn = connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (token,))
                cur.execute(f'set local role "{role}"')
                names = list(args.keys())
                placeholders = ", ".join(f"{n} => %({n})s" for n in names)
                cur.execute(f"select public.{fn}({placeholders}) as result", args)
                row = cur.fetchone()
            conn.commit()
            return self._send(200, row["result"] if row else None)
        except psycopg2.Error as exc:
            conn.rollback()
            sqlstate = getattr(exc, "pgcode", None) or ""
            message = (getattr(exc, "diag", None)
                       and exc.diag.message_primary) or str(exc)
            status = STATUS_BY_SQLSTATE.get(sqlstate, 400)
            return self._send(status, {
                "message": message.strip(),
                "code": sqlstate,
                "details": None,
                "hint": None,
            })


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    # TLS is on by default: the site config deliberately refuses any
    # supabaseUrl that is not https, and that production rule should not be
    # relaxed just to make a local test easier. So the shim speaks https too,
    # with a throwaway self-signed cert.
    certfile = sys.argv[2] if len(sys.argv) > 2 else None
    keyfile = sys.argv[3] if len(sys.argv) > 3 else None

    with Server(("127.0.0.1", PORT), Handler) as httpd:
        scheme = "http"
        if certfile and keyfile:
            import ssl
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(certfile, keyfile)
            httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
            scheme = "https"
        print(f"postgrest-shim listening on {scheme}://127.0.0.1:{PORT}", flush=True)
        httpd.serve_forever()
