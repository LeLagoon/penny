"""Personalised budget, spending forecast, unusual-spend detection and goal feasibility.

Everything here learns from the user's OWN ledger, not from demographics (the bundled student
dataset turned out to carry no usable signal, see data_quality_report()).

Methods (all deliberately simple, explainable and honest about how much data they have):
  * Budget          Bayesian shrinkage: the cost-of-living estimate acts as a prior worth K months of
                    data; each complete month of real spending moves the recommendation towards what
                    the user actually spends. Backtested when enough history exists.
  * Forecast        month-to-date spend + robust daily pace for the remaining days + recurring bills
                    still to come, with a ~80% interval and a probability of exceeding the budget.
  * Recurring       description similarity (TF-IDF char n-grams + cosine) groups the same merchant across
                    months; groups seen in 2+ months with a stable amount count as recurring.
  * Anomalies       modified z-score (median / MAD) of log-amounts per category.
  * Goals           required monthly saving vs. estimated monthly surplus.
"""
import calendar
import math
import os
import re
from collections import defaultdict
from datetime import date, datetime

import numpy as np

import classifier

PRIOR_WEIGHT_MONTHS = 2.0  # the cost-of-living estimate counts as this many months of evidence
FIXED_LIKE = {"emi", "investment", "utilities"}  # lumpy, usually once a month
DISCRETIONARY = ("food", "entertainment", "shopping")
Z80 = 1.2816  # 80% two-sided interval


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _d(s):
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def _month_key(d):
    return f"{d.year}-{d.month:02d}"


def _norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _clean_txns(raw):
    out = []
    for t in raw or []:
        try:
            amount = float(t.get("amount", 0))
            if amount <= 0:
                continue
            out.append({
                "id": t.get("id"), "date": _d(str(t["date"])), "description": str(t.get("description", "")),
                "category": str(t.get("category", "miscellaneous")), "amount": amount,
            })
        except (KeyError, ValueError, TypeError):
            continue
    out.sort(key=lambda x: x["date"])
    return out


def _complete_months(txns, today):
    """Months fully covered by the ledger: before this month, and not the (probably partial) first month."""
    if not txns:
        return []
    first = txns[0]["date"]
    by_month = defaultdict(float)
    for t in txns:
        by_month[_month_key(t["date"])] += t["amount"]
    this_key = _month_key(today)
    first_key = _month_key(first)
    months = []
    for key in sorted(by_month):
        if key >= this_key:
            continue
        if key == first_key and first.day > 5:
            continue  # ledger starts mid-month, so that month is incomplete
        months.append((key, by_month[key]))
    return months


# ---------------------------------------------------------------------------
# budget
# ---------------------------------------------------------------------------
def _shrink(prior, monthly_totals):
    n = len(monthly_totals)
    if n == 0:
        return prior, 0.0, None
    centre = float(np.median(monthly_totals)) if n >= 5 else float(np.mean(monthly_totals))
    w = n / (n + PRIOR_WEIGHT_MONTHS)
    return (1 - w) * prior + w * centre, w, centre


def budget_estimate(prior, months, backtest=True):
    totals = [v for _, v in months]
    rec, w, centre = _shrink(prior, totals)
    n = len(totals)
    interval = None
    if n >= 3:
        sd = float(np.std(totals, ddof=1))
        half = Z80 * sd * math.sqrt(1 + 1.0 / n)
        interval = [max(rec - half, 0.0), rec + half]

    validation = None
    if backtest and n >= 4:
        errs_model, errs_prior, errs_last = [], [], []
        for i in range(3, n):
            history = totals[:i]
            pred, _, _ = _shrink(prior, history)
            actual = totals[i]
            errs_model.append(abs(pred - actual))
            errs_prior.append(abs(prior - actual))
            errs_last.append(abs(history[-1] - actual))
        validation = {
            "months_tested": len(errs_model),
            "mae_model": round(float(np.mean(errs_model)), 2),
            "mae_prior_only": round(float(np.mean(errs_prior)), 2),
            "mae_last_month": round(float(np.mean(errs_last)), 2),
            "beats_prior_only": bool(np.mean(errs_model) < np.mean(errs_prior)),
        }

    return {
        "prior": round(prior, 2), "history_months": n, "history_centre": None if centre is None else round(centre, 2),
        "weight_on_history": round(w, 3), "recommended": round(rec, 2),
        "interval_80": None if interval is None else [round(interval[0], 2), round(interval[1], 2)],
        "method": "Bayesian shrinkage: cost-of-living estimate (prior, worth "
                  f"{PRIOR_WEIGHT_MONTHS:g} months) blended with your complete months of real spending",
        "validation": validation,
        "validation_note": None if validation else "Needs 4+ complete months of history to backtest.",
    }


# ---------------------------------------------------------------------------
# recurring merchants (text similarity)
# ---------------------------------------------------------------------------
def find_recurring(txns, today, max_items=1000):
    from sklearn.feature_extraction.text import TfidfVectorizer
    recent = txns[-max_items:]
    if len(recent) < 4:
        return []
    texts = [classifier.clean_text(t["description"]) or "unknown" for t in recent]
    try:
        X = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True).fit_transform(texts)
    except ValueError:
        return []
    sim = (X @ X.T).toarray()
    n = len(recent)
    group = [-1] * n
    gid = 0
    for i in range(n):
        if group[i] != -1:
            continue
        group[i] = gid
        for j in range(i + 1, n):
            if group[j] == -1 and sim[i, j] >= 0.75:
                group[j] = gid
        gid += 1
    clusters = defaultdict(list)
    for idx, g in enumerate(group):
        clusters[g].append(recent[idx])

    this_key = _month_key(today)
    out = []
    for items in clusters.values():
        months = {_month_key(t["date"]) for t in items}
        past_months = {m for m in months if m < this_key}
        if len(past_months) < 2:
            continue
        amounts = [t["amount"] for t in items if _month_key(t["date"]) < this_key]
        med = float(np.median(amounts))
        # A bill repeats about once a month at a steady amount. Frequent, variable merchants
        # (daily lunches, rides) are habits, not bills.
        per_month = len(amounts) / max(len(past_months), 1)
        spread = float(np.std(amounts)) / med if med else 1.0
        if per_month > 1.6 or spread > 0.25:
            continue
        days = [t["date"].day for t in items if _month_key(t["date"]) < this_key]
        typical_day = int(round(float(np.median(days))))
        paid = this_key in months
        status = "paid" if paid else ("upcoming" if typical_day >= today.day else "not_yet_seen")
        label = max(items, key=lambda t: t["date"])["description"]
        out.append({
            "merchant": label, "typical_amount": round(med, 2), "typical_day": typical_day,
            "months_seen": len(past_months), "status": status, "category": items[-1]["category"],
        })
    out.sort(key=lambda r: -r["typical_amount"])
    return out


# ---------------------------------------------------------------------------
# forecast
# ---------------------------------------------------------------------------
def forecast_month(txns, today, budget, recurring, months):
    key = _month_key(today)
    D = calendar.monthrange(today.year, today.month)[1]
    d = today.day
    mtd = [t for t in txns if _month_key(t["date"]) == key and t["date"] <= today]
    spent = sum(t["amount"] for t in mtd)

    all_amounts = np.array([t["amount"] for t in txns]) if txns else np.array([0.0])
    med, p90 = float(np.median(all_amounts)), float(np.percentile(all_amounts, 90))

    def lumpy(t):
        return t["category"] in FIXED_LIKE or (t["amount"] >= p90 and t["amount"] > 3 * med)

    variable = [t for t in mtd if not lumpy(t)]
    var_total = sum(t["amount"] for t in variable)
    rate_now = var_total / max(d, 1)

    # historical variable daily rate from complete months, to stabilise early-month estimates
    hist_rate = None
    if months:
        keys = {k for k, _ in months}
        hist_var = [t["amount"] for t in txns if _month_key(t["date"]) in keys and not lumpy(t)]
        month_days = sum(calendar.monthrange(int(k[:4]), int(k[5:]))[1] for k in keys)
        hist_rate = sum(hist_var) / month_days if month_days else None
    if hist_rate is not None:
        w = d / (d + 7.0)
        rate = w * rate_now + (1 - w) * hist_rate
        rate_source = "blend of this month's pace and your history"
    else:
        rate = rate_now
        rate_source = "this month's pace only (no complete history yet)"

    remaining_days = D - d
    expected_recurring = sum(r["typical_amount"] for r in recurring if r["status"] == "upcoming")
    # recurring bills already counted as lumpy/paid are not double counted: only 'upcoming' ones are added.

    # daily variable spend noise
    daily = defaultdict(float)
    for t in variable:
        daily[t["date"]] += t["amount"]
    daily_series = np.array([daily.get(date(today.year, today.month, x), 0.0) for x in range(1, d + 1)])
    sd_daily = float(np.std(daily_series, ddof=1)) if d >= 4 else float(np.mean(daily_series) if len(daily_series) else 0.0)
    sigma_rem = sd_daily * math.sqrt(max(remaining_days, 0))

    projected = spent + rate * remaining_days + expected_recurring
    floor = spent + expected_recurring
    low = max(projected - Z80 * sigma_rem, floor)
    high = projected + Z80 * sigma_rem
    p_exceed = None
    if budget and budget > 0:
        p_exceed = 1.0 - _norm_cdf((budget - projected) / sigma_rem) if sigma_rem > 1e-9 else (1.0 if projected > budget else 0.0)

    return {
        "day": d, "days_in_month": D, "spent_so_far": round(spent, 2),
        "daily_rate_used": round(rate, 2), "rate_source": rate_source,
        "expected_recurring_remaining": round(expected_recurring, 2),
        "projected_total": round(projected, 2), "low_80": round(low, 2), "high_80": round(high, 2),
        "probability_over_budget": None if p_exceed is None else round(float(p_exceed), 3),
        "reliability": "low" if d < 7 or len(mtd) < 5 or not months else "medium" if len(months) < 3 else "high",
    }


# ---------------------------------------------------------------------------
# anomalies
# ---------------------------------------------------------------------------
def detect_anomalies(txns, today, window_days=45, top=5):
    by_cat = defaultdict(list)
    for t in txns:
        by_cat[t["category"]].append(t)
    flagged = []
    all_logs = np.log([t["amount"] for t in txns]) if txns else np.array([])
    for t in txns:
        if (today - t["date"]).days > window_days:
            continue
        peers = [p for p in by_cat[t["category"]] if p is not t]
        if len(peers) >= 5:
            logs, scope, threshold = np.log([p["amount"] for p in peers]), f"your typical {t['category']} spending", 3.5
        elif len(txns) >= 10:
            logs, scope, threshold = np.log([p["amount"] for p in txns if p is not t]), "your typical expense", 4.0
        else:
            continue
        med = float(np.median(logs))
        mad = float(np.median(np.abs(logs - med)))
        if mad < 1e-9:
            mad = float(np.mean(np.abs(logs - med))) * 1.253 or 1e-9
        z = 0.6745 * (math.log(t["amount"]) - med) / mad
        typical = math.exp(med)
        if z > threshold and t["amount"] > 1.5 * typical:
            flagged.append({
                "id": t["id"], "description": t["description"], "amount": round(t["amount"], 2), "category": t["category"],
                "date": t["date"].isoformat(), "score": round(z, 2), "typical_amount": round(typical, 2),
                "reason": f"{t['amount'] / typical:.1f}x {scope}",
            })
    flagged.sort(key=lambda a: -a["score"])
    return flagged[:top]


# ---------------------------------------------------------------------------
# categories, discretionary, goals
# ---------------------------------------------------------------------------
def category_trends(txns, today, months):
    key = _month_key(today)
    d = today.day
    D = calendar.monthrange(today.year, today.month)[1]
    keys = [k for k, _ in months]
    cur, hist = defaultdict(float), defaultdict(float)
    for t in txns:
        mk = _month_key(t["date"])
        if mk == key and t["date"] <= today:
            cur[t["category"]] += t["amount"]
        elif mk in keys:
            hist[t["category"]] += t["amount"]
    rows = []
    for cat in sorted(set(cur) | set(hist)):
        avg = hist.get(cat, 0.0) / len(keys) if keys else None
        expected = None if avg is None else avg * d / D
        pace = None if not expected else (cur.get(cat, 0.0) / expected - 1.0)
        rows.append({"category": cat, "this_month": round(cur.get(cat, 0.0), 2),
                     "avg_month": None if avg is None else round(avg, 2),
                     "pace_vs_average": None if pace is None else round(pace, 3)})
    rows.sort(key=lambda r: -r["this_month"])
    return rows


def discretionary_summary(txns, today, months, forecast):
    keys = {k for k, _ in months}
    if keys:
        per_month = [sum(t["amount"] for t in txns if _month_key(t["date"]) == k and t["category"] in DISCRETIONARY) for k in sorted(keys)]
        return {"avg_monthly": round(float(np.mean(per_month)), 2), "basis": f"average of {len(keys)} complete month(s)",
                "categories": list(DISCRETIONARY)}
    key = _month_key(today)
    mtd = sum(t["amount"] for t in txns if _month_key(t["date"]) == key and t["category"] in DISCRETIONARY)
    d, D = forecast["day"], forecast["days_in_month"]
    return {"avg_monthly": round(mtd / max(d, 1) * D, 2), "basis": "this month's pace (no complete months yet)",
            "categories": list(DISCRETIONARY)}


def goal_feasibility(goals, today, monthly_inflow, monthly_tuition, typical_spend):
    surplus = max(monthly_inflow - monthly_tuition - typical_spend, 0.0)
    rows, total_required = [], 0.0
    for g in goals or []:
        try:
            target, saved = float(g["target_amount"]), float(g.get("saved_amount", 0))
            deadline = _d(str(g["deadline"]))
        except (KeyError, ValueError, TypeError):
            continue
        remaining = max(target - saved, 0.0)
        days = (deadline - today).days
        months_left = max(math.ceil(days / 30.44), 1) if days > 0 else 0
        required = remaining / months_left if months_left else remaining
        if remaining <= 0:
            status = "done"
        else:
            total_required += required
            status = "overdue" if days <= 0 else "pending"
        rows.append({"id": g.get("id"), "name": g.get("name"), "remaining": round(remaining, 2), "months_left": months_left,
                     "required_monthly": round(required, 2), "status": status})
    for r in rows:
        if r["status"] == "pending":
            r["status"] = "affordable" if surplus >= total_required else ("stretch" if surplus >= r["required_monthly"] else "short")
    return {"monthly_surplus_estimate": round(surplus, 2), "total_required_monthly": round(total_required, 2),
            "shortfall": round(max(total_required - surplus, 0.0), 2), "goals": rows,
            "surplus_basis": "income + aid - tuition - typical monthly spending"}


# ---------------------------------------------------------------------------
# dataset sanity check (why the student dataset is not used for predictions)
# ---------------------------------------------------------------------------
_QUALITY = {}


def data_quality_report():
    if _QUALITY:
        return _QUALITY
    import csv
    path = os.path.join(classifier.ROOT, "student.csv")
    if not os.path.exists(path):
        return {"available": False}
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    living = ["housing", "food", "transportation", "entertainment", "personal_care", "health_wellness", "miscellaneous"]
    y = np.array([sum(float(r[c]) for c in living) for r in rows])
    result = {"available": True, "rows": len(rows), "relationships": []}
    for col in ("monthly_income", "financial_aid", "age"):
        x = np.array([float(r[col]) for r in rows])
        result["relationships"].append({"feature": col, "type": "correlation", "value": round(float(np.corrcoef(x, y)[0, 1]), 3)})
    for col in ("major", "year_in_school", "gender", "preferred_payment_method"):
        groups = defaultdict(list)
        for r, val in zip(rows, y):
            groups[r[col]].append(val)
        grand = y.mean()
        ss_between = sum(len(v) * (np.mean(v) - grand) ** 2 for v in groups.values())
        result["relationships"].append({"feature": col, "type": "eta_squared", "value": round(float(ss_between / ((y - grand) ** 2).sum()), 4)})
    strongest = max(abs(r["value"]) if r["type"] == "correlation" else math.sqrt(r["value"]) for r in result["relationships"])
    result["strongest_signal"] = round(float(strongest), 3)
    result["verdict"] = ("No usable signal: spending is statistically unrelated to income, aid, age, major, year, gender or "
                         "payment method, which is typical of randomly generated data. It is shown only as an illustrative "
                         "cohort average.") if strongest < 0.1 else "Some relationship between profile and spending."
    _QUALITY.update(result)
    return _QUALITY


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------
def compute(payload):
    today = _d(payload["today"]) if payload.get("today") else date.today()
    txns = _clean_txns(payload.get("transactions"))
    profile = payload.get("profile") or {}
    prior = float(profile.get("prior_budget") or 0.0)
    inflow = float(profile.get("monthly_inflow") or 0.0)
    tuition = float(profile.get("monthly_tuition") or 0.0)

    months = _complete_months(txns, today)
    budget = budget_estimate(prior, months)
    recurring = find_recurring(txns, today)
    forecast = forecast_month(txns, today, budget["recommended"], recurring, months)
    anomalies = detect_anomalies(txns, today)
    trends = category_trends(txns, today, months)
    discretionary = discretionary_summary(txns, today, months, forecast)
    typical_spend = (budget["history_centre"] if budget["history_centre"] is not None else forecast["projected_total"])
    goals = goal_feasibility(payload.get("goals"), today, inflow, tuition, typical_spend)

    n = len(months)
    return {
        "as_of": today.isoformat(),
        "data": {"transactions": len(txns), "complete_months": n,
                 "first_date": txns[0]["date"].isoformat() if txns else None,
                 "level": "low" if n == 0 else "medium" if n < 3 else "high",
                 "note": ("Not enough history yet: using the cost-of-living estimate and this month's pace." if n == 0 else
                          "Early estimate: more months of data will sharpen this." if n < 3 else "Based on your own spending history.")},
        "budget": budget, "forecast": forecast, "recurring": recurring[:8], "anomalies": anomalies,
        "category_trends": trends, "discretionary": discretionary, "goals": goals,
        "peer_data_quality": data_quality_report(),
    }
