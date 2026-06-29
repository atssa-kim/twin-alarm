# Twin-alarm 배포 매뉴얼

트윈타워 빌딩 재난 대응 시스템 — 초기 구축부터 운영 배포까지

---

## 목차

1. [사전 준비](#1-사전-준비)
2. [저장소 클론 및 패키지 설치](#2-저장소-클론-및-패키지-설치)
3. [Supabase 설정](#3-supabase-설정)
4. [Firebase FCM 설정](#4-firebase-fcm-설정)
5. [환경 변수 설정](#5-환경-변수-설정)
6. [마스터 데이터 Seed](#6-마스터-데이터-seed)
7. [로컬 개발 서버](#7-로컬-개발-서버)
8. [GitHub Pages 배포](#8-github-pages-배포)
9. [Supabase Edge Function 배포](#9-supabase-edge-function-배포)
10. [카카오 알림톡 연동 (선택)](#10-카카오-알림톡-연동-선택)
11. [PWA 설치 안내](#11-pwa-설치-안내)
12. [운영 중 유지보수](#12-운영-중-유지보수)

---

## 1. 사전 준비

### 필수 계정
| 서비스 | 용도 | URL |
|---|---|---|
| GitHub | 소스 저장소 + Pages 배포 호스팅 | https://github.com |
| Supabase | 실시간 DB + Edge Function | https://supabase.com |
| Firebase | FCM 푸시 알림 | https://console.firebase.google.com |

### 필수 설치 (로컬 PC)
```bash
# Node.js 20 이상
node --version   # v20.x.x 이상

# npm (Node 설치 시 포함)
npm --version

# Git
git --version
```

---

## 2. 저장소 클론 및 패키지 설치

```bash
git clone https://github.com/atssa-kim/twin-alarm.git
cd twin-alarm
npm install
```

---

## 3. Supabase 설정

### 3-1. 프로젝트 생성
1. [https://supabase.com](https://supabase.com) → 새 프로젝트 생성
2. 프로젝트 이름, DB 비밀번호 설정 후 생성 완료 대기 (약 1~2분)

### 3-2. 테이블 스키마 생성
Supabase Dashboard → **SQL Editor** → `supabase_schema.sql` 전체 내용 붙여넣기 → 실행

생성되는 테이블:

| 테이블 | 역할 |
|---|---|
| `incidents` | 활성 재난 정보 |
| `responders` | 대원 출동 상태 |
| `member_tasks` | 발령 시 생성되는 실시간 임무 체크 |
| `disaster_roles` | 재난별 역할·badge 마스터 |
| `disaster_tasks` | 역할별 임무 항목 마스터 |
| `employees` | 직원 명부 |
| `employee_disaster_badges` | 직원별 재난 배지 매핑 |
| `push_subscriptions` | FCM 푸시 토큰 저장 |

### 3-3. Realtime 활성화 확인
Supabase Dashboard → **Database → Replication** → `supabase_realtime` publication에 아래 3개 테이블이 포함되어 있는지 확인:
- `incidents`
- `responders`
- `member_tasks`

### 3-4. API 키 확인
Supabase Dashboard → **Project Settings → API**

| 항목 | 설명 |
|---|---|
| Project URL | `VITE_SUPABASE_URL` 에 사용 |
| anon public | `VITE_SUPABASE_ANON_KEY` 에 사용 |
| service_role | `SUPABASE_SERVICE_ROLE_KEY` 에 사용 (seed 전용, 절대 공개 금지) |

---

## 4. Firebase FCM 설정

### 4-1. Firebase 프로젝트 생성
1. [Firebase Console](https://console.firebase.google.com) → 프로젝트 추가
2. **Cloud Messaging** 활성화 (프로젝트 설정 → Cloud Messaging)

### 4-2. 웹 앱 등록 및 config 확인
1. Firebase Console → 프로젝트 설정 → 앱 추가 → 웹
2. 앱 닉네임 입력 후 등록
3. Firebase SDK config 확인 (`firebaseConfig` 객체)

### 4-3. VAPID 키 확인
Firebase Console → 프로젝트 설정 → **Cloud Messaging → 웹 푸시 인증서**
→ 키 쌍 생성 → Public Key (VAPID) 복사

### 4-4. 서비스 계정 키 다운로드 (Edge Function용)
Firebase Console → 프로젝트 설정 → **서비스 계정** → Node.js 선택 → **새 비공개 키 생성** → JSON 다운로드

> 이 JSON 파일의 내용 전체가 `FIREBASE_SERVICE_ACCOUNT` Supabase Secret 값이 됩니다.

### 4-5. src/services/notifications.ts 에 config 반영
```typescript
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
const VAPID_KEY = "..."; // 4-3에서 복사한 Public Key
```

---

## 5. 환경 변수 설정

프로젝트 루트에 `.env` 파일 생성 (`.gitignore`에 포함되어 있으므로 GitHub에 올라가지 않음):

```env
# Supabase
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# seed 스크립트 전용 — 절대 공개 금지
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 6. 마스터 데이터 Seed

### 6-1. 재난 역할·임무 데이터
```bash
npm run seed
```
`disaster_roles` + `disaster_tasks` 테이블에 9개 재난 유형의 역할·임무 데이터를 적재합니다.

### 6-2. 직원 명부 데이터
```bash
npm run seed-employees
```
`employees` + `employee_disaster_badges` 테이블에 직원 정보를 적재합니다.
upsert 방식이므로 중복 실행해도 무관합니다.

> **직원 데이터 수정 시**: `scripts/seed-employees.ts` 파일을 편집 후 재실행하면 됩니다.

---

## 7. 로컬 개발 서버

```bash
npm run dev
```
→ `http://localhost:5173/` 에서 확인

---

## 8. GitHub Pages 배포

### 8-1. 저장소 설정 (최초 1회)
GitHub 저장소 → **Settings → Pages**
- Source: **Deploy from a branch**
- Branch: `gh-pages` / `/ (root)`

### 8-2. 배포 명령

```bash
npm run deploy
```

내부적으로 `npm run build` → `gh-pages -d dist` 순서로 실행됩니다.

### 8-3. 배포 URL
```
https://atssa-kim.github.io/twin-alarm/
```

배포 후 GitHub Actions 또는 Pages 탭에서 배포 상태를 확인할 수 있습니다 (보통 1~3분 소요).

---

## 9. Supabase Edge Function 배포

FCM 푸시 알림 + 카카오 알림톡 발송을 담당하는 `notify-incident` Edge Function입니다.

### 9-1. Supabase CLI 설치
```bash
npm install -g supabase
supabase login
```

### 9-2. Secrets 등록
Supabase Dashboard → **Edge Functions → Secrets (Vault)** 에서 아래 값을 등록합니다:

| Secret 이름 | 값 |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | 4-4에서 다운로드한 서비스 계정 JSON 전체 |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 키 |

### 9-3. 함수 배포
```bash
supabase functions deploy notify-incident --project-ref <PROJECT_REF>
```

또는 Supabase Dashboard → **Edge Functions → notify-incident → Deploy** 버튼 클릭.

### 9-4. 함수 URL 확인
```
https://<PROJECT_REF>.supabase.co/functions/v1/notify-incident
```

앱에서 발령 시 이 함수가 자동으로 호출됩니다.

---

## 10. 카카오 알림톡 연동 (선택)

발령 시 등록된 직원 휴대폰으로 카카오 알림톡을 발송하는 기능입니다.

### 10-1. SOLAPI 가입 및 설정
1. [https://solapi.com](https://solapi.com) 가입 → API Key / API Secret 발급
2. 카카오 비즈니스 채널 등록 (발신 프로필 ID: `KA01PF...`)
3. 알림톡 템플릿 작성 및 승인 신청
   - 변수: `#{재난}`, `#{장소}`, `#{내용}`
   - 예시: `[트윈타워] #{재난} 발생 알림\n장소: #{장소}\n내용: #{내용}`
4. 발신 번호 등록

### 10-2. Supabase Secrets 추가 등록

| Secret 이름 | 값 |
|---|---|
| `SOLAPI_API_KEY` | SOLAPI API Key |
| `SOLAPI_API_SECRET` | SOLAPI API Secret |
| `KAKAO_PF_ID` | 카카오 발신 프로필 ID (`KA01PF...`) |
| `KAKAO_TEMPLATE_ID` | 승인된 템플릿 ID (`KA01TP...`) |
| `SENDER_PHONE` | 등록된 발신 번호 (예: `0212345678`) |

### 10-3. Edge Function 재배포
Secrets 등록 후 Edge Function을 다시 배포해야 적용됩니다:
```bash
supabase functions deploy notify-incident --project-ref <PROJECT_REF>
```

> Secrets가 설정되지 않으면 카카오 발송을 자동으로 건너뜁니다 (FCM 푸시는 정상 작동).

---

## 11. PWA 설치 안내

### Android Chrome
1. 앱 접속 후 상단 **[설치]** 버튼 클릭
2. 또는 Chrome 메뉴 → **홈 화면에 추가**

### iOS Safari
1. 하단 공유 버튼(□↑) 탭
2. **홈 화면에 추가** 선택

### 기존 캐시 초기화 (테스트 시)
Chrome → 설정 → 사이트 설정 → 저장된 데이터 삭제 후 재접속

---

## 12. 운영 중 유지보수

### 앱 코드 업데이트 후 재배포
```bash
git pull origin main       # 최신 코드 반영
npm run deploy             # 빌드 + GitHub Pages 배포
```

### 직원 명부 수정
1. `scripts/seed-employees.ts` 파일 편집
2. 재실행:
   ```bash
   npm run seed-employees
   ```

### 재난 역할·임무 수정
1. `disa_app` 앱에서 편집 후 저장
2. 또는 `scripts/seed-disasters.ts` 직접 편집 후:
   ```bash
   npm run seed
   ```

### Supabase 스키마 캐시 오류 시
Supabase SQL Editor에서 실행:
```sql
NOTIFY pgrst, 'reload schema';
```

### DB 데이터 초기화 (테스트 후 정리)
Supabase SQL Editor에서 실행:
```sql
DELETE FROM public.incidents WHERE status = 'closed';
-- 또는 전체 초기화:
TRUNCATE public.responders, public.member_tasks, public.incidents CASCADE;
```

---

## 빠른 참조

### 명령어 요약
```bash
npm run dev              # 로컬 개발 서버 (http://localhost:5173/)
npm run build            # 프로덕션 빌드
npm run deploy           # GitHub Pages 배포 (빌드 포함)
npm run seed             # 재난 역할·임무 데이터 DB 적재
npm run seed-employees   # 직원 명부 DB 적재
```

### 주요 URL
| 항목 | URL |
|---|---|
| 운영 앱 | https://atssa-kim.github.io/twin-alarm/ |
| GitHub 저장소 | https://github.com/atssa-kim/twin-alarm |
| Supabase Dashboard | https://supabase.com/dashboard |
| Firebase Console | https://console.firebase.google.com |

### 핵심 파일 위치
| 파일 | 역할 |
|---|---|
| `.env` | 환경 변수 (git 제외) |
| `supabase_schema.sql` | 전체 테이블 DDL |
| `scripts/seed-disasters.ts` | 재난 역할·임무 seed |
| `scripts/seed-employees.ts` | 직원 명부 seed |
| `supabase/functions/notify-incident/index.ts` | FCM + 카카오 알림 Edge Function |
| `public/manifest.json` | PWA 매니페스트 |
| `public/firebase-messaging-sw.js` | FCM 백그라운드 서비스워커 |
