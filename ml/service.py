# Small local http service for server.js (localhost only, needs the token server.js passes in).
# GET /health, GET /metrics, POST /predict, /feedback, /retrain, /insights
import json
import os
import sys
import threading
import traceback
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import classifier  # noqa: E402

try:
    import insights  # noqa: E402
except ImportError:
    insights = None

HOST = "127.0.0.1"
PORT = int(os.environ.get("ML_PORT", "5055"))
TOKEN = os.environ.get("ML_TOKEN", "")
MAX_BODY = 512 * 1024

STATE = {"model": None, "metrics": None, "status": "starting", "lock": threading.RLock()}


def load_or_train():
    with STATE["lock"]:
        model = classifier.load_model()
        metrics = None
        if model is not None and os.path.exists(classifier.METRICS_PATH):
            with open(classifier.METRICS_PATH) as f:
                metrics = json.load(f)
        if model is None or metrics is None:
            STATE["status"] = "training"
            model, metrics = classifier.train(select_model=True)
        STATE["model"], STATE["metrics"], STATE["status"] = model, metrics, "ready"


def retrain_full():
    with STATE["lock"]:
        STATE["status"] = "training"
        algo = (STATE["metrics"] or {}).get("algorithm")
        model, metrics = classifier.train(select_model=algo is None, forced_model=algo)
        STATE["model"], STATE["metrics"], STATE["status"] = model, metrics, "ready"


def quick_refit():
    with STATE["lock"]:
        old = STATE["model"]
        base = classifier.load_base_training()
        extra = classifier.lexicon_rows({t for t, _ in base})
        fb = classifier.load_feedback()
        algo = (STATE["metrics"] or {}).get("algorithm", "logreg_C30")
        rows = list(base) + list(extra) + list(fb)
        weights = [1.0] * len(base) + [classifier.LEXICON_WEIGHT] * len(extra) + [classifier.FEEDBACK_WEIGHT] * len(fb)
        pipe = classifier.fit_final(algo, rows, weights)
        STATE["model"] = {"pipeline": pipe, "temperature": old["temperature"], "review_threshold": old["review_threshold"]}
        if STATE["metrics"]:
            STATE["metrics"]["dataset"]["user_feedback_examples"] = len(fb)
            STATE["metrics"]["metrics_note"] = "Hold-out metrics are from the last full evaluation; a corrected example was added since."


class Handler(BaseHTTPRequestHandler):
    server_version = "PennyML/1.0"

    def log_message(self, fmt, *args):  # keep node console quiet
        pass

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorised(self):
        if TOKEN and self.headers.get("X-ML-Token") != TOKEN:
            self._send(401, {"error": "unauthorised"})
            return False
        return True

    def _json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("body too large")
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw or b"{}")
        if not isinstance(data, dict):
            raise ValueError("body must be a JSON object")
        return data

    def do_GET(self):
        if not self._authorised():
            return
        if self.path == "/health":
            m = STATE["metrics"] or {}
            return self._send(200, {"status": STATE["status"], "model_loaded": STATE["model"] is not None,
                                    "algorithm": m.get("algorithm"), "trained_at": m.get("trained_at")})
        if self.path == "/metrics":
            if STATE["metrics"] is None:
                return self._send(503, {"error": "model not ready"})
            return self._send(200, STATE["metrics"])
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._authorised():
            return
        try:
            data = self._json_body()
            if self.path == "/predict":
                if STATE["model"] is None:
                    return self._send(503, {"error": "model not ready"})
                if "texts" in data:
                    texts = data["texts"]
                    if not isinstance(texts, list) or len(texts) > 2000:
                        return self._send(400, {"error": "texts must be a list of at most 2000 strings"})
                    out = [classifier.predict(STATE["model"], str(t)[:500]) for t in texts]
                    return self._send(200, {"predictions": out})
                text = data.get("text")
                if not isinstance(text, str):
                    return self._send(400, {"error": "text must be a string"})
                return self._send(200, classifier.predict(STATE["model"], text[:500]))

            if self.path == "/feedback":
                text, cat = data.get("text"), data.get("category")
                if not isinstance(text, str) or not isinstance(cat, str) or not text.strip() or not cat.strip():
                    return self._send(400, {"error": "text and category are required"})
                if cat.strip().lower() not in set(STATE["model"]["pipeline"].classes_):
                    return self._send(400, {"error": f"category '{cat}' is not a category the model knows"})
                classifier.add_feedback(text[:200], cat)
                quick_refit()
                return self._send(200, {"success": True, "prediction": classifier.predict(STATE["model"], text)})

            if self.path == "/retrain":
                retrain_full()
                return self._send(200, {"success": True, "metrics": STATE["metrics"]})

            if self.path == "/insights" and insights is not None:
                return self._send(200, insights.compute(data))

            self._send(404, {"error": "not found"})
        except (ValueError, json.JSONDecodeError) as exc:
            self._send(400, {"error": str(exc)})
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            self._send(500, {"error": "internal error"})


def main():
    threading.Thread(target=load_or_train, daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[Penny ML] listening on http://{HOST}:{PORT}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
