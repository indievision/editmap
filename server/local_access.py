"""Loopback access boundary and streamed request size limits."""
import os
import re
import secrets
from starlette.responses import JSONResponse

SESSION_TOKEN = secrets.token_urlsafe(32)
MAX_REQUEST_BYTES = 8 * 1024**3
LOCAL_ORIGIN = re.compile(r"^https?://(127\.0\.0\.1|localhost)(:\d{1,5})?$")

class LocalAccessMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        origin = headers.get(b"origin", b"").decode()
        host = headers.get(b"host", b"").decode().split(":")[0]
        async def reject(code, message):
            await JSONResponse({"detail": message}, status_code=code)(scope, receive, send)
        if host not in {"127.0.0.1", "localhost", "testserver"} or (origin and not LOCAL_ORIGIN.fullmatch(origin)):
            return await reject(403, "Only the local EDITMAP app may access this service.")
        path = scope["path"]
        if scope["method"] != "OPTIONS" and path.startswith("/api/") and path != "/api/session":
            token = headers.get(b"x-editmap-token", b"").decode()
            if not secrets.compare_digest(token, SESSION_TOKEN):
                return await reject(401, "Local session token required.")
        limit = MAX_REQUEST_BYTES if path in ("/api/separate-dme", "/api/scan-speech", "/api/scan-loudness", "/api/detect-shots-upload", "/api/track-shot-faces") else 32 * 1024**2
        try:
            if int(headers.get(b"content-length", b"0")) > limit:
                return await reject(413, "Request exceeds the local processing limit.")
        except ValueError:
            return await reject(400, "Invalid Content-Length.")
        # Spool limits also cover chunked bodies before downstream JSON/form parsing.
        received = 0
        async def bounded_receive():
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > limit:
                from starlette.exceptions import HTTPException
                raise HTTPException(413, "Request exceeds the local processing limit.")
            return message
        await self.app(scope, bounded_receive, send)
