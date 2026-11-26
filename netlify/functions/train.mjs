// 부산교통공사 열차시각표(GW) API로 퇴근 경로의 역별 열차 시각을 가져온다.
// 환경변수: BIMS_KEY (같은 공공데이터포털 인증키. 이 API도 활용신청 필요)
const URL_ = 'https://apis.data.go.kr/B551542/trainTime/getTrainTime';
// 역외부코드. 방향은 종착역 코드가 이 값보다 작은 쪽(다대포·장산 방면)
const STATIONS = {
  bujeon:   { scode: '120', toward: 'down' }, // 1호선 부전 → 서면·범일 방면
  seomyeon1:{ scode: '119', toward: 'down' }, // 1호선 서면
  beomil:   { scode: '117', toward: 'down' }, // 1호선 범일
  seomyeon2:{ scode: '219', toward: 'down' }, // 2호선 서면 → 전포·문현 방면
  munhyeon: { scode: '216', toward: 'down' }  // 2호선 문현
};

const kstNow = () => new Date(Date.now() + 9 * 3600e3); // UTC 메서드로 읽으면 한국 시각
const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + String(Math.floor(m % 60)).padStart(2, '0');
const toMin = s => { const d = String(s).replace(/\D/g, '').padStart(4, '0').slice(0, 4); return +d.slice(0, 2) * 60 + +d.slice(2, 4); };

async function fetchStation(code, day, stime, etime) {
  const qs = new URLSearchParams({ serviceKey: process.env.BIMS_KEY, act: 'json', scode: code, day, stime, etime, pageNo: '1', numOfRows: '200' });
  const res = await fetch(`${URL_}?${qs}`);
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`시각표 응답 오류(${code}): ${text.slice(0, 160)}`); }
  const rc = j?.response?.header?.resultCode ?? j?.header?.resultCode;
  const body = j?.response?.body ?? j?.body;
  if (rc && rc !== '00' && rc !== '0' && rc !== '03') throw new Error(`시각표 오류(${code}): ${JSON.stringify(j).slice(0, 160)}`);
  let items = body?.items?.item ?? [];
  if (!Array.isArray(items)) items = [items];
  return items;
}

export default async req => {
  const debug = new URL(req.url).searchParams.has('debug');
  try {
    if (!process.env.BIMS_KEY) throw new Error('BIMS_KEY 환경변수가 없어요');
    const now = kstNow();
    const wd = now.getUTCDay();
    const day = wd === 0 ? '3' : wd === 6 ? '2' : '1'; // 공휴일은 반영 안 됨
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const stime = hhmm(nowMin), etime = hhmm(Math.min(nowMin + 120, 23 * 60 + 59));
    const out = { day, stime, etime, stations: {} };
    const raw = {};
    await Promise.all(Object.entries(STATIONS).map(async ([k, s]) => {
      const items = await fetchStation(s.scode, day, stime, etime);
      raw[k] = items.slice(0, 6);
      const here = +s.scode;
      out.stations[k] = items
        .filter(x => { const e = parseInt(x.endcode, 10); return isFinite(e) ? e < here : true; })
        .map(x => ({ t: toMin(x.arrtime), no: String(x.trainno || ''), end: x.endcode, updown: x.updown }))
        .filter(x => x.t >= nowMin - 1)
        .sort((a, b) => a.t - b.t);
    }));
    if (debug) out.raw = raw;
    return Response.json(out, { headers: { 'cache-control': 'public, max-age=60' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
};

export const config = { path: '/api/train' };
