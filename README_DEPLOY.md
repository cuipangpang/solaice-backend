# 배포 가이드

## 환경 정보

| 항목 | 값 |
|------|-----|
| 서버 | 텐센트 클라우드 43.164.134.43 |
| 저장소 | https://github.com/cuipangpang/solaice-backend |
| 프로젝트 경로 | /opt/solaice/ |
| docker-compose 경로 | /opt/solaice/backend/ |
| 백엔드 컨테이너 | backend-api-1 |
| DB 컨테이너 | backend-db-1 |

## 자동 배포 방법

```bash
# 로컬에서 코드 수정 후
git add .
git commit -m "feat: 변경 내용 설명"
git push origin main
# → GitHub Actions가 자동으로 서버에 배포 (약 3~5분)
```

배포 진행 상황 확인:
https://github.com/cuipangpang/solaice-backend/actions

## 수동 배포 방법 (긴급 시)

```bash
ssh root@43.164.134.43
cd /opt/solaice
git fetch origin main && git reset --hard origin/main
cd backend
docker compose build backend-api
docker compose up -d --no-deps backend-api
```

## 자주 쓰는 운영 명령어

```bash
# 서버 SSH 접속
ssh root@43.164.134.43

# 서비스 상태 확인
cd /opt/solaice/backend && docker compose ps

# 백엔드 로그 실시간 확인
docker compose logs backend-api -f

# 최근 로그 100줄
docker compose logs backend-api --tail=100

# 백엔드만 재시작 (코드 변경 없이)
docker compose restart backend-api

# 강제 재빌드
docker compose build backend-api && docker compose up -d --no-deps backend-api

# 컨테이너 내부 접속 (디버깅)
docker compose exec backend-api bash

# DB 마이그레이션 수동 실행
docker compose exec backend-api python scripts/migrate_chat_tables.py

# 디스크 정리
docker image prune -f
```

## 롤백 방법

```bash
ssh root@43.164.134.43
cd /opt/solaice

# 커밋 히스토리 확인
git log --oneline -10

# 특정 커밋으로 롤백
git reset --hard <commit_hash>
cd backend
docker compose build backend-api
docker compose up -d --no-deps backend-api
```

## 장애 대응

### 배포 후 접속 불가
1. 텐센트 클라우드 보안 그룹에서 8000 포트 개방 확인
2. `docker compose ps` 로 컨테이너 상태 확인
3. `docker compose logs backend-api --tail=50` 로 오류 확인

### DB 연결 실패
```bash
docker compose ps db
docker compose restart db
```

### GitHub Actions 배포 실패
1. https://github.com/cuipangpang/solaice-backend/actions 에서 로그 확인
2. SERVER_SSH_KEY, SERVER_USER Secrets 설정 확인
3. 서버에서 수동 배포로 임시 대응
