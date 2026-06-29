import os
from flask import Blueprint, redirect, request, session, jsonify, url_for
from authlib.integrations.flask_client import OAuth
import flask_login
import db as database

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")

# Populated by init_oauth() called from app.py after app is created
oauth = OAuth()
google = None

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
        return jsonify({"error": "Google OAuth not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"}), 503
    redirect_uri = url_for("auth.google_callback", _external=True)
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

    # Migrate any guest chats to this user
    guest_id = request.cookies.get("lethe_guest_id")
    if guest_id:
        database.migrate_guest_chats(guest_id, user_id)
        database.log_event("guest_migrated", guest_id=guest_id, user_id=user_id)

    row = database.get_user_by_id(user_id)
    user = User(row)
    flask_login.login_user(user, remember=True)
    database.log_event("login", user_id=user_id)

    # Redirect back to the frontend
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    resp = redirect(frontend_url)
    # Clear guest cookie after successful migration
    if guest_id:
        resp.delete_cookie("lethe_guest_id")
    return resp

@auth_bp.route("/logout", methods=["POST"])
def logout():
    user_id = flask_login.current_user.id if flask_login.current_user.is_authenticated else None
    flask_login.logout_user()
    session.clear()
    if user_id:
        database.log_event("logout", user_id=user_id)
    return jsonify({"ok": True})

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
