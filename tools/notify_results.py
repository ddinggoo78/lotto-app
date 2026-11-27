# -*- coding: utf-8 -*-
"""추첨 결과 알림 — 두 사람 각자의 저장 번호가 몇 개 맞았는지 각자 핸드폰(ntfy)으로 보냄.
GitHub Actions에서 당첨번호 업데이트 뒤에 실행. 비밀 FIREBASE_SA(서비스 계정 JSON)가 있어야 동작.
같은 회차는 한 번만 보냄(문서의 notified 값으로 확인)."""
import json, os, re, sys, urllib.parse, urllib.request
from google.oauth2 import service_account
from google.auth.transport.requests import Request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sa_text = os.environ.get("FIREBASE_SA", "").strip()
if not sa_text:
    print("FIREBASE_SA 없음 — 결과 알림 건너뜀"); sys.exit(0)
info = json.loads(sa_text)
PID = info["project_id"]
cred = service_account.Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/datastore"])
cred.refresh(Request())
H = {"Authorization": "Bearer " + cred.token, "Content-Type": "application/json"}
BASE = f"https://firestore.googleapis.com/v1/projects/{PID}/databases/(default)/documents/users"

def call(url, method="GET", body=None):
    req = urllib.request.Request(url, method=method, headers=H, data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or "{}")

# 최신 당첨번호
s = open(os.path.join(ROOT, "data", "lotto_data.js"), encoding="utf-8").read()
rows = json.loads(re.search(r"rows:\s*(\[.*\])\s*\}\s*;?\s*$", s, re.S).group(1))
last = rows[-1]; R = last[0]; win = set(last[2:8]); bonus = last[8]
prize = {1: last[10], 2: last[12], 3: last[14], 4: 50000, 5: 5000}
import datetime
if (datetime.date.today() - datetime.date.fromisoformat(last[1])).days > 3:
    print(f"최신 {R}회가 3일 넘게 지난 회차 — 알림 안 보냄"); sys.exit(0)
def rank(n):
    m = len(win & set(n))
    return (1 if m == 6 else 2 if m == 5 and bonus in n else 3 if m == 5 else 4 if m == 4 else 5 if m == 3 else 0), m

# 앱(simple.js)과 같게: 판매 마감(토 20:00) 뒤에 저장된 번호(QR 구매 용지 제외)는 저장 시각에 판매 중이던 회차로 친다
D0 = datetime.datetime(2002, 12, 7)  # 제1회 추첨일
def close_at(r): return D0 + datetime.timedelta(days=7 * (r - 1), hours=20)
def round_on_sale(t):
    r = max(1, (t - D0).days // 7)
    while r > 1 and close_at(r - 1) > t: r -= 1
    while close_at(r) <= t: r += 1
    return r
def set_round(day, sset):
    r = day.get("round"); t = str(sset.get("t") or "")
    if not isinstance(r, int) or "b" in (sset.get("src") or []) or t.endswith(" QR"): return r
    try:
        at = datetime.datetime.strptime(str(day.get("date")), "%Y-%m-%d")
        if len(t) >= 5 and t[2] == ":" and t[:2].isdigit() and t[3:5].isdigit(): at = at.replace(hour=int(t[:2]), minute=int(t[3:5]))
    except Exception: return r
    return r if at < close_at(r) else round_on_sale(at)

docs, token = [], None
while True:
    d = call(BASE + "?pageSize=50" + (f"&pageToken={token}" if token else ""))
    docs += d.get("documents", []); token = d.get("nextPageToken")
    if not token: break

sent = 0
for doc in docs:
    f = doc.get("fields", {})
    topic = f.get("topic", {}).get("stringValue"); name = f.get("name", {}).get("stringValue", "")
    if not topic or int(f.get("notified", {}).get("integerValue", 0)) >= R: continue
    try: st = json.loads(f.get("state", {}).get("stringValue") or "{}")
    except Exception: st = {}
    combos, seen = [], set()
    for day in st.get("days", []):
        for sset in day.get("sets", []):
            if set_round(day, sset) != R: continue
            for n in sset.get("combos", []):
                k = tuple(sorted(n))
                if k not in seen: seen.add(k); combos.append(list(k))
    # 최종 게임 (앱 「내 번호 조회」에서 5게임씩 장으로 고른 실제로 살 번호) — 있으면 맨 먼저
    fz = next((x for x in st.get("finals", []) if isinstance(x, dict) and x.get("round") == R), None)
    finals = [sorted(int(v) for v in g) for g in ((fz or {}).get("games") or []) if len(g) == 6]
    sizes = [s.get("n") for s in ((fz or {}).get("sheets") or []) if isinstance(s, dict)]
    if not sizes or any(not isinstance(x, int) or x < 1 for x in sizes) or sum(sizes) != len(finals):
        sizes = [min(5, len(finals) - j) for j in range(0, len(finals), 5)]
    labels = [(f"{j + 1}장 " if len(sizes) > 1 else "") + "ABCDE"[i] for j, s in enumerate(sizes) for i in range(s)]
    lines = [f"당첨번호 {' '.join(f'{v:02d}' for v in sorted(win))} + 보너스 {bonus:02d}"]
    best_all = 0
    if finals:
        fr = [rank(n) for n in finals]
        fh = [rk for rk, _ in fr if rk]
        fbest = min(fh, default=0); best_all = fbest
        won = sum(prize[rk] for rk in fh)
        head = f"[최종 {len(sizes)}장 · {len(finals)}게임]" if len(sizes) > 1 else f"[최종 {len(finals)}게임]"
        lines.append(head + " " + (f"최고 {fbest}등! ({len(fh)}게임 당첨 · {won:,}원)" if fbest else "이번엔 당첨 없음"))
        for i, (n, (rk, m)) in enumerate(zip(finals, fr)):
            if len(finals) > 15 and not rk: continue  # 많이 샀으면 맞은 게임만
            lines.append(f"{labels[i]}  {' '.join(f'{v:02d}' for v in n)}  {m}개 일치" + (f" · {rk}등" if rk else ""))
    if not combos:
        if not finals: lines.append("이번 회차에 저장한 번호가 없어요.")
    else:
        res = sorted(((rank(n), n) for n in combos), key=lambda x: (x[0][0] or 9, -x[0][1]))
        hits = [r for r in res if r[0][0]]
        best = min((r[0][0] for r in hits), default=0)
        best_all = min([b for b in (best_all, best) if b], default=0)
        fk = {tuple(n) for n in finals}
        lines.append(("[저장한 번호 전체] " if finals else "") + f"내 번호 {len(combos)}개 → " + (f"최고 {best}등! ({len(hits)}개 당첨)" if best else "이번엔 당첨 없음"))
        for (rk, m), n in (hits[:10] if finals else res[:10]):
            lines.append(f"{' '.join(f'{v:02d}' for v in n)}  {m}개 일치" + (f" · {rk}등" if rk else "") + (" (최종)" if tuple(n) in fk else ""))
    title = f"{'🎉' if best_all else '🎱'} 제{R}회 결과 · {name}님"
    req = urllib.request.Request(f"https://ntfy.sh/{topic}?title={urllib.parse.quote(title)}&tags=four_leaf_clover", data="\n".join(lines).encode("utf-8"), method="POST")
    urllib.request.urlopen(req, timeout=20).read()
    call(f"https://firestore.googleapis.com/v1/{doc['name']}?updateMask.fieldPaths=notified", "PATCH", {"fields": {"notified": {"integerValue": str(R)}}})
    sent += 1; print(f"{name}: 알림 보냄")
print(f"제{R}회 결과 알림 {sent}명")
