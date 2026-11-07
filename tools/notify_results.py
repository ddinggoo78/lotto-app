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
        if day.get("round") != R: continue
        for sset in day.get("sets", []):
            for n in sset.get("combos", []):
                k = tuple(sorted(n))
                if k not in seen: seen.add(k); combos.append(list(k))
    lines = [f"당첨번호 {' '.join(f'{v:02d}' for v in sorted(win))} + 보너스 {bonus:02d}"]
    if not combos:
        lines.append("이번 회차에 저장한 번호가 없어요.")
    else:
        res = sorted(((rank(n), n) for n in combos), key=lambda x: (x[0][0] or 9, -x[0][1]))
        hits = [r for r in res if r[0][0]]
        best = min((r[0][0] for r in hits), default=0)
        lines.append(f"내 번호 {len(combos)}개 → " + (f"최고 {best}등! ({len(hits)}개 당첨)" if best else "이번엔 당첨 없음"))
        for (rk, m), n in res[:10]:
            lines.append(f"{' '.join(f'{v:02d}' for v in n)}  {m}개 일치" + (f" · {rk}등" if rk else ""))
    title = f"🎱 제{R}회 결과 · {name}님"
    req = urllib.request.Request(f"https://ntfy.sh/{topic}?title={urllib.parse.quote(title)}&tags=four_leaf_clover", data="\n".join(lines).encode("utf-8"), method="POST")
    urllib.request.urlopen(req, timeout=20).read()
    call(f"https://firestore.googleapis.com/v1/{doc['name']}?updateMask.fieldPaths=notified", "PATCH", {"fields": {"notified": {"integerValue": str(R)}}})
    sent += 1; print(f"{name}: 알림 보냄")
print(f"제{R}회 결과 알림 {sent}명")
