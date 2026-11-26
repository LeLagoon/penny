# Expense text classifier: TF-IDF (words + chars) -> linear model.
# Model is picked with CV on train data, then scored once on test.csv.
import csv
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone

import joblib
import numpy as np
from scipy.optimize import minimize_scalar
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.naive_bayes import ComplementNB, MultinomialNB
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.svm import LinearSVC

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(HERE, "data")
ARTIFACTS = os.path.join(HERE, "artifacts")
TRAIN_CSV = os.path.join(DATA, "train.csv")
TEST_CSV = os.path.join(DATA, "test.csv")
LEGACY_CSV = os.path.join(ROOT, "transactions.csv")
FEEDBACK_CSV = os.path.join(DATA, "user_feedback.csv")
MODEL_PATH = os.path.join(ARTIFACTS, "classifier.joblib")
METRICS_PATH = os.path.join(ARTIFACTS, "classifier_metrics.json")

# corrections from the user count more than the bundled examples
FEEDBACK_WEIGHT = 5.0
RANDOM_STATE = 42


def clean_text(text):
    t = str(text).lower()
    t = t.replace("’", "'")
    t = re.sub(r"\btxn[a-z0-9]+\b", " ", t)  # TXN684df950
    t = re.sub(r"\b(inr|usd|gbp|eur|rs)\b\.?", " ", t)
    t = re.sub(r"[₹$£€]\s*\d[\d,\.]*", " ", t)
    t = re.sub(r"[_/|\\@\-\.]", " ", t)  # upi separators
    t = re.sub(r"\b\d+\b", " ", t)
    t = re.sub(r"[^a-z0-9&+' ]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _read(path, text_col="text", cat_col="category"):
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return [(r[text_col], r[cat_col].strip().lower()) for r in csv.DictReader(f) if r.get(text_col)]


def load_base_training():
    rows = _read(TRAIN_CSV)
    legacy = _read(LEGACY_CSV, "transaction_text", "category")
    alias = {"eat": "food", "tv": "entertainment", "books": "education", "laptop": "technology"}
    rows += [(t, alias.get(c, c)) for t, c in legacy]
    seen, out = set(), []
    for text, cat in rows:
        key = clean_text(text)
        if key and key not in seen:
            seen.add(key)
            out.append((key, cat))
    return out


def load_feedback():
    latest = {}
    for text, cat in _read(FEEDBACK_CSV):
        key = clean_text(text)
        if key:
            latest[key] = cat
    return list(latest.items())


def load_test():
    return [(t, c) for t, c in _read(TEST_CSV)]


def make_features():
    return FeatureUnion([
        ("word", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), sublinear_tf=True, min_df=1)),
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True, min_df=1)),
    ])


def candidate_models():
    return {
        "multinomial_nb": MultinomialNB(alpha=0.1),
        "complement_nb": ComplementNB(alpha=0.3),
        "logreg_C10": LogisticRegression(C=10, max_iter=2000, class_weight="balanced"),
        "logreg_C30": LogisticRegression(C=30, max_iter=2000, class_weight="balanced"),
        "calibrated_linear_svm": CalibratedClassifierCV(LinearSVC(C=1.0, class_weight="balanced"), cv=3, method="sigmoid"),
    }


def build_pipeline(clf):
    return Pipeline([("features", make_features()), ("clf", clf)])


LEXICON_WEIGHT = 0.6


def lexicon_rows(exclude_keys=()):
    # keywords from the js lexicon as weak examples, helps with rare merchants
    script = os.path.join(HERE, "lexicon_dump.mjs")
    try:
        proc = subprocess.run(["node", script], capture_output=True, text=True, timeout=30)
        lex = json.loads(proc.stdout) if proc.returncode == 0 else {}
    except Exception:
        lex = {}
    rows, seen = [], set(exclude_keys)
    for cat, kws in lex.items():
        for kw in kws:
            key = clean_text(kw)
            if key and key not in seen:
                seen.add(key)
                rows.append((key, cat))
    return rows


def apply_temperature(proba, temperature):
    p = np.clip(np.asarray(proba, dtype=float), 1e-12, 1.0) ** (1.0 / temperature)
    return p / p.sum(axis=1, keepdims=True)


def fit_temperature(proba, y_true_idx):
    y_true_idx = np.asarray(y_true_idx)

    def nll(t):
        q = apply_temperature(proba, t)
        return -np.mean(np.log(np.clip(q[np.arange(len(y_true_idx)), y_true_idx], 1e-12, 1.0)))

    res = minimize_scalar(nll, bounds=(0.2, 5.0), method="bounded")
    return float(res.x)


def out_of_fold(model_name, base, extra, folds):
    # extra rows only go on the training side, never in validation
    texts = [t for t, _ in base]
    labels = np.array([c for _, c in base])
    classes = sorted(set(labels) | {c for _, c in extra})
    oof = np.zeros((len(base), len(classes)))
    skf = StratifiedKFold(n_splits=folds, shuffle=True, random_state=RANDOM_STATE)
    for tr_idx, va_idx in skf.split(texts, labels):
        rows = [base[i] for i in tr_idx] + list(extra)
        weights = [1.0] * len(tr_idx) + [LEXICON_WEIGHT] * len(extra)
        pipe = fit_final(model_name, rows, weights)
        p = pipe.predict_proba([texts[i] for i in va_idx])
        col = {c: j for j, c in enumerate(classes)}
        for j, c in enumerate(pipe.classes_):
            oof[va_idx, col[c]] = p[:, j]
    return oof, classes


def expected_calibration_error(conf, correct, bins=10):
    conf, correct = np.asarray(conf), np.asarray(correct, dtype=float)
    edges = np.linspace(0, 1, bins + 1)
    ece, table = 0.0, []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (conf > lo) & (conf <= hi) if lo > 0 else (conf >= lo) & (conf <= hi)
        if mask.sum() == 0:
            continue
        acc, avg = float(correct[mask].mean()), float(conf[mask].mean())
        ece += mask.mean() * abs(acc - avg)
        table.append({"range": f"{lo:.1f}-{hi:.1f}", "n": int(mask.sum()), "avg_confidence": round(avg, 3), "accuracy": round(acc, 3)})
    return float(ece), table


def threshold_table(conf, correct):
    conf, correct = np.asarray(conf), np.asarray(correct, dtype=float)
    rows = []
    for th in [0.0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
        mask = conf >= th
        rows.append({
            "threshold": th,
            "coverage": round(float(mask.mean()), 3),
            "accuracy_when_accepted": round(float(correct[mask].mean()), 3) if mask.any() else None,
        })
    return rows


def rules_baseline_predictions(texts):
    script = os.path.join(HERE, "rules_predict.mjs")
    proc = subprocess.run(["node", script], input=json.dumps(texts), capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr)
    return [r["category"] for r in json.loads(proc.stdout)]


def metrics_for(y_true, y_pred, labels):
    rep = classification_report(y_true, y_pred, labels=labels, output_dict=True, zero_division=0)
    return {
        "accuracy": round(accuracy_score(y_true, y_pred), 4),
        "macro_f1": round(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0), 4),
        "weighted_f1": round(f1_score(y_true, y_pred, labels=labels, average="weighted", zero_division=0), 4),
        "per_class": {
            l: {"precision": round(rep[l]["precision"], 3), "recall": round(rep[l]["recall"], 3),
                "f1": round(rep[l]["f1-score"], 3), "support": int(rep[l]["support"])}
            for l in labels if l in rep
        },
    }


def fit_final(model_name, rows, weights=None):
    texts = [t for t, _ in rows]
    labels = [c for _, c in rows]
    pipe = build_pipeline(candidate_models()[model_name])
    fit_params = {}
    if weights is not None:
        fit_params["clf__sample_weight"] = np.asarray(weights, dtype=float)
    try:
        pipe.fit(texts, labels, **fit_params)
    except TypeError:
        pipe.fit(texts, labels)  # no sample_weight support
    return pipe


def train(select_model=True, forced_model=None, save=True, verbose=False, use_lexicon=True):
    started = time.time()
    base = load_base_training()
    feedback = load_feedback()
    test = load_test()
    labels = sorted({c for _, c in base})
    extra = lexicon_rows({t for t, _ in base}) if use_lexicon else []

    # model selection (cv on train data only)
    base_labels = [c for _, c in base]
    min_class = min(base_labels.count(l) for l in labels)
    folds = max(2, min(5, min_class))

    cv_results, oof_store = {}, {}
    candidates = candidate_models()
    to_try = [forced_model] if forced_model else (list(candidates) if select_model else ["logreg_C30"])
    for name in to_try:
        oof, classes = out_of_fold(name, base, extra, folds)
        pred = [classes[i] for i in oof.argmax(axis=1)]
        cv_results[name] = {
            "cv_accuracy": round(accuracy_score(base_labels, pred), 4),
            "cv_macro_f1": round(f1_score(base_labels, pred, average="macro"), 4),
        }
        oof_store[name] = (oof, classes)
        if verbose:
            print(f"  CV {name:24s} acc={cv_results[name]['cv_accuracy']:.3f} macroF1={cv_results[name]['cv_macro_f1']:.3f}")
    best_name = max(cv_results, key=lambda n: cv_results[n]["cv_macro_f1"])

    # calibration
    oof, classes = oof_store[best_name]
    y_idx = [classes.index(c) for c in base_labels]
    temperature = fit_temperature(oof, y_idx)

    # hold-out eval, model sees only base + lexicon rows
    weights0 = [1.0] * len(base) + [LEXICON_WEIGHT] * len(extra)
    eval_pipe = fit_final(best_name, list(base) + list(extra), weights0)
    t_texts = [clean_text(t) for t, _ in test]
    y_true = [c for _, c in test]
    proba = apply_temperature(eval_pipe.predict_proba(t_texts), temperature)
    raw_proba = eval_pipe.predict_proba(t_texts)
    classes_e = list(eval_pipe.classes_)
    y_pred = [classes_e[i] for i in proba.argmax(axis=1)]
    conf = proba.max(axis=1)
    correct = np.array([a == b for a, b in zip(y_pred, y_true)])
    ece, reliability = expected_calibration_error(conf, correct)
    ece_raw, _ = expected_calibration_error(raw_proba.max(axis=1), correct)
    cm = confusion_matrix(y_true, y_pred, labels=labels)

    ml_metrics = metrics_for(y_true, y_pred, labels)

    # accuracy when at least one word was seen vs none
    vocab = eval_pipe.named_steps["features"].transformer_list[0][1].vocabulary_
    known_mask = np.array([any(tok in vocab for tok in t.split()) for t in t_texts])
    split = {
        "all_words_unseen": {"n": int((~known_mask).sum()),
                             "accuracy": round(float(correct[~known_mask].mean()), 3) if (~known_mask).any() else None},
        "some_words_seen": {"n": int(known_mask.sum()),
                            "accuracy": round(float(correct[known_mask].mean()), 3) if known_mask.any() else None},
    }

    try:
        rule_pred = rules_baseline_predictions([t for t, _ in test])
        rules_metrics = metrics_for(y_true, rule_pred, labels)
    except Exception as exc:  # node not installed
        rules_metrics = {"error": str(exc)[:200]}

    errors = [{"text": test[i][0], "true": y_true[i], "predicted": str(y_pred[i]), "confidence": round(float(conf[i]), 3)}
              for i in np.where(~correct)[0]]
    errors.sort(key=lambda e: -e["confidence"])

    # final model also gets the user feedback
    prod_rows = list(base) + list(extra) + [(t, c) for t, c in feedback]
    weights = weights0 + [FEEDBACK_WEIGHT] * len(feedback)
    prod = fit_final(best_name, prod_rows, weights)

    thresholds = threshold_table(conf, correct)
    review_threshold = 0.5
    for row in thresholds:  # first threshold that gets 95%+ accuracy
        if row["accuracy_when_accepted"] is not None and row["accuracy_when_accepted"] >= 0.95 and row["threshold"] > 0:
            review_threshold = row["threshold"]
            break

    metrics = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "train_seconds": round(time.time() - started, 2),
        "algorithm": best_name,
        "features": "TF-IDF word 1-2grams + char 2-5grams (sublinear tf), linear classifier, temperature-scaled probabilities",
        "labels": labels,
        "dataset": {"base_training_examples": len(base), "lexicon_weak_examples": len(extra),
                    "user_feedback_examples": len(feedback), "holdout_test_examples": len(test), "cv_folds": folds,
                    "note": "Training and test phrases were hand-written (not real user data); test merchants/phrasings are held out."},
        "model_selection_cv": cv_results,
        "holdout": ml_metrics,
        "holdout_by_vocabulary": split,
        "holdout_rule_baseline": rules_metrics,
        "calibration": {"temperature": round(temperature, 3), "expected_calibration_error": round(ece, 4),
                        "expected_calibration_error_uncalibrated": round(ece_raw, 4), "reliability": reliability},
        "confidence_thresholds": thresholds,
        "review_threshold": review_threshold,
        "confusion_matrix": {"labels": labels, "matrix": cm.tolist()},
        "top_errors": errors[:15],
    }

    if save:
        os.makedirs(ARTIFACTS, exist_ok=True)
        joblib.dump({"pipeline": prod, "algorithm": best_name, "labels": labels, "temperature": temperature,
                     "review_threshold": review_threshold}, MODEL_PATH)
        with open(METRICS_PATH, "w") as f:
            json.dump(metrics, f, indent=2)
    return {"pipeline": prod, "temperature": temperature, "review_threshold": review_threshold}, metrics


def predict(model, text, top_k=3):
    pipe, temperature = model["pipeline"], model["temperature"]
    cleaned = clean_text(text)
    if not cleaned:
        return {"category": "miscellaneous", "confidence": 0.0, "alternatives": [], "known_vocabulary": False, "needs_review": True}
    proba = apply_temperature(pipe.predict_proba([cleaned]), temperature)[0]
    order = np.argsort(proba)[::-1]
    classes = pipe.classes_
    vocab = pipe.named_steps["features"].transformer_list[0][1].vocabulary_
    known = any(tok in vocab for tok in cleaned.split())
    confidence = float(proba[order[0]])
    return {
        "category": str(classes[order[0]]),
        "confidence": round(confidence, 4),
        "alternatives": [{"category": str(classes[i]), "probability": round(float(proba[i]), 4)} for i in order[1:top_k]],
        "known_vocabulary": bool(known),
        "needs_review": (not known) or confidence < model["review_threshold"],
    }


def add_feedback(text, category):
    os.makedirs(DATA, exist_ok=True)
    key = clean_text(text)
    if not key:
        raise ValueError("empty text")
    existing = {clean_text(t): (t, c) for t, c in _read(FEEDBACK_CSV)}
    existing[key] = (text.strip(), category.strip().lower())
    with open(FEEDBACK_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["text", "category"])
        w.writerows(existing.values())


def load_model():
    if not os.path.exists(MODEL_PATH):
        return None
    saved = joblib.load(MODEL_PATH)
    return {"pipeline": saved["pipeline"], "temperature": saved.get("temperature", 1.0),
            "review_threshold": saved.get("review_threshold", 0.5)}


if __name__ == "__main__":
    import sys
    print("Training and evaluating (model selection via cross-validation on training data)...")
    _, m = train(verbose=True)
    h = m["holdout"]
    print(f"\nSelected: {m['algorithm']}")
    c = m["calibration"]
    print(f"HOLD-OUT  accuracy={h['accuracy']:.3f}  macroF1={h['macro_f1']:.3f}  ECE={c['expected_calibration_error']:.3f} (uncalibrated {c['expected_calibration_error_uncalibrated']:.3f}, T={c['temperature']})")
    print("By vocabulary:", m["holdout_by_vocabulary"], " review threshold:", m["review_threshold"])
    rb = m["holdout_rule_baseline"]
    if "accuracy" in rb:
        print(f"RULES     accuracy={rb['accuracy']:.3f}  macroF1={rb['macro_f1']:.3f}   (same hold-out set)")
    print("\nWorst per-class F1:", sorted(((v['f1'], k) for k, v in h['per_class'].items()))[:4])
    print("Confidence vs accuracy:", [(t['threshold'], t['coverage'], t['accuracy_when_accepted']) for t in m['confidence_thresholds']])
    if "--errors" in sys.argv:
        for e in m["top_errors"]:
            print(" ", e)
