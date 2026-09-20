/**
 * 대본에 들어갈 숫자를 모델에서 뽑는다.
 *
 *   npx tsx model/report.ts
 *
 * 대본이든 화면이든 숫자를 손으로 적지 않는다. 가정을 바꾸면 여기 출력이
 * 바뀌고, 대본과 화면이 같이 따라와야 한다.
 */
import {
  ASSUMPTIONS,
  COHORT_1990_M,
  CURRENT,
  PRE_REFORM,
  calculate,
  ratioAtDiscount,
} from './pension';

const eok = (manwon: number) => {
  const e = Math.floor(manwon / 10000);
  const m = Math.round(manwon % 10000);
  return e > 0 ? `${e}억 ${m.toLocaleString('ko-KR')}만원` : `${m.toLocaleString('ko-KR')}만원`;
};

const show = (title: string, r: ReturnType<typeof calculate>) => {
  console.log(`\n── ${title}`);
  console.log(`  가입        ${r.cohort.entryAge}세부터 ${r.cohort.years}년`);
  console.log(`  수급 개시   ${r.pensionAge}세 (${r.cohort.birthYear + r.pensionAge}년)`);
  console.log(`  평생 납입   ${eok(r.totalPaid)}`);
  console.log(`  평생 수령   ${eok(r.totalReceived)}`);
  console.log(`  수익비      ${r.ratio.toFixed(2)}배`);
  console.log(`  손익분기    ${r.breakEvenAge ?? '-'}세`);
};

console.log('가정:', JSON.stringify(ASSUMPTIONS, null, 2));

const now = calculate(COHORT_1990_M, CURRENT);
show('1990년생 남성 · 현행(개혁 후)', now);
show('1990년생 남성 · 개혁 전', calculate(COHORT_1990_M, PRE_REFORM));

// 본인부담만 셌을 때 — 사업장이 절반을 내므로 수익비는 두 배가 된다.
// 이 영상의 핵심 반전 중 하나.
console.log(`\n── 본인부담(절반)만 계산하면`);
console.log(`  평생 납입   ${eok(now.totalPaid / 2)}`);
console.log(`  수익비      ${(now.ratio * 2).toFixed(2)}배`);

// 할인율 민감도 — 영상 3장의 핵심 차트
console.log(`\n── 할인율을 흔들면 (1990년생 남성, 현행)`);
for (const { d, ratio } of ratioAtDiscount(
  COHORT_1990_M,
  [0, 0.005, 0.008, 0.01, 0.015, 0.02, 0.03],
)) {
  console.log(`  실질 ${(d * 100).toFixed(1).padStart(4)}%   ${ratio.toFixed(2)}배`);
}

// 소득별 수익비 — A값 재분배가 만드는 격차. 4장 재료.
console.log(`\n── 소득별 수익비 (1990년생 남성, 현행)`);
for (const inc of [150, 250, 320, 450, 600]) {
  const r = calculate({ ...COHORT_1990_M, monthlyIncomeManwon: inc }, CURRENT);
  console.log(
    `  월 ${String(inc).padStart(3)}만원   ${r.ratio.toFixed(2)}배   (손익분기 ${r.breakEvenAge ?? '-'}세)`,
  );
}

// 공표치(1.62배)를 재현하는 할인율 역산
let best = { d: 0, gap: Infinity };
for (let d = 0; d <= 0.03; d += 0.0001) {
  const gap = Math.abs(calculate(COHORT_1990_M, CURRENT, d).ratio - 1.62);
  if (gap < best.gap) best = { d, gap };
}
console.log(
  `\n── 공표 1.62배를 재현하는 실질 할인율: ${(best.d * 100).toFixed(2)}%`,
);

// 수급 시작 시점과 기금 소진 시점의 간격
const startYear = COHORT_1990_M.birthYear + now.pensionAge;
console.log(`\n── 타이밍`);
console.log(`  수급 시작   ${startYear}년`);
console.log(`  기금 소진   2065년  → 수급 ${2065 - startYear}년차`);
