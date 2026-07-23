export interface Disaster {
  key: string;
  label: string;
  color: string;
}

// 화재 감지기동작(1차 소집) 대상 배지 — CommanderDashboard(발령 시 역할 필터)와
// ResponderView(에스컬레이션 대기 여부 판단) 양쪽에서 동일하게 참조. 이전엔 두 파일에
// 각각 따로 선언돼 있었고, 한쪽은 렌더마다 새로 Set을 만들고 있었음(2026-07-20 정리).
export const FIRE_INITIAL_BADGES = new Set(['총괄', '상황', '통제', '출동']);

export const DISASTERS: Disaster[] = [
  { "key": "화재", "label": "🔥 화재", "color": "#dc2626" },
  { "key": "정전", "label": "⚡ 정전", "color": "#78350f" },
  { "key": "누수", "label": "💧 누수", "color": "#1d4ed8" },
  { "key": "태풍/홍수", "label": "🌀 태풍/홍수", "color": "#1e40af" },
  { "key": "폭설", "label": "❄️ 폭설", "color": "#0369a1" },
  { "key": "지진", "label": "🌍 지진", "color": "#92400e" },
  { "key": "가스누출", "label": "💨 가스누출", "color": "#4d7c0f" },
  { "key": "승강기", "label": "🛗 승강기갇힘", "color": "#6d28d9" },
  { "key": "테러", "label": "🚨 테러·침입", "color": "#be123c" }
];
