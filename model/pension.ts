/**
 * 국민연금 세대별 수익비 계산 모델.
 *
 * 영상에 쓰는 모든 숫자는 여기서 나온다. 화면에 하드코딩 금지 —
 * 가정을 바꾸면 영상이 통째로 따라 움직여야 한다.
 *
 * 가정은 전부 ASSUMPTIONS에 모아둔다. 영상 안에서 이걸 그대로 노출하고
 * 설명란에 링크한다. "틀렸다" 공격에 대한 방어이자, 사실상 유일한 방어다.
 */

export const ASSUMPTIONS = {
  /** 연금 계산에 쓰는 할인율 = 물가상승률 (실질가치 기준) */
  inflation: 0.02,
  /** 명목 임금상승률 */
  wageGrowth: 0.031,
  /** A값(전체 가입자 평균소득) 상승률 */
  aValueGrowth: 0.031,
  /**
   * 실질 할인율. 수익비를 좌우하는 단 하나의 손잡이다.
   *
   * 낸 돈은 20~50대에, 받는 돈은 65세 이후에 발생한다. 두 흐름 사이에
   * 30년 넘는 시차가 있어서, 할인율을 조금만 올려도 수익비가 크게 떨어진다.
   *
   * 0.55%는 국민연금연구원 공표 수익비(1990년생 남성 1.62배)를 재현하도록
   * 역산한 값이다. report.ts가 매번 역산해 검증한다.
   *
   * 이 숫자를 '정답'으로 쓰지 말 것 — 영상 3장의 주제가 바로 이 가정의
   * 민감도다. ratioAtDiscount()로 흔들어 보여준다.
   */
  discountRate: 0.0055,
  /**
   * A값 — 연금 수급 직전 3년간 전체 가입자 평균소득월액 (만원).
   *
   * 국민연금 급여식의 절반이 본인 소득(B)이 아니라 이 A값으로 채워진다.
   * 저소득자일수록 수익비가 높아지는 재분배가 여기서 나온다.
   */
  aValueManwon: 310,
  /**
   * 기준소득월액 상한 (2026.7~2027.6, 만원). 이보다 많이 벌어도 보험료와
   * 급여는 이 금액까지만 계산된다.
   *
   * 상한은 매년 A값 변동률(≈ 임금상승률)만큼 오른다. 모델의 개인 소득도
   * 같은 임금상승률로 오르므로, 가입 첫해에 상한 아래였던 사람은 끝까지
   * 안 걸리고 위였던 사람은 끝까지 상한에 붙어 있다. 그래서 첫해 소득에만
   * min()을 걸면 된다. 1·2편 주인공(월 320만원)은 해당 없음.
   */
  incomeCapManwon: 659,
  source: '국민연금법 / 통계청 장래인구추계·생명표 / 국회예산정책처 추계',
  retrieved: '2026-09',
} as const;

/** 제도 파라미터. 연도별로 바뀌므로 구간으로 둔다. */
export type Regime = {
  /** 보험료율 (소득 대비) */
  contributionRate: (year: number) => number;
  /** 소득대체율 (40년 가입 기준). 연도와 무관하게 고정이라 인자를 받지 않는다. */
  replacementRate: () => number;
  /** 수급 개시 연령 */
  pensionAge: (birthYear: number) => number;
};

/** 현행 제도 (2025 개혁 반영: 보험료율 9%→13% 단계 인상, 소득대체율 43%) */
export const CURRENT: Regime = {
  contributionRate: (year) => {
    if (year < 2026) return 0.09;
    // 2026년부터 매년 0.5%p씩 13%까지
    return Math.min(0.13, 0.09 + (year - 2025) * 0.005);
  },
  replacementRate: () => 0.43,
  pensionAge: (birthYear) => {
    if (birthYear <= 1952) return 60;
    if (birthYear <= 1956) return 61;
    if (birthYear <= 1960) return 62;
    if (birthYear <= 1964) return 63;
    if (birthYear <= 1968) return 64;
    return 65;
  },
};

/** 개혁 전 구제도 (비교용): 보험료율 9% 고정, 소득대체율 40% */
export const PRE_REFORM: Regime = {
  contributionRate: () => 0.09,
  replacementRate: () => 0.4,
  pensionAge: CURRENT.pensionAge,
};

export type Cohort = {
  birthYear: number;
  sex: 'M' | 'F';
  /** 가입 시작 나이 */
  entryAge: number;
  /** 가입 기간(년) */
  years: number;
  /** 가입 기간 평균 월소득 (만원, 가입 첫해 기준 실질) */
  monthlyIncomeManwon: number;
  /** 수급 개시 시점 기대여명(년). 통계청 생명표 기준. */
  lifeExpectancyAtPension: number;
};

export type Result = {
  cohort: Cohort;
  /** 평생 납입 총액 (만원, 실질) */
  totalPaid: number;
  /** 평생 수령 총액 (만원, 실질) */
  totalReceived: number;
  /** 수익비 = 받는 돈 / 낸 돈 */
  ratio: number;
  /** 손익분기 나이 — 받은 누계가 낸 누계를 넘어서는 시점 */
  breakEvenAge: number | null;
  pensionAge: number;
  /** 연도별 누계 (차트용) */
  timeline: { age: number; paidCum: number; receivedCum: number }[];
};

/**
 * 수익비 계산.
 *
 * 납입은 실제 본인부담 기준이 아니라 사업장 부담을 포함한 전액(9~13%)으로
 * 잡는다. 이게 논쟁 지점이라 영상에서 명시적으로 다룬다 —
 * 본인부담만 세면 수익비가 2배로 뛴다.
 */
export function calculate(
  cohort: Cohort,
  regime: Regime = CURRENT,
  discountRate: number = ASSUMPTIONS.discountRate,
): Result {
  const { birthYear, entryAge, years, monthlyIncomeManwon } = cohort;
  const pensionAge = regime.pensionAge(birthYear);
  const r = ASSUMPTIONS.inflation;

  /** 가입 시점으로 당긴 현재가치. 두 흐름을 같은 시점에 세워야 비교가 된다. */
  const pv = (age: number) => Math.pow(1 + discountRate, -(age - entryAge));

  const timeline: Result['timeline'] = [];
  let paidCum = 0;
  let receivedCum = 0;
  let cappedSum = 0;

  // 1) 납입 단계
  for (let i = 0; i < years; i++) {
    const age = entryAge + i;
    const year = birthYear + age;
    const rate = regime.contributionRate(year);
    // 실질 임금상승 반영 (명목 임금상승률 - 물가). 상한을 넘는 소득은 안 셈한다.
    const realIncome =
      Math.min(ASSUMPTIONS.incomeCapManwon, monthlyIncomeManwon) *
      Math.pow(1 + (ASSUMPTIONS.wageGrowth - r), i);
    cappedSum += realIncome;
    paidCum += realIncome * 12 * rate * pv(age);
    timeline.push({ age, paidCum, receivedCum });
  }

  // 2) 납입 종료 ~ 수급 개시 공백
  for (let age = entryAge + years; age < pensionAge; age++) {
    timeline.push({ age, paidCum, receivedCum });
  }

  // 3) 수급 단계 — 국민연금 급여식 그대로
  //
  //   기본연금액(연) = 상수 × (A + B) × (1 + 0.05 × n/12)
  //
  //   A = 전체 가입자 평균소득월액, B = 본인 가입기간 평균소득월액,
  //   n = 20년 초과 가입월수. 상수 1.2가 40년 가입 시 소득대체율 40%에 대응한다.
  //
  // (A + B)에서 A가 절반을 차지하는 게 핵심이다. 소득이 낮을수록 B가 작아
  // 급여 대비 본인 기여가 줄고, 그래서 수익비가 올라간다. 이 재분배를 빼고
  // 계산하면 저소득층 수익비가 실제보다 크게 과소평가된다.
  //
  // B는 상한을 적용한 연도별 소득의 평균이다. 상한에 안 걸리는 사람은
  // 예전 등비급수 공식과 같은 값이 나온다 (연속 근사 대신 연 단위 합이라
  // 아주 미세하게 다를 수 있다 — report.ts가 1.62배를 다시 확인한다).
  const B = cappedSum / years;
  const k = 1.2 * (regime.replacementRate() / 0.4);
  const n = Math.max(0, years * 12 - 240);
  const monthlyPension =
    (k * (ASSUMPTIONS.aValueManwon + B) * (1 + (0.05 * n) / 12)) / 12;

  let breakEvenAge: number | null = null;
  const lastAge = Math.round(pensionAge + cohort.lifeExpectancyAtPension);
  for (let age = pensionAge; age <= lastAge; age++) {
    receivedCum += monthlyPension * 12 * pv(age);
    if (breakEvenAge === null && receivedCum >= paidCum) breakEvenAge = age;
    timeline.push({ age, paidCum, receivedCum });
  }

  return {
    cohort,
    totalPaid: paidCum,
    totalReceived: receivedCum,
    ratio: receivedCum / paidCum,
    breakEvenAge,
    pensionAge,
    timeline,
  };
}

/**
 * 영상 1편에 쓰는 두 주인공.
 *
 * 1928년생 여성의 72배는 제도 초기 저부담·고급여 + 긴 수명이 겹친 결과다.
 * 1990년생 남성 1.62배와의 대비가 이 영상의 전부.
 */
export const COHORT_1928_F: Cohort = {
  birthYear: 1928,
  sex: 'F',
  entryAge: 60, // 1988년 제도 시행 당시 이미 60세
  years: 5, // 특례노령연금: 최소가입 5년
  monthlyIncomeManwon: 60,
  lifeExpectancyAtPension: 25,
};

export const COHORT_1990_M: Cohort = {
  birthYear: 1990,
  sex: 'M',
  entryAge: 27,
  years: 33,
  monthlyIncomeManwon: 320,
  lifeExpectancyAtPension: 21.5,
};

/**
 * 할인율을 흔들었을 때 수익비가 어떻게 움직이는지.
 *
 * 영상 3장의 핵심 차트. 같은 사람, 같은 제도인데 가정 하나로
 * 숫자가 두 배 가까이 벌어진다는 걸 보여준다.
 */
export const ratioAtDiscount = (
  cohort: Cohort,
  rates: number[],
  regime: Regime = CURRENT,
) => rates.map((d) => ({ d, ratio: calculate(cohort, regime, d).ratio }));

/**
 * 영상에 쓰는 확정 수치. 모델 출력이 아니라 공개 추계값이라 상수로 박는다.
 *
 * ⚠ 단위가 두 종류다. 섞으면 안 된다.
 *
 *   ratio1928F / ratio1990M  → 국민연금연구원. **단일 출생연도 + 성별**.
 *   benefitDelta             → 한국재정학회.   **10년 단위 코호트**.
 *
 * 그래서 1~4장은 "1990년생", 5장만 "1990년대생"으로 쓴다. 5장 진입 대사에서
 * 자료가 바뀐다는 걸 밝히고 화면에 출처 배지를 띄울 것 — 안 밝히면
 * 시청자는 오타로 읽는다.
 *
 * 5장에서 수익비 절대값(재정학회의 2000년대생 1.65 등)은 화면에 올리지 말 것.
 * 1990년생 1.62와 숫자가 비슷해 반드시 혼동된다. 변화율(%)만 쓴다.
 */
export const HEADLINE = {
  /** 출처: 국민연금연구원 · 단일 출생연도 기준 */
  ratio1928F: 72,
  ratio1990M: 1.62,
  /** 출처: 한국재정학회 · 10년 단위. 개혁 전후 1인당 순혜택 변화율(%) */
  benefitDelta: [
    { label: '1960년대생', value: +0.4 },
    { label: '1980년대생', value: -7.1 },
    { label: '1990년대생', value: -14.6 },
    { label: '2000년대생', value: -22.0 },
  ],
  /** 기금 소진 전망 연도 (국회예산정책처, 2026) */
  depletionYear: 2065,
  deficitYear: 2048,
} as const;
