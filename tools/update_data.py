# -*- coding: utf-8 -*-
"""로또 분석기 앱 — 매주 당첨번호 자동 업데이트 (GitHub Actions에서 실행)
동행복권 공식 주소에서 마지막 저장 회차 다음부터 최신까지 받아 data/lotto_data.js 와 data/lotto_history.csv 를 갱신합니다.
PC 프로그램(로또분석기.py)과 같은 수집 코드입니다."""
import datetime, json, os, re, sys, threading, time, urllib.request
폴더 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
데이터폴더 = os.path.join(폴더, "data")
JS파일 = os.path.join(데이터폴더, "lotto_data.js")
CSV파일 = os.path.join(데이터폴더, "lotto_history.csv")
def 기록(*a): print(*a, flush=True)
KST = datetime.timezone(datetime.timedelta(hours=9))
잠금 = threading.Lock()
상태 = {"마지막신호": time.time(), "데이터버전": 0, "업데이트중": False}

FIELDS = ["round", "date", "n1", "n2", "n3", "n4", "n5", "n6", "bonus", "w1Cnt", "w1Amt", "w2Cnt", "w2Amt",
          "w3Cnt", "w3Amt", "w4Cnt", "w4Amt", "w5Cnt", "w5Amt", "sales", "auto", "manual", "semi"]
CSV머리 = "회차,추첨일,번호1,번호2,번호3,번호4,번호5,번호6,보너스,1등당첨자수,1등1인당금액,2등당첨자수,2등1인당금액,3등당첨자수,3등1인당금액,4등당첨자수,4등1인당금액,5등당첨자수,5등1인당금액,판매금액,1등자동,1등수동,1등반자동"
API_새 = "https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd="
API_옛 = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo="




# ---------------- 데이터 ----------------
def 데이터읽기():
    """lotto_data.js 의 rows 를 리스트로 읽는다"""
    if not os.path.exists(JS파일):
        return []
    s = open(JS파일, encoding="utf-8").read()
    m = re.search(r"rows:\s*(\[.*\])\s*\}\s*;?\s*$", s, re.S)
    if not m:
        return []
    return json.loads(m.group(1))


def 데이터쓰기(rows):
    os.makedirs(데이터폴더, exist_ok=True)
    stamp = datetime.datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    js = ("/* 자동 생성 파일 - 로또분석기.py 가 갱신합니다. 직접 수정하지 마세요. */\n"
          "/* 출처: 동행복권 (dhlottery.co.kr) 로또 6/45 회차별 당첨결과 */\n"
          "window.LOTTO_DATA = {\n"
          f'  updated: "{stamp}",\n'
          f"  fields: {json.dumps(FIELDS)},\n"
          "  rows: [\n" + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows) + "\n  ]\n};\n")
    임시 = JS파일 + ".tmp"
    open(임시, "w", encoding="utf-8").write(js)
    os.replace(임시, JS파일)
    with open(CSV파일 + ".tmp", "w", encoding="utf-8-sig", newline="") as f:  # 엑셀에서 한글이 안 깨지게 BOM
        f.write(CSV머리 + "\r\n")
        for r in rows:
            f.write(",".join(str(x) for x in r) + "\r\n")
    os.replace(CSV파일 + ".tmp", CSV파일)


def 받기(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def 숫(v):
    try:
        return int(float(v))
    except Exception:
        return 0


def 회차받기(no):
    """한 회차를 받아 23칸 행으로. 아직 추첨 전이면 None"""
    오류 = None
    for 시도 in range(2):
        try:
            d = 받기(API_새 + str(no))
            목록 = ((d or {}).get("data") or {}).get("list") or []
            for x in 목록:
                if 숫(x.get("ltEpsd")) == no:
                    ymd = str(x.get("ltRflYmd"))
                    nums = sorted(숫(x.get(f"tm{i}WnNo")) for i in range(1, 7))
                    return [no, f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}"] + nums + [
                        숫(x.get("bnsWnNo")), 숫(x.get("rnk1WnNope")), 숫(x.get("rnk1WnAmt")), 숫(x.get("rnk2WnNope")),
                        숫(x.get("rnk2WnAmt")), 숫(x.get("rnk3WnNope")), 숫(x.get("rnk3WnAmt")), 숫(x.get("rnk4WnNope")),
                        숫(x.get("rnk4WnAmt")), 숫(x.get("rnk5WnNope")), 숫(x.get("rnk5WnAmt")),
                        숫(x.get("wholEpsdSumNtslAmt")), 숫(x.get("winType1")), 숫(x.get("winType2")), 숫(x.get("winType3"))]
            return None
        except Exception as e:  # 새 주소가 안 되면 옛 주소로
            오류 = e
            try:
                d = 받기(API_옛 + str(no))
                if d.get("returnValue") != "success":
                    return None
                nums = sorted(숫(d.get(f"drwtNo{i}")) for i in range(1, 7))
                return [no, d.get("drwNoDate")] + nums + [숫(d.get("bnusNo")), 숫(d.get("firstPrzwnerCo")),
                                                           숫(d.get("firstWinamnt")), 0, 0, 0, 0, 0, 50000, 0, 5000,
                                                           숫(d.get("totSellamnt")), 0, 0, 0]
            except Exception as e2:
                오류 = e2
            time.sleep(2 * (시도 + 1))
    raise RuntimeError(f"{no}회차를 받지 못했어요 ({오류})")


def 업데이트():
    """마지막 저장 회차 다음부터 최신까지 받는다"""
    with 잠금:
        if 상태["업데이트중"]:
            return {"added": 0, "latest": None, "error": "이미 받는 중"}
        상태["업데이트중"] = True
    try:
        rows = 데이터읽기()
        last = rows[-1][0] if rows else 0
        추가 = 0
        오류 = None
        no = last + 1
        while True:
            try:
                r = 회차받기(no)
            except Exception as e:
                오류 = str(e)
                break
            if not r:
                break
            rows.append(r)
            추가 += 1
            if 추가 % 50 == 0:
                기록(f"{no}회차까지 받는 중…")
            no += 1
            time.sleep(0.06)
        if 추가:
            데이터쓰기(rows)
            상태["데이터버전"] += 1
            기록(f"새 회차 {추가}개 저장 (최신 {rows[-1][0]}회)")
        return {"added": 추가, "latest": rows[-1][0] if rows else None, "error": 오류}
    finally:
        상태["업데이트중"] = False



if __name__ == "__main__":
    r = 업데이트()
    기록("결과:", r)
    if r.get("error") and not r.get("added"):
        sys.exit(1)  # 받지 못했으면 실패로 표시 (다음 예약 때 다시 시도)
