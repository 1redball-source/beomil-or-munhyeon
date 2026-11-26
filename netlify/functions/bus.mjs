// 부산 BIMS(부산광역시 버스정보시스템) 공공데이터 API로 남구5의 범일역·문현역(집 방향) 도착 정보를 가져온다.
// 환경변수: BIMS_KEY (공공데이터포털 '일반 인증키(Decoding)')
const BASE = 'https://apis.data.go.kr/6260000/BusanBIMS';
const LINE = process.env.LINE_NO || '남구5';
let cache = null; // { lineid, beomil, munhyeon, at }

const items = xml => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
  .map(m => Object.fromEntries([...m[1].matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(x => [x[1], x[2].trim()])));

async function call(op, params) {
  const key = process.env.BIMS_KEY;
  if (!key) throw new Error('BIMS_KEY 환경변수가 없어요');
  const qs = new URLSearchParams({ serviceKey: key, ...params });
  const res = await fetch(`${BASE}/${op}?${qs}`);
  const text = await res.text();
  if (!res.ok || /<returnAuthMsg>|SERVICE_KEY/.test(text)) throw new Error(`${op} 호출 실패: ${text.slice(0, 200)}`);
  return items(text);
}

async function stops() {
  if (cache && Date.now() - cache.at < 6 * 3600e3) return cache;
  const lines = await call('busInfo', { lineno: LINE });
  const line = lines.find(l => l.lineno === LINE) || lines[0];
  if (!line) throw new Error(`${LINE} 노선을 찾지 못했어요`);
  const route = await call('busInfoByRouteId', { lineid: line.lineid });
  const idx = s => +s.bstopidx || 0;
  const id = s => s.nodeid || s.bstopid;
  const beomil = route.find(s => s.bstopnm.includes('범일역'));
  if (!beomil) throw new Error('노선에서 범일역 정류장을 찾지 못했어요');
  // 범일역(회차) 다음에 나오는 문현역 = 집 방향
  const munhyeon = route.filter(s => s.bstopnm.includes('문현역') && idx(s) > idx(beomil)).sort((a, b) => idx(a) - idx(b))[0];
  if (!munhyeon) throw new Error('범일역 이후의 문현역 정류장을 찾지 못했어요');
  cache = { lineid: line.lineid, beomil: { id: id(beomil), name: beomil.bstopnm, idx: idx(beomil) }, munhyeon: { id: id(munhyeon), name: munhyeon.bstopnm, idx: idx(munhyeon) }, at: Date.now() };
  return cache;
}

async function arrivals(stop) {
  const list = await call('stopArrByBstopid', { bstopid: stop.id });
  const mine = list.filter(x => x.lineno === LINE);
  const out = [];
  for (const x of mine) for (const k of ['1', '2']) {
    const m = parseFloat(x['min' + k]);
    if (isFinite(m)) out.push({ min: m, stops: +x['station' + k] || null });
  }
  return out.sort((a, b) => a.min - b.min);
}

export default async req => {
  const debug = new URL(req.url).searchParams.has('debug');
  try {
    const s = await stops();
    const [b, m] = await Promise.all([arrivals(s.beomil), arrivals(s.munhyeon)]);
    const body = { line: LINE, at: Date.now(), beomil: { ...s.beomil, buses: b }, munhyeon: { ...s.munhyeon, buses: m } };
    if (debug) body.debug = { raw: await call('stopArrByBstopid', { bstopid: s.beomil.id }) };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
};

export const config = { path: '/api/bus' };
