#!/bin/bash
# 서버 환경 설명 문서 (이미 완료된 단계 — 재실행 금지)
# 서버: 43.164.134.43
# 프로젝트 경로: /opt/solaice/
#
# 이미 완료된 단계:
#   1. cd /opt/solaice && git init
#   2. git remote add origin https://github.com/cuipangpang/solaice-backend.git
#   3. git fetch origin main && git reset --hard origin/main
#   4. SSH 키 생성: ~/.ssh/github_actions_solaice
#   5. GitHub Secrets 설정: SERVER_SSH_KEY, SERVER_USER
#
# 신규 서버에서 재구성할 경우 아래 명령어를 실행하세요.

set -e

echo "=== solaice-backend 서버 재구성 스크립트 ==="

# 1. 프로젝트 디렉터리 생성
mkdir -p /opt/solaice
cd /opt/solaice

# 2. git 초기화 및 코드 클론
git init
git remote add origin https://github.com/cuipangpang/solaice-backend.git
git fetch origin main
git reset --hard origin/main

# 3. .env 파일 확인
if [ ! -f /opt/solaice/backend/.env ]; then
  echo ""
  echo "⚠️  /opt/solaice/backend/.env 파일이 없습니다. 수동으로 생성하세요."
  echo "필요한 환경변수 목록:"
  echo "  DATABASE_URL=postgresql+asyncpg://postgres:postgres@db:5432/solaice_db"
  echo "  REDIS_URL=redis://redis:6379/0"
  echo "  QWEN_API_KEY=your_key_here"
  echo "  AWS_ACCESS_KEY_ID=your_key_here"
  echo "  AWS_SECRET_ACCESS_KEY=your_key_here"
  echo "  AWS_REGION=ap-northeast-2"
  echo "  S3_BUCKET_NAME=your_bucket_here"
  echo "  ALLOWED_ORIGINS=*"
  echo "  CHAT_MAX_TURNS=20"
  echo "  CHAT_SUMMARY_INTERVAL=5"
  echo ""
  echo ".env 파일 생성 후 다시 실행하세요."
  exit 1
fi

# 4. 서비스 시작
cd /opt/solaice/backend
docker compose up -d

echo ""
echo "✅ 서버 구성 완료"
echo "헬스체크: curl http://localhost:8000/api/v1/health"
