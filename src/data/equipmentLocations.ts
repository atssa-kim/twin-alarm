/**
 * 재난별 비상장비 보관위치 — disa_app(https://atssa-kim.github.io/disa_app/) 실제 데이터 이관
 * 원본: disa_app 내 EQUIP_DATA 상수 (PDF 2026.06.25 기준, 2026-07-05 확인 시점)
 *
 * 주의: disa_app은 이 기본값 위에 localStorage로 사용자가 직접 수정한 내용을 덮어써서 보여줍니다.
 * 즉, disa_app 화면에 표시되는 "현재" 값과 이 파일이 다를 수 있습니다 — disa_app에서
 * "✏️ 비상장비 수정"으로 값이 바뀌면 이 파일도 수동으로 다시 동기화해야 합니다(자동 연동 아님).
 *
 * twin-alarm 재난 key로 매핑: fire→화재, elec→정전, leak→누수, flood→태풍/홍수, snow→폭설,
 * quake→지진, gas→가스누출, elev→승강기, terror→테러 (disa_app의 intru(침입)는 twin-alarm에 없어 제외)
 */

export interface EquipmentItem {
  name: string;
  spec: string;
  qty: string;
  loc: string;
}

export interface EquipmentCategory {
  cat: string;
  items: EquipmentItem[];
}

export const EQUIPMENT_LOCATIONS: Record<string, EquipmentCategory[]> = {
  '화재': [
    { cat: '🔥 화재 — 안전장비 (소방)', items: [
      { name: '방독면', spec: 'DOBU CM-2', qty: '35', loc: '서관B3 운영센터(7) · 동관B3 운영센터(19) · 중앙B1 종합상황실(6) · 동관B2 보안사무실(3)' },
      { name: '공기호흡기 SCBA 01~04', spec: '양압식 60분용 SCA-790W', qty: '4', loc: '중앙B1 종합상황실(4)  ※용기재검사 2026.07' },
      { name: '공기호흡기 SCBA 05~06', spec: '양압식 30분용 SCA420S', qty: '2', loc: '동관B2 보안사무실(2)  ※용기재검사 2030.01' },
      { name: '공기호흡기 SCBA 07~08', spec: '양압식 30분용 SCA420S', qty: '2', loc: '서관B3 운영센터(2)  ※용기재검사 2030.01' },
      { name: '공기호흡기 SCBA 09~10', spec: '양압식 30분용 SCA420S', qty: '2', loc: '정화조실 입구(2)  ※용기재검사 2030.08' },
      { name: '방열방수복 SET', spec: '방열복·방열모·방열장갑', qty: '4', loc: '중앙B1 종합상황실(3) · 동관B2 보안사무실(1)' },
      { name: '특수방화복', spec: '방열복', qty: '1', loc: '동관B2 보안사무실(1)' },
      { name: '스마트에어백 C3', spec: '사이즈free / 배터리120분', qty: '4', loc: '건축·기계·전기·소방 파트' },
      { name: '송기마스크', spec: 'HM-5000', qty: '4', loc: '동·서관 U.G(2인용) · 정화조 MCC실(2인용) · 상황실(4인용)' },
      { name: '구조용 삼각대', spec: 'NTTP300', qty: '2', loc: '동관 U.G · 서관 U.G' },
      { name: '방열포', spec: 'KC인증', qty: '4', loc: '중앙B1 종합상황실' },
      { name: '들것', spec: '-', qty: '2', loc: '중앙B1 종합상황실 · 동관B2 보안사무실' },
      { name: '안전로프', spec: '타이거로프', qty: '1', loc: '중앙B1 종합상황실' },
    ] },
    { cat: '🔥 화재 — 소화 자재', items: [
      { name: '스프링클러헤드', spec: '플러쉬형', qty: '4', loc: '중앙B1 종합상황실' },
      { name: '스프링클러헤드', spec: '폐쇄상향형', qty: '5', loc: '중앙B1 종합상황실' },
      { name: '감지기', spec: '아날로그식', qty: '5', loc: '중앙B1 종합상황실' },
      { name: '감지기', spec: '정온식', qty: '3', loc: '중앙B1 종합상황실' },
      { name: '무반동관창', spec: '65mm', qty: '3', loc: '중앙B1 종합상황실' },
      { name: '와이어절단기', spec: '대', qty: '1', loc: '중앙B1 종합상황실' },
      { name: '도끼', spec: '대', qty: '2', loc: '중앙B1 종합상황실' },
      { name: '간이소화용구', spec: '가정용·차량용', qty: '3', loc: '중앙B1 종합상황실' },
    ] },
    { cat: '🔥 화재 — 구급·개인장비', items: [
      { name: '휴대용 산소소호흡기', spec: '클린O2 / 내구3년(2026.09)', qty: '17', loc: '중앙B1 종합상황실' },
      { name: '구급상자', spec: '박스', qty: '5', loc: '중앙B1 종합상황실(1) · 동·서관B3 운영센터(2) · 동·서관 라운지(2)' },
      { name: 'IPAD 제세동기', spec: '-', qty: '1', loc: '중앙B1 종합상황실' },
      { name: '방열모', spec: '-', qty: '3', loc: '중앙B1 종합상황실' },
      { name: '방열장갑', spec: '-', qty: '3', loc: '중앙B1 종합상황실' },
      { name: '방열신발', spec: '-', qty: '3', loc: '중앙B1 종합상황실' },
      { name: '안전벨트', spec: '전체식', qty: '5', loc: '중앙B1 종합상황실' },
      { name: '안전벨트', spec: '상체식', qty: '4', loc: '중앙B1 종합상황실' },
      { name: '야광조끼(형광색)', spec: '개', qty: '10', loc: '중앙B1 종합상황실' },
      { name: '안전봉', spec: '0.53M', qty: '5', loc: '중앙B1 종합상황실' },
      { name: '경광등', spec: '260MM', qty: '18', loc: '서관B3 운영센터(9) · 동관B3 운영센터(9)' },
      { name: '랜턴', spec: '-', qty: '1', loc: '중앙B1 종합상황실' },
      { name: '메가폰', spec: 'MAX 25W RATED 18W', qty: '2', loc: '중앙B1 종합상황실' },
      { name: '해머(동망치)', spec: '3kg', qty: '1', loc: '중앙B1 종합상황실' },
      { name: '파이프랜치', spec: '18인치', qty: '1', loc: '중앙B1 종합상황실' },
      { name: '파이프랜치', spec: '24인치', qty: '1', loc: '중앙B1 종합상황실' },
      { name: '비상조명배터리', spec: '6V', qty: '3', loc: '중앙B1 종합상황실' },
      { name: 'BOX형 전기릴', spec: '30M / 5.4kg', qty: '2', loc: '중앙B1 종합상황실' },
    ] },
  ],

  '정전': [
    { cat: '⚡ 정전 — 절연·보호 장비', items: [
      { name: '특고압 절연장갑', spec: '안전장갑 C종 / 내구20년', qty: '6', loc: '동관B3 변전실 · 중앙B3 변전실 · 서관B3 변전실 · 동관35층 변전실 · 서관35층 변전실' },
      { name: '특고압 절연장화', spec: 'DV750V / AC7,000V / 내구20년', qty: '6', loc: '동관B3 변전실 · 중앙B3 변전실 · 서관B3 변전실 · 동관35층 변전실 · 서관35층 변전실' },
      { name: '특고압 절연복', spec: '26.5kV / 내구20년', qty: '6', loc: '동관B3 변전실(1) · 중앙B3 변전실(1) · 서관B3 변전실(1) · 동관35층 변전실(1) · 서관35층 변전실(1)' },
      { name: '고무절연 블랭킷', spec: 'Class 3, 26.5kV / 내구10년', qty: '4', loc: '동관B1 수전실 · 동관B3 변전실 · 중앙B3 변전실 · 서관B3 변전실' },
    ] },
    { cat: '⚡ 정전 — 검전·경보 기기', items: [
      { name: '활선경보기', spec: 'TK-808 / 내구20년', qty: '6', loc: '동관B1 수전실(1) · 동관B3 변전실(1) · 중앙B3 변전실(1) · 서관B3 변전실(1) · 동관35층 변전실(1) · 서관35층 변전실(1)' },
      { name: '활선경보기 (손목형)', spec: 'AC 80V~6,600V / 내구10년', qty: '4', loc: '동관B1 수전실 · 동관B3 변전실 · 중앙B3 변전실 · 서관B3 변전실' },
      { name: '고압 검전기 (음향발광식)', spec: 'TK-8030 / AC80V~30KV / 내구15년', qty: '5', loc: '동관B1 수전실(1) · 중앙B3 변전실(1) · 서관B3 변전실(1) · 동관35층 변전실(1) · 서관35층 변전실(1)' },
      { name: '고압 검전기', spec: 'AC/DC 7000V / 내구10년', qty: '3', loc: '동관B3 변전실 · 중앙B3 변전실 · 서관B3 변전실' },
      { name: '특고압 검전기 (음향발광식)', spec: 'AC3KV~44KV / 내구20년', qty: '2', loc: '동관B3 변전실 · 서관B3 변전실' },
      { name: '특고압 검전기 (접촉식)', spec: 'HST-30 AC3KV~34.5KV / 내구20년', qty: '1', loc: '동관B1 수전실' },
      { name: '절연 방전봉', spec: '30KV / 내구30년', qty: '4', loc: '동관B1 수전실 · 동관B3 변전실 · 중앙B3 변전실 · 서관B3 변전실' },
    ] },
    { cat: '⚡ 정전 — 접지·조작 공구', items: [
      { name: 'DS봉 2M', spec: '24KV / 3단', qty: '4', loc: '동관B1 수전실(1) · 동관B3 변전실(1) · 중앙B3 변전실(1) · 서관B3 변전실(1)' },
      { name: '단락 접지공구', spec: '22.9KV · 7KV', qty: '6', loc: '동관B1 수전실(1) · 동관B3 변전실(1) · 중앙B3 변전실(1) · 서관B3 변전실(1) · 동관35층 변전실(1) · 서관35층 변전실(1)' },
      { name: 'COS봉 2M', spec: '30KV', qty: '2', loc: '동관35층 변전실(1) · 서관35층 변전실(1)' },
      { name: '이동식 릴선', spec: '30m / 누전차단기 부착', qty: '6', loc: '동관B1 수전실(1) · 동관B3 변전실(1) · 중앙B3 변전실(1) · 서관B3 변전실(1) · 동관35층 변전실(1) · 서관35층 변전실(1)' },
    ] },
    { cat: '⚡ 정전 — 퓨즈·자재', items: [
      { name: '퓨즈링크', spec: 'LFL-6P-1; 3.6/7.2kV; 1A', qty: '15', loc: '동관B3 변전실(3) · 중앙B3 변전실(3) · 서관B3 변전실(3) · 동관35층 변전실(3) · 서관35층 변전실(3)' },
      { name: '25.8kV 파워퓨즈', spec: '24KV / 1A / 내구10년', qty: '6', loc: '동관B1 수전실(6)' },
      { name: '다이젯 퓨즈', spec: '500V / IEC269', qty: '12', loc: '동관B1 수전실(3) · 동관B3 변전실(3) · 중앙B3 변전실(3) · 서관B3 변전실(3)' },
      { name: 'MOF 직결 케이블', spec: 'FR-CNCO-W 1C 326SQ', qty: '1', loc: '동관B1 수전실' },
      { name: 'MOF 몰드형', spec: 'DMI-203N / 내구20년', qty: '1', loc: '동관B1 수전실' },
    ] },
    { cat: '⚡ 정전 — 측정 기기', items: [
      { name: '절연저항 측정기', spec: '1000V, 2000MΩ / 내구20년', qty: '1', loc: '동관B3 트윈타워운영센터' },
      { name: '클램프메터 (누설전류)', spec: 'HIOKI CM4002 / 내구20년', qty: '1', loc: '동관B3 트윈타워운영센터' },
      { name: '특고압 검전기 (접촉식)', spec: 'HST-30 / 내구20년', qty: '1', loc: '동관B1 수전실' },
      { name: '진공차단기 (VCB)', spec: '24KV / 630A / 25KA / 내구20년', qty: '1', loc: '동관B1 수전실' },
      { name: '계기용변압기 (PT)', spec: '13200/110V / 내구20년', qty: '1', loc: '동관B1 수전실' },
      { name: 'ALTS 배터리', spec: 'EM-24100 / 내구6년', qty: '1', loc: '동관B1 수전실' },
    ] },
  ],

  '누수': [
    { cat: '💧 누수 — 수거·이송', items: [
      { name: '물통 (대)', spec: '대', qty: '10', loc: '동관20층 물탱크실(1) · 서관20층 물탱크실(1) · E35F 공조실(1) · E26F EMR(1) · E17F EMR(1) · E06F EMR(1) · W35F 공조실(1) · W26F EMR(1) · W17F EMR(1) · W06F EMR(1)' },
      { name: '물통 (소)', spec: '소', qty: '16', loc: '동관20층 물탱크실(1) · 서관20층 물탱크실(1) · E35F 공조실(2) · E26F EMR(2) · E17F EMR(2) · E06F EMR(2) · W35F 공조실(1) · W26F EMR(2) · W17F EMR(1) · W06F EMR(2)' },
      { name: '소형 흡진/흡수기', spec: '50ℓ', qty: '10', loc: '동관20층 물탱크실(1) · 서관20층 물탱크실(1) · E35F 공조실(1) · E26F EMR(1) · E17F EMR(1) · E06F EMR(1) · W35F 공조실(1) · W26F EMR(1) · W17F EMR(1) · W06F EMR(1)' },
      { name: '고무밀대', spec: '-', qty: '20', loc: '각 층 물탱크실·공조실·EMR 각 2EA' },
      { name: '천막호스', spec: '외경 24cm', qty: '8', loc: 'E35F·W35F 공조실(2) · 동·서관 6F/17F/26F EMR(6)' },
    ] },
    { cat: '💧 누수 — 보양·작업', items: [
      { name: '보양비닐', spec: '-', qty: '10', loc: '각 층 물탱크실·공조실·EMR' },
      { name: '비닐카바링', spec: '대·소', qty: '28', loc: '각 층 물탱크실·공조실·EMR (대 17 / 소 11)' },
      { name: '사다리', spec: '2M', qty: '2', loc: '동관20층 물탱크실(1) · 서관20층 물탱크실(1)' },
      { name: '우마', spec: '1M', qty: '2', loc: '동관20층 물탱크실(1) · 서관20층 물탱크실(1)' },
    ] },
  ],

  '태풍/홍수': [
    { cat: '🌀 풍수해 — 배수 펌프', items: [
      { name: '엔진 양수기', spec: '80φ캄록 / 60ton', qty: '2', loc: '냉동기실' },
      { name: '상치형 양수펌프', spec: 'PU-950U / 50φ 캄록·호스', qty: '2', loc: '냉동기실' },
      { name: '수중형 양수펌프', spec: 'IP-217-F / 220V 20φ 6ton', qty: '3', loc: '냉동기실' },
      { name: '수중형 양수펌프', spec: 'IP-415 / 220V 40φ 10ton', qty: '2', loc: '냉동기실' },
      { name: '수중형 양수펌프', spec: 'IP-835-HC / 220V 50φ 15ton', qty: '1', loc: '냉동기실' },
      { name: '수중형 양수펌프', spec: 'IPV-835 / 220V 40φ 19ton', qty: '4', loc: '냉동기실' },
      { name: '수중형 양수펌프', spec: 'PDV-750MA / 220V 40φ 10ton', qty: '1', loc: '냉동기실' },
      { name: '수중형 양수펌프', spec: 'PDV-M,MA / 220V 50φ 15ton', qty: '2', loc: '냉동기실' },
      { name: '수중형 양수펌프', spec: 'IP-415N / 220V 50φ', qty: '1', loc: '냉동기실' },
      { name: '수중형 양수펌프', spec: 'PDV-750M / 220V 50φ', qty: '1', loc: '냉동기실' },
      { name: '(비상) 엔진 발전기', spec: '220V / 2.4Kw / DC12V', qty: '2', loc: '냉동기실' },
    ] },
    { cat: '🌀 풍수해 — 호스·호스릴', items: [
      { name: '천막 호스', spec: '외경 24cm', qty: '2', loc: '냉동기실' },
      { name: '천막 호스', spec: '외경 3"', qty: '9', loc: '냉동기실' },
      { name: '천막 호스', spec: '외경 2"', qty: '4', loc: '냉동기실' },
      { name: '소방 호스', spec: '외경 10cm', qty: '3', loc: '냉동기실' },
      { name: '소방 호스', spec: '외경 6cm', qty: '5', loc: '냉동기실' },
      { name: '주름관 호스', spec: '외경 5.5cm (50A)', qty: '8', loc: '냉동기실' },
      { name: '주름관 호스', spec: '외경 4cm', qty: '2', loc: '냉동기실' },
      { name: '주름관 호스', spec: '외경 8.5cm (75mm)', qty: '2', loc: '냉동기실' },
      { name: '주름관 호스', spec: '외경 3cm (25mm)', qty: '2', loc: '냉동기실' },
      { name: '전선릴', spec: '-', qty: '1', loc: '냉동기실' },
    ] },
    { cat: '🌀 풍수해 — 침수 차단', items: [
      { name: '침수예방 차수판', spec: '-', qty: '5', loc: '서관B1 선큰(4) · 서관1층 선큰 입구(1)' },
      { name: '모래주머니', spec: '7KG', qty: '521', loc: '동·서관 주차장 입구 모래함 · 서관 샤워식당 선큰 모래함' },
    ] },
    { cat: '🌀 풍수해 — 보양·작업', items: [
      { name: '보양비닐', spec: '-', qty: '4', loc: '냉동기실' },
      { name: '비닐카바링', spec: '대·소', qty: '3', loc: '냉동기실' },
      { name: '사다리', spec: '2M', qty: '1', loc: '냉동기실' },
      { name: '우마', spec: '1M', qty: '1', loc: '냉동기실' },
      { name: '고무밀대', spec: '-', qty: '11', loc: '냉동기실' },
      { name: '보안경', spec: '-', qty: '1', loc: '냉동기실' },
    ] },
  ],

  '폭설': [
    { cat: '❄️ 폭설 — 제설 기계', items: [
      { name: '인도용 제설기', spec: '이텍산업', qty: '2', loc: '서관B3 주차장 세차장 앞' },
      { name: '제설용 브러쉬', spec: 'LGM-SG110', qty: '4', loc: '서관B3 주차장 세차장 앞' },
      { name: '송풍기', spec: 'EBZ8500', qty: '2', loc: '서관B2F #16 FAN ROOM' },
      { name: '송풍기', spec: 'EBZ8550', qty: '2', loc: '서관B2F #16 FAN ROOM' },
    ] },
    { cat: '❄️ 폭설 — 제설 도구·자재', items: [
      { name: '넉가래', spec: '프라스틱', qty: '24', loc: '서관B2F #16 FAN ROOM' },
      { name: '삽', spec: '-', qty: '20', loc: '서관B2F #16 FAN ROOM' },
      { name: '눈삽 (소)', spec: '플라스틱', qty: '25', loc: '서관B2F #16 FAN ROOM' },
      { name: '눈삽 (대)', spec: '플라스틱', qty: '23', loc: '서관B2F #16 FAN ROOM' },
      { name: '염화칼슘', spec: '20KG', qty: '37포', loc: '서관B2F #16 FAN ROOM' },
    ] },
    { cat: '❄️ 폭설 — 작업자 보호', items: [
      { name: '장화', spec: '고무', qty: '5켤레', loc: '서관B2F #16 FAN ROOM' },
      { name: '우의', spec: '제비표우의-S', qty: '12', loc: '서관B3F 미화창고' },
    ] },
  ],

  '지진': [
    { cat: '🌍 지진·붕괴 — 전동 공구', items: [
      { name: '해머드릴', spec: 'DCH417X2 (60V)', qty: '1', loc: '동관B3 건축영선실' },
      { name: '디월트 무선그라인더', spec: 'DCG405N (18V)', qty: '1', loc: '동관B3 건축영선실' },
      { name: '체인블록', spec: '1톤 / 3M', qty: '1', loc: '동관B3 건축영선실' },
    ] },
    { cat: '🌍 지진·붕괴 — 수공구', items: [
      { name: '빠루(바)', spec: '450mm (18")', qty: '1', loc: '동관B3 건축영선실' },
      { name: '망치', spec: '16oz (450g)', qty: '2', loc: '동관B3 건축영선실' },
      { name: '삽', spec: '각삽 290×240mm', qty: '2', loc: '동관B3 건축영선실' },
      { name: '곡갱이', spec: '2.0kg × 900mm', qty: '1', loc: '동관B3 건축영선실' },
      { name: '렌치세트', spec: '8~24mm', qty: '2세트', loc: '동관B3 건축영선실' },
      { name: '니퍼', spec: '7인치 (175mm)', qty: '2', loc: '동관B3 건축영선실' },
      { name: '절단가위', spec: '10~12인치 (250~300mm)', qty: '5', loc: '동관B3 건축영선실' },
      { name: '드라이버세트', spec: '6pcs~10pcs', qty: '20세트', loc: '동관B3 건축영선실' },
    ] },
    { cat: '🌍 지진·붕괴 — 보호·자재', items: [
      { name: '슈퍼그립노컷5 장갑', spec: '235MM / 너비 95MM', qty: '5', loc: '동관B3 건축영선실' },
      { name: '3M 방진마스크', spec: '안면부여과식 2급', qty: '1box', loc: '동관B3 건축영선실' },
      { name: '3M 보안경', spec: 'ANSI Z87.1', qty: '3', loc: '동관B3 건축영선실' },
      { name: 'PP (마대)', spec: '550×800mm', qty: '30', loc: '동관B3 건축영선실' },
    ] },
  ],

  '가스누출': [
    { cat: '💨 가스누출 — 호흡 보호', items: [
      { name: '공기호흡기 SCBA 01~04', spec: '양압식 60분용 SCA-790W', qty: '4', loc: '중앙B1 종합상황실(4)  ※용기재검사 2026.07' },
      { name: '공기호흡기 SCBA 05~06', spec: '양압식 30분용 SCA420S', qty: '2', loc: '동관B2 보안사무실(2)  ※용기재검사 2030.01' },
      { name: '공기호흡기 SCBA 07~08', spec: '양압식 30분용 SCA420S', qty: '2', loc: '서관B3 운영센터(2)  ※용기재검사 2030.01' },
      { name: '공기호흡기 SCBA 09~10', spec: '양압식 30분용 SCA420S', qty: '2', loc: '정화조실 입구(2)  ※용기재검사 2030.08' },
    ] },
    { cat: '💨 가스누출 — 탐지·차단', items: [
      { name: '가스누출 검출기', spec: '-', qty: '1', loc: '중앙B1 종합상황실' },
      { name: '파이프랜치', spec: '18인치', qty: '1', loc: '중앙B1 종합상황실' },
      { name: '파이프랜치', spec: '24인치', qty: '1', loc: '중앙B1 종합상황실' },
    ] },
    { cat: '💨 가스누출 — 구급·대피', items: [
      { name: '들것', spec: '-', qty: '2', loc: '중앙B1 종합상황실 · 동관B2 보안사무실' },
      { name: '구급상자', spec: '박스', qty: '5', loc: '중앙B1 종합상황실(1) · 동·서관B3 운영센터(2) · 동·서관 라운지(2)' },
      { name: '안전봉', spec: '0.53M', qty: '5', loc: '중앙B1 종합상황실' },
      { name: '경광등', spec: '260MM', qty: '18', loc: '서관B3 운영센터(9) · 동관B3 운영센터(9)' },
      { name: '랜턴', spec: '-', qty: '1', loc: '중앙B1 종합상황실' },
    ] },
  ],

  '승강기': [
    { cat: '🛗 승강기갇힘 — 구조 도구', items: [
      { name: '승장 도어키', spec: 'PS·화물·ES 엘리베이터용', qty: '2', loc: '종합상황실(2)' },
      { name: '승장 도어키', spec: 'LZ·MZ·HZ·VIP 엘리베이터용', qty: '1', loc: '종합상황실(1)' },
    ] },
  ],

  '테러': [
    { cat: '🚨 테러 — 검색·차단', items: [
      { name: '문형 금속탐지기', spec: '-', qty: '3', loc: '동관1층 검색구역(1) · 서관1층 검색구역(2)' },
      { name: '휴대용 금속탐지기', spec: '-', qty: '8', loc: '동관1층 검색구역(1) · 동관27·28·29층 EV홀(3) · 서관1층 검색구역(3) · 동관B3 운영센터(1)' },
      { name: 'X-ray 검색기', spec: '-', qty: '3', loc: '동관1층 검색구역(1) · 서관1층 검색구역(2)' },
      { name: '차단봉', spec: '-', qty: '152', loc: '동관1층 및 외곽(81) · 서관1층 및 외곽(71)' },
      { name: '바리케이드', spec: '-', qty: '4', loc: '동관 주차장(2) · 동관 선큰 입구(1) · 지하주차장 입구 초소(1)' },
    ] },
    { cat: '🚨 테러 — 보안 장비', items: [
      { name: '무전기', spec: '-', qty: '45', loc: '동·서관 각 근무지 · 동관B2 보안사무실' },
      { name: '경광봉', spec: '-', qty: '24', loc: '동관B2 보안사무실(17) · 외곽 각 초소(4) · 서관1층 보안데스크(1)' },
      { name: '삼단봉', spec: '-', qty: '3', loc: '동관1층 안내데스크(2) · 동관B2 보안사무실(1)' },
      { name: '방독면', spec: '-', qty: '3', loc: '동관B2 보안사무실' },
      { name: '안전조끼', spec: '-', qty: '7', loc: '동관B2 보안사무실' },
      { name: '물리 마스터키', spec: '-', qty: '2', loc: '동관B2 보안사무실 · 서관1층 보안데스크' },
      { name: '카드 마스터키', spec: '-', qty: '2', loc: '동관1층 안내데스크 · 서관1층 보안데스크' },
      { name: '랜턴', spec: '-', qty: '4', loc: '동관B2 보안사무실(1) · 서관1층 보안데스크(3)' },
    ] },
    { cat: '🚨 테러 — 구급·구조', items: [
      { name: 'AED', spec: '-', qty: '2', loc: '동관1층 안내데스크 앞 · 서관1층 안내데스크 앞' },
      { name: '산소캔', spec: '-', qty: '20', loc: '동관1층 안내데스크 앞(10) · 서관1층 안내데스크 앞(10)' },
      { name: '구조손수건', spec: '-', qty: '60', loc: '동관1층 안내데스크 앞(30) · 서관1층 안내데스크 앞(30)' },
      { name: '구급함', spec: '-', qty: '2', loc: '동관1층 안내데스크 앞 · 서관1층 안내데스크 앞' },
      { name: '수동식 공기호흡기', spec: '-', qty: '2', loc: '동관1층 안내데스크 앞 · 서관1층 안내데스크 앞' },
      { name: '들것', spec: '-', qty: '1', loc: '동관B2 보안사무실' },
    ] },
  ],
};

// 임무 텍스트의 장비명과 disa_app 목록의 표기가 다른 경우의 별칭
const EQUIPMENT_ALIASES: Record<string, string> = {
  '가스누설감지기': '가스누출 검출기',
  '가스누출감지기': '가스누출 검출기',
};

// 재난 안에서 이름이 일치(별칭 포함)하거나 부분일치하는 장비를 찾음
export function findEquipmentLocation(disaster: string, equipmentName: string): EquipmentItem | null {
  const categories = EQUIPMENT_LOCATIONS[disaster];
  if (!categories) return null;
  const norm = (s: string) => s.replace(/[\s·()]/g, '');
  const target = norm(EQUIPMENT_ALIASES[equipmentName] ?? equipmentName);
  for (const cat of categories) {
    for (const item of cat.items) {
      const itemNorm = norm(item.name);
      if (itemNorm === target || itemNorm.includes(target) || target.includes(itemNorm)) return item;
    }
  }
  return null;
}
