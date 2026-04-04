"""
01_crawl_naver.py
네이버 지식iN 수의학 Q&A 크롤러
봇 차단 시 에러 로그 저장 후 계속 진행
"""
import requests
from bs4 import BeautifulSoup
import json
import time
import random
import os
import re
from datetime import datetime
from tqdm import tqdm

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(BASE_DIR, "raw", "naver_jisik")
LOG_FILE = os.path.join(BASE_DIR, "raw", "crawl_errors.log")

KEYWORDS = {
    "고양이": [
        "귀진드기", "구토", "식욕부진", "눈곱", "피부병",
        "설사", "기침", "황달", "신부전", "당뇨"
    ],
    "강아지": [
        "구토", "설사", "피부병", "슬개골", "심장병",
        "귀염증", "눈병", "치주염", "비만", "관절염"
    ],
    "공통": [
        "응급처치", "예방접종", "중성화", "노령동물", "병원언제가야"
    ]
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.naver.com/",
    "Connection": "keep-alive",
}

QUALITY_FILTERS = {
    "min_answer_length": 100,
    "min_korean_ratio": 0.5,
    "reject_phrases": ["모르겠습니다", "확실하지 않아요", "잘 모르겠어요", "저도 모르겠"],
    "reject_dosage": re.compile(r'\d+\s*(mg|ml|cc|mcg)'),
    "reject_dangerous": ["타이레놀", "아세트아미노펜", "이부프로펜", "아스피린"],
}


def log_error(msg: str):
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now().isoformat()}] {msg}\n")


def korean_ratio(text: str) -> float:
    if not text:
        return 0.0
    korean_chars = sum(1 for c in text if "\uAC00" <= c <= "\uD7A3")
    total_chars = sum(1 for c in text if c.strip())
    return korean_chars / total_chars if total_chars > 0 else 0.0


def quality_check(answer: str) -> tuple[bool, str]:
    if len(answer) < QUALITY_FILTERS["min_answer_length"]:
        return False, f"too_short({len(answer)})"
    if korean_ratio(answer) < QUALITY_FILTERS["min_korean_ratio"]:
        return False, "low_korean_ratio"
    for phrase in QUALITY_FILTERS["reject_phrases"]:
        if phrase in answer:
            return False, f"uncertain_phrase:{phrase}"
    if QUALITY_FILTERS["reject_dosage"].search(answer):
        return False, "contains_dosage"
    for word in QUALITY_FILTERS["reject_dangerous"]:
        if word in answer:
            return False, f"dangerous_content:{word}"
    return True, "ok"


def search_naver_kin(query: str, page: int = 1) -> list[dict]:
    """네이버 지식iN 검색 결과 URL 목록 반환"""
    url = f"https://kin.naver.com/search/list.naver"
    params = {
        "query": query,
        "page": page,
        "dirId": "70301",  # 동물/식물 카테고리
    }
    try:
        resp = requests.get(url, headers=HEADERS, params=params, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        results = []
        # 실제 지식iN 검색결과 selectors (2024 기준)
        items = soup.select("ul.basic1 li") or soup.select(".question_list li") or soup.select("li.item")

        for item in items[:20]:
            link_tag = item.select_one("a.title") or item.select_one("dt a") or item.select_one("a")
            if not link_tag:
                continue
            href = link_tag.get("href", "")
            title = link_tag.get_text(strip=True)
            if href and title:
                if not href.startswith("http"):
                    href = "https://kin.naver.com" + href
                results.append({"url": href, "title": title})

        return results
    except Exception as e:
        log_error(f"search_error query={query} page={page}: {e}")
        return []


def fetch_qa_detail(url: str) -> dict | None:
    """지식iN 상세 페이지에서 Q&A 추출"""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # 질문 추출
        question = ""
        for sel in [".c-heading__title", ".title_content", "h3.title"]:
            tag = soup.select_one(sel)
            if tag:
                question = tag.get_text(strip=True)
                break

        # 본문 추출
        body = soup.select_one(".c-heading-answer__content") or \
               soup.select_one(".answer_content") or \
               soup.select_one(".se-main-container")
        question_body = soup.select_one(".c-heading__content") or \
                        soup.select_one(".question_detail")
        if question_body:
            question = question + " " + question_body.get_text(strip=True)

        if not body:
            return None

        answer = body.get_text(separator="\n", strip=True)

        # 채택답변 여부
        is_adopted = bool(soup.select_one(".badge_adopted") or soup.select_one(".c-badge--adopted"))

        return {
            "url": url,
            "question": question.strip(),
            "answer": answer.strip(),
            "is_adopted": is_adopted,
        }
    except Exception as e:
        log_error(f"detail_error url={url}: {e}")
        return None


def classify_category(keyword: str, animal: str) -> tuple[str, str]:
    """키워드 → (category, subcategory)"""
    mapping = {
        "귀진드기": ("귀질환", "이개선충증"),
        "귀염증": ("귀질환", "외이염"),
        "구토": ("소화기질환", "구토"),
        "설사": ("소화기질환", "설사"),
        "식욕부진": ("전신증상", "식욕부진"),
        "눈곱": ("안과질환", "결막염"),
        "눈병": ("안과질환", "각막/결막질환"),
        "피부병": ("피부질환", "피부염"),
        "기침": ("호흡기질환", "기침"),
        "황달": ("내과질환", "황달"),
        "신부전": ("내과질환", "신장질환"),
        "당뇨": ("내과질환", "당뇨병"),
        "슬개골": ("정형외과", "슬개골탈구"),
        "심장병": ("순환기질환", "심장질환"),
        "치주염": ("치과질환", "치주질환"),
        "비만": ("대사질환", "비만"),
        "관절염": ("정형외과", "관절질환"),
        "응급처치": ("응급", "응급처치"),
        "예방접종": ("예방의학", "예방접종"),
        "중성화": ("외과", "중성화수술"),
        "노령동물": ("노령동물관리", "노령동물"),
        "병원언제가야": ("진료상담", "내원시기"),
    }
    cat, sub = mapping.get(keyword, ("기타", keyword))
    return cat, sub


def infer_urgency(text: str) -> str:
    emergency_keywords = ["응급", "즉시", "당장", "위험", "생명", "쇼크", "경련", "발작", "의식"]
    high_keywords = ["빨리", "서둘러", "하루 이내", "24시간", "증상 악화"]
    low_keywords = ["지켜봐도", "천천히", "만성", "관찰해도"]

    text_lower = text.lower()
    if any(k in text for k in emergency_keywords):
        return "응급"
    if any(k in text for k in high_keywords):
        return "높음"
    if any(k in text for k in low_keywords):
        return "낮음"
    return "중간"


def extract_key_sentences(answer: str, max_n: int = 3) -> list[str]:
    sentences = [s.strip() for s in re.split(r'[.!?。\n]', answer) if len(s.strip()) > 20]
    # 중요 키워드 포함 문장 우선
    priority_keywords = ["병원", "치료", "증상", "원인", "예방", "주의", "검사"]
    scored = []
    for s in sentences:
        score = sum(1 for k in priority_keywords if k in s)
        scored.append((score, s))
    scored.sort(key=lambda x: -x[0])
    return [s for _, s in scored[:max_n]]


def run_crawler():
    os.makedirs(RAW_DIR, exist_ok=True)
    all_results = []
    seed_id = 1
    blocked_count = 0

    for animal, keywords in KEYWORDS.items():
        for keyword in tqdm(keywords, desc=f"[{animal}] 키워드 처리"):
            query = f"{animal} {keyword}" if animal != "공통" else keyword
            category, subcategory = classify_category(keyword, animal)

            search_results = search_naver_kin(query, page=1)
            time.sleep(random.uniform(1.0, 2.0))

            if not search_results:
                blocked_count += 1
                log_error(f"no_results: query={query} (blocked={blocked_count})")
                if blocked_count >= 3:
                    print(f"\n⚠️  네이버 크롤링 차단 감지 ({blocked_count}회). 크롤링 중단.")
                    return all_results, True  # blocked=True
                continue

            keyword_results = []
            for item in search_results[:20]:
                qa = fetch_qa_detail(item["url"])
                time.sleep(random.uniform(0.8, 1.5))

                if not qa or not qa["answer"]:
                    continue

                ok, reason = quality_check(qa["answer"])
                if not ok:
                    log_error(f"filtered: {item['url']} reason={reason}")
                    continue

                entry = {
                    "id": f"seed_{seed_id:04d}",
                    "source": "naver_jisik",
                    "animal": animal if animal != "공통" else "공통",
                    "category": category,
                    "subcategory": subcategory,
                    "urgency": infer_urgency(qa["answer"]),
                    "symptoms": [],  # 후처리에서 채움
                    "diagnosis_hints": [],
                    "treatment_direction": "",
                    "hospital_needed": any(k in qa["answer"] for k in ["병원", "수의사", "진료"]),
                    "raw_qa": {
                        "question": qa["question"],
                        "answer": qa["answer"],
                    },
                    "key_sentences": extract_key_sentences(qa["answer"]),
                    "is_adopted": qa.get("is_adopted", False),
                    "crawled_at": datetime.now().isoformat(),
                }
                keyword_results.append(entry)
                seed_id += 1

            all_results.extend(keyword_results)

            # 키워드별 중간 저장
            out_file = os.path.join(RAW_DIR, f"{animal}_{keyword}.json")
            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(keyword_results, f, ensure_ascii=False, indent=2)

            print(f"  → {query}: {len(keyword_results)}건 수집")

    return all_results, False


if __name__ == "__main__":
    print("=" * 60)
    print("네이버 지식iN 크롤러 시작")
    print("=" * 60)

    results, was_blocked = run_crawler()

    out_path = os.path.join(RAW_DIR, "naver_all.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 크롤링 완료: 총 {len(results)}건")
    if was_blocked:
        print("⚠️  크롤링이 차단되었습니다. fallback seed 생성기를 실행하세요:")
        print("   python scripts/03_fallback_seeds.py")
    print(f"출력 파일: {out_path}")
