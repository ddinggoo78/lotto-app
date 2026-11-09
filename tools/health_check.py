# -*- coding: utf-8 -*-
"""로또 분석기 앱 — 자동 점검 (GitHub Actions, PC·Claude와 상관없이 돎)
매일 새벽 + 토요일 추첨 1시간 전(19:35)에:
 1) 빠진 회차가 있으면 받기
 2) 최근 5회를 동행복권에서 다시 받아 저장된 값(번호·당첨자 수·판매액)과 비교 → 다르면 바로 고침
 3) 회차 번호가 빠짐없이 이어지는지 확인
 4) 번호 인기도 분석 기준(3·4·5등 당첨자 수 중 최근 150회 검증에서 가장 잘 맞는 것) 다시 계산
결과는 data/health.json 에 남깁니다."""
import datetime, json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update_data as U

KST = datetime.timezone(datetime.timedelta(hours=9))
now = datetime.datetime.now(KST)
stage = "추첨 1시간 전 최종 점검" if now.weekday() == 5 and now.hour >= 19 else "매일 점검"
결과 = {"checked_at": now.strftime("%Y-%m-%d %H:%M"), "stage": stage, "problems": [], "fixed": []}

up = U.업데이트()
결과["update"] = up
if up.get("error"):
    결과["problems"].append("동행복권 접속: " + str(up["error"]))

rows = U.데이터읽기()
nos = [r[0] for r in rows]
if nos != list(range(1, len(nos) + 1)):
    결과["problems"].append("회차 번호가 이어지지 않음")
바뀜 = False
if not up.get("error"):
    for i in range(max(0, len(rows) - 5), len(rows)):
        try:
            새 = U.회차받기(rows[i][0])
        except Exception as e:
            결과["problems"].append(f"{rows[i][0]}회 다시 받기 실패 ({e})"); continue
        if 새 and 새 != rows[i] and 새[2:9] == rows[i][2:9]:
            # 번호는 같고 당첨자 수·금액·판매액이 늦게 확정돼 바뀐 경우 → 최신 값으로 고침
            rows[i] = 새; 바뀜 = True; 결과["fixed"].append(f"{새[0]}회 당첨자 수·금액 최신 값으로 고침")
        elif 새 and 새[2:9] != rows[i][2:9]:
            결과["problems"].append(f"{rows[i][0]}회 번호가 동행복권과 다름 — 확인 필요")
if 바뀜:
    U.데이터쓰기(rows)

try:
    m = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "model_check.js")], capture_output=True, text=True, timeout=120)
    결과["model"] = json.loads(m.stdout.strip().splitlines()[-1])
except Exception as e:
    결과["problems"].append(f"분석 기준 계산 실패 ({e})")

결과["last_round"] = rows[-1][0] if rows else None
결과["ok"] = not 결과["problems"]
경로 = os.path.join(U.데이터폴더, "health.json")
json.dump(결과, open(경로, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
U.기록(json.dumps(결과, ensure_ascii=False))
