# TwinTower Ops — 프로젝트 컨텍스트

## 앱 개요
트윈타워 빌딩 재난 대응 실시간 협업 시스템.
- **지휘관**: 재난 발령, 대원 현황 모니터링
- **대원**: 나의 임무 체크리스트 실시간 확인/수행
- **COP**: 전체 상황판 조회

## 기술 스택
- React 19 + TypeScript + Vite 8
- Supabase (Realtime DB)
- GitHub Pages 배포 (`npm run deploy`)

## 환경 변수 (.env — git 제외)
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## 로컬 실행
```bash
npm install
npm run dev        # http://localhost:5173/
npm run seed       # disasters.ts → Supabase 1회 seed (최초 1회만)
npm run build
npm run deploy     # GitHub Pages 배포
```

## Supabase 테이블 구조
| 테이블 | 역할 |
|---|---|
| `incidents` | 활성 재난 정보 |
| `responders` | 대원 출동 상태 |
| `member_tasks` | 발령 시 생성되는 실시간 임무 체크 |
| `disaster_roles` | 재난별 역할·badge 마스터 (seed로 관리) |
| `disaster_tasks` | 역할별 임무 항목 마스터 (seed로 관리) |

## 현재 브랜치: feature/supabase-disaster-db
disasters.ts 하드코딩 데이터를 Supabase DB로 이관하는 작업.
- `npm run seed` 실행 후 disasters.ts의 member 데이터는 DB가 primary source
- disa_app(https://atssa-kim.github.io/disa_app/)이 마스터 데이터 편집 도구

## 데이터 흐름
```
disa_app (편집) → Supabase disaster_roles/tasks → twintower-ops (실행)
```

## 핵심 파일
- `src/services/supabase.ts` — DB 타입 및 헬퍼 함수
- `src/hooks/useRealtime.ts` — Supabase Realtime 구독
- `src/data/disasters.ts` — 재난 유형 목록 (key/label/color/icon만 관리)
- `scripts/seed-disasters.ts` — DB 초기 데이터 적재

## 배포 URL
- 운영: https://atssa-kim.github.io/twintower-ops
- 기준 브랜치: main (feature 브랜치 작업 완료 후 merge)
