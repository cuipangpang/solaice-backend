"""
04_merge.py
모든 소스 데이터를 병합하여 최종 seed_db.json 생성
통계 출력 포함
"""
import json
import os
from collections import Counter, defaultdict
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROCESSED_DIR = os.path.join(BASE_DIR, "processed")
RAW_NAVER_DIR = os.path.join(BASE_DIR, "raw", "naver_jisik")
OUT_FILE = os.path.join(BASE_DIR, "seed_db.json")

QUALITY_MIN_ANSWER_LEN = 100

def load_json_safe(path: str) -> list:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"  ⚠️  로드 실패: {path} ({e})")
        return []


def dedup_by_id(entries: list[dict]) -> list[dict]:
    """id 기준 중복 제거"""
    seen = set()
    result = []
    for e in entries:
        eid = e.get("id", "")
        if eid not in seen:
            seen.add(eid)
            result.append(e)
    return result


def reassign_ids(entries: list[dict]) -> list[dict]:
    """id를 연속적으로 재할당"""
    for i, e in enumerate(entries):
        source_prefix = {
            "naver_jisik": "naver",
            "fallback_handcrafted": "seed",
            "image_case": "img",
        }.get(e.get("source", ""), "misc")
        e["id"] = f"{source_prefix}_{i+1:04d}"
    return entries


def compute_coverage(entries: list[dict]) -> int:
    """커버하는 질병 종류 수 추정"""
    subcategories = set(e.get("subcategory", "") for e in entries)
    categories = set(e.get("category", "") for e in entries)
    conditions = set(e.get("condition", "") for e in entries)
    return len(subcategories | categories | conditions)


def print_stats(entries: list[dict], img_cases: list[dict]):
    total = len(entries)
    img_total = len(img_cases)

    cat_count = Counter(e.get("category", "기타") for e in entries)
    animal_count = Counter(e.get("animal", "공통") for e in entries)
    urgency_count = Counter(e.get("urgency", "중간") for e in entries)
    source_count = Counter(e.get("source", "unknown") for e in entries)

    img_part_count = Counter(c.get("body_part", "기타") for c in img_cases)
    img_sev_count = Counter(c.get("severity", "중등도") for c in img_cases)

    coverage = compute_coverage(entries + img_cases)

    print("\n" + "=" * 60)
    print("📊 최종 종자 데이터베이스 통계")
    print("=" * 60)
    print(f"\n총 수집 건수 (Q&A): {total}건")
    print(f"이미지 설명 케이스:  {img_total}건")
    print(f"전체 합계:           {total + img_total}건")

    print(f"\n예상 커버리지: {coverage}개 질병/상태 종류")

    print("\n[소스별 분포]")
    for k, v in sorted(source_count.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}건")

    print("\n[동물 종류별 분포]")
    for k, v in sorted(animal_count.items(), key=lambda x: -x[1]):
        bar = "█" * (v // 1)
        print(f"  {k:8s}: {v:3d}건  {bar}")

    print("\n[카테고리별 분포]")
    for k, v in sorted(cat_count.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}건")

    print("\n[긴급도별 분포]")
    urgency_order = ["응급", "높음", "중간", "낮음"]
    for k in urgency_order:
        v = urgency_count.get(k, 0)
        bar = "█" * (v // 1)
        print(f"  {k:4s}: {v:3d}건  {bar}")

    print("\n[이미지 케이스 - 부위별]")
    for k, v in sorted(img_part_count.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}건")

    print("\n[이미지 케이스 - 중증도별]")
    for k, v in sorted(img_sev_count.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}건")


def main():
    print("=" * 60)
    print("최종 종자 데이터베이스 병합 시작")
    print("=" * 60)

    all_qa_entries = []

    # 1. 네이버 크롤링 결과
    naver_file = os.path.join(RAW_NAVER_DIR, "naver_all.json")
    naver_entries = []
    if os.path.exists(naver_file):
        naver_entries = load_json_safe(naver_file)
        print(f"✅ 네이버 크롤링 데이터: {len(naver_entries)}건")
    else:
        print("ℹ️  네이버 크롤링 데이터 없음 (크롤링 미실행 또는 차단)")

    all_qa_entries.extend(naver_entries)

    # 2. Fallback 시드 데이터
    fallback_file = os.path.join(PROCESSED_DIR, "fallback_seeds.json")
    fallback_entries = []
    if os.path.exists(fallback_file):
        fallback_entries = load_json_safe(fallback_file)
        print(f"✅ Fallback 시드 데이터: {len(fallback_entries)}건")
    else:
        print("⚠️  Fallback 시드 없음. python scripts/03_fallback_seeds.py 먼저 실행하세요.")

    all_qa_entries.extend(fallback_entries)

    # 3. 이미지 케이스
    img_file = os.path.join(PROCESSED_DIR, "image_cases.json")
    img_cases = []
    if os.path.exists(img_file):
        img_cases = load_json_safe(img_file)
        print(f"✅ 이미지 케이스: {len(img_cases)}건")
    else:
        print("⚠️  이미지 케이스 없음. python scripts/02_image_cases.py 먼저 실행하세요.")

    # 4. 중복 제거 및 ID 재할당
    all_qa_entries = dedup_by_id(all_qa_entries)
    all_qa_entries = reassign_ids(all_qa_entries)

    # 5. 최종 DB 구성
    seed_db = {
        "metadata": {
            "created_at": datetime.now().isoformat(),
            "version": "1.0.0",
            "description": "韩语宠物医疗种子知识库 / 한국어 반려동물 의료 시드 데이터베이스",
            "total_qa": len(all_qa_entries),
            "total_image_cases": len(img_cases),
            "sources": ["naver_jisik", "fallback_handcrafted"],
            "coverage_estimate": compute_coverage(all_qa_entries + img_cases),
        },
        "qa_entries": all_qa_entries,
        "image_cases": img_cases,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(seed_db, f, ensure_ascii=False, indent=2)

    # 6. 분리 파일 저장 (카테고리별)
    cat_groups = defaultdict(list)
    for e in all_qa_entries:
        cat = e.get("category", "기타")
        cat_groups[cat].append(e)

    category_map = {
        "귀질환": "cat_diseases",
        "안과질환": "cat_diseases",
        "내과질환": "cat_diseases",
        "호흡기질환": "cat_diseases",
        "소화기질환": "dog_diseases",
        "피부질환": "dog_diseases",
        "정형외과": "dog_diseases",
        "순환기질환": "dog_diseases",
        "치과질환": "dog_diseases",
        "응급": "emergency",
        "노령동물관리": "chronic_disease",
        "대사질환": "chronic_disease",
    }

    grouped = defaultdict(list)
    for e in all_qa_entries:
        cat = e.get("category", "기타")
        file_key = category_map.get(cat, "dog_diseases")
        # 고양이 항목은 cat_diseases로
        if e.get("animal") == "고양이":
            file_key = "cat_diseases"
        elif e.get("animal") == "강아지" and cat == "응급":
            file_key = "emergency"
        grouped[file_key].append(e)

    output_files = {
        "cat_diseases": os.path.join(PROCESSED_DIR, "cat_diseases.json"),
        "dog_diseases": os.path.join(PROCESSED_DIR, "dog_diseases.json"),
        "emergency": os.path.join(PROCESSED_DIR, "emergency.json"),
        "chronic_disease": os.path.join(PROCESSED_DIR, "chronic_disease.json"),
    }

    os.makedirs(PROCESSED_DIR, exist_ok=True)
    for key, path in output_files.items():
        items = grouped.get(key, [])
        with open(path, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        print(f"  → {os.path.basename(path)}: {len(items)}건")

    # 7. 통계 출력
    print_stats(all_qa_entries, img_cases)

    print(f"\n✅ 병합 완료")
    print(f"   최종 파일: {OUT_FILE}")
    print(f"   전체 데이터: {len(all_qa_entries) + len(img_cases)}건")


if __name__ == "__main__":
    main()
