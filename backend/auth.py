import os
import time
import secrets as _secrets
from flask import Blueprint, redirect, request, session, jsonify, url_for, current_app
from authlib.integrations.flask_client import OAuth
import flask_login
import db as database

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")

# Populated by init_oauth() called from app.py after app is created
oauth = OAuth()
google = None

# Short-lived tokens: token -> {user_id, guest_id, expires}
_pending_tokens = {}

def _make_auth_token(user_id, guest_id):
    token = _secrets.token_urlsafe(32)
    now = time.time()
    _pending_tokens[token] = {"user_id": user_id, "guest_id": guest_id, "expires": now + 300}
    for k in [k for k, v in list(_pending_tokens.items()) if v["expires"] < now]:
        del _pending_tokens[k]
    return token

class User(flask_login.UserMixin):
    def __init__(self, user_row):
        self._data = user_row

    def get_id(self):
        return str(self._data["id"])

    @property
    def id(self):
        return self._data["id"]

    @property
    def email(self):
        return self._data["email"]

    @property
    def display_name(self):
        return self._data["display_name"] or self._data["email"]

    @property
    def avatar_url(self):
        return self._data["avatar_url"]

    @property
    def plan(self):
        return self._data["plan"]

    @property
    def api_provider(self):
        return self._data.get("api_provider", "anthropic")

    @property
    def api_key_encrypted(self):
        return self._data.get("api_key_encrypted")

def init_oauth(app):
    global google
    oauth.init_app(app)
    google = oauth.register(
        name="google",
        client_id=os.getenv("GOOGLE_CLIENT_ID"),
        client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

def _load_user(user_id):
    row = database.get_user_by_id(int(user_id))
    return User(row) if row else None

# ── Routes ─────────────────────────────────────────────────────────────────────

@auth_bp.route("/google")
def google_login():
    if not os.getenv("GOOGLE_CLIENT_ID"):
        return jsonify({"error": "Google OAuth not configured"}), 503
    redirect_uri = os.getenv(
        "OVERWRITE_REDIRECT_URI",
        url_for("auth.google_callback", _external=True)
    )
    return google.authorize_redirect(redirect_uri)

@auth_bp.route("/google/callback")
def google_callback():
    if not os.getenv("GOOGLE_CLIENT_ID"):
        return jsonify({"error": "Google OAuth not configured"}), 503
    try:
        token = google.authorize_access_token()
        userinfo = token.get("userinfo") or google.userinfo()
    except Exception as e:
        return jsonify({"error": f"OAuth failed: {e}"}), 400

    google_id = userinfo["sub"]
    email = userinfo.get("email", "")
    display_name = userinfo.get("name")
    avatar_url = userinfo.get("picture")

    row = database.get_user_by_google_id(google_id)
    if row:
        user_id = row["id"]
        database.update_user(user_id, display_name=display_name, avatar_url=avatar_url)
    else:
        user_id = database.create_user(google_id, email, display_name, avatar_url)
        database.log_event("user_created", user_id=user_id)

    # Store guest_id to migrate after the frontend calls /auth/verify
    guest_id = request.cookies.get("lethe_guest_id")

    # Generate a short-lived token; login happens in /auth/verify via apiFetch
    # so the session cookie is set with proper CORS headers (not via a redirect)
    auth_token = _make_auth_token(user_id, guest_id)
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    resp = redirect(f"{frontend_url}/chat?auth_token={auth_token}")
    if guest_id:
        resp.delete_cookie("lethe_guest_id")
    return resp

@auth_bp.route("/verify")
def verify():
    token = request.args.get("token", "")
    entry = _pending_tokens.pop(token, None)
    if not entry or entry["expires"] < time.time():
        return jsonify({"error": "invalid or expired token"}), 400

    user_id = entry["user_id"]
    # Accept guest_id from the entry (if cookie was readable) or from the frontend param
    guest_id = entry.get("guest_id") or request.args.get("guest_id")

    if guest_id:
        database.migrate_guest_chats(guest_id, user_id)
        database.log_event("guest_migrated", guest_id=guest_id, user_id=user_id)

    row = database.get_user_by_id(user_id)
    if not row:
        return jsonify({"error": "user not found"}), 404

    user = User(row)
    flask_login.login_user(user, remember=True)
    database.log_event("login", user_id=user_id)

    return jsonify({
        "authenticated": True,
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "plan": user.plan,
        "api_provider": user.api_provider,
    })

@auth_bp.route("/logout", methods=["POST"])
def logout():
    user_id = flask_login.current_user.id if flask_login.current_user.is_authenticated else None
    flask_login.logout_user()
    # Do NOT call session.clear() here — it wipes flask_login's _remember="clear"
    # signal before its after_request hook can delete the remember_token cookie.
    if user_id:
        database.log_event("logout", user_id=user_id)
    resp = jsonify({"ok": True})
    cookie_name = current_app.config.get("REMEMBER_COOKIE_NAME", "remember_token")
    resp.delete_cookie(cookie_name, path="/")
    return resp

@auth_bp.route("/me")
def me():
    if flask_login.current_user.is_authenticated:
        u = flask_login.current_user
        return jsonify({
            "authenticated": True,
            "id": u.id,
            "email": u.email,
            "display_name": u.display_name,
            "avatar_url": u.avatar_url,
            "plan": u.plan,
            "api_provider": u.api_provider,
        })

    guest_id = request.cookies.get("lethe_guest_id")
    return jsonify({
        "authenticated": False,
        "guest_id": guest_id,
        "plan": "free",
    })
