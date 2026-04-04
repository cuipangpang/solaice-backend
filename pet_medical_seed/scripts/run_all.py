"""
run_all.py
전체 파이프라인 실행 스크립트
1. 네이버 크롤링 시도
2. 크롤링 차단 시 fallback 시드 생성
3. 이미지 케이스 생성
4. 병합 및 최종 seed_db.json 생성
"""
import subprocess
import sys
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")


def run_script(name: str, path: str) -> bool:
    print(f"\n{'=' * 60}")
    print(f"▶  {name}")
    print("=" * 60)
    result = subprocess.run([sys.executable, path], capture_output=False)
    return result.returncode == 0


def check_requirements():
    required = ["requests", "bs4", "tqdm"]
    missing = []
    for pkg in required:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"⚠️  필요 패키지 설치 중: {', '.join(missing)}")
        subprocess.run([sys.executable, "-m", "pip", "install"] + missing)


if __name__ == "__main__":
    print("🐾 한국어 반려동물 의료 종자 지식 생성 파이프라인")
    print("=" * 60)

    check_requirements()

    # Step 1: 네이버 크롤링 (실패해도 계속 진행)
    naver_ok = run_script(
        "Step 1: 네이버 지식iN 크롤링",
        os.path.join(SCRIPTS_DIR, "01_crawl_naver.py")
    )
    if not naver_ok:
        print("⚠️  네이버 크롤링 실패. Fallback 데이터로 진행합니다.")

    # Step 2: 이미지 케이스 생성
    run_script(
        "Step 2: 이미지 진단 케이스 생성",
        os.path.join(SCRIPTS_DIR, "02_image_cases.py")
    )

    # Step 3: Fallback 시드 생성 (항상 실행)
    run_script(
        "Step 3: 고품질 수기 시드 데이터 생성",
        os.path.join(SCRIPTS_DIR, "03_fallback_seeds.py")
    )

    # Step 4: 병합
    run_script(
        "Step 4: 데이터 병합 및 최종 통계",
        os.path.join(SCRIPTS_DIR, "04_merge.py")
    )

    print("\n\n✅ 전체 파이프라인 완료!")
    print(f"📁 결과물: {BASE_DIR}/seed_db.json")
    print(f"📁 분류별: {BASE_DIR}/processed/")
