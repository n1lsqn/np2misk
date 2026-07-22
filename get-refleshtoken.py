from base64 import b64encode
import requests
from flask import Flask, redirect, request

CLIENT_ID = "0e630eba1fa24f3da0cf1ebf08f1d58a"
CLIENT_SECRET = "f98164d26f414cb1a1ecb8ad17a31b37"
REDIRECT_URI = "http://[::1]:5000/callback"

app = Flask(__name__)

@app.route("/login")
def login():
    """ログイン用のルート"""
    scope = "user-read-playback-state user-read-currently-playing"
    url = (
        "https://accounts.spotify.com/authorize"
        f"?client_id={CLIENT_ID}"
        f"&response_type=code"
        f"&redirect_uri={REDIRECT_URI}"
        f"&scope={scope}"
    )
    return redirect(url)

@app.route("/callback")
def callback():
    """Spotifyのリダイレクトを受け取る"""
    code = request.args.get("code")
    if not code:
        return "No code returned", 400

    auth_str = f"{CLIENT_ID}:{CLIENT_SECRET}"
    headers = {
        "Authorization": "Basic " + b64encode(auth_str.encode()).decode(),
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
    }

    res = requests.post(
        "https://accounts.spotify.com/api/token",
        headers=headers,
        data=data,
        timeout=None
    )
    res.raise_for_status()
    tokens = res.json()
    return f"Refresh Token: {tokens.get('refresh_token')}"

if __name__ == "__main__":
    app.run(host="::1", port=5000, debug=True)