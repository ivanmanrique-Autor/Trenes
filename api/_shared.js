import { get, put } from '@vercel/blob';
import { Unzip, UnzipInflate, strFromU8 } from 'fflate';

export const A = 'https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip';
export const tripsFeed = 'https://gtfsrt.renfe.com/trip_updates.json';
export const vehiclesFeed = 'https://gtfsrt.renfe.com/vehicle_positions.json';
export const stationFallback = [
  { id: '78706', name: 'Cerdanyola del Vallès', lat: 41.4925608, lon: 2.14752164 },
  { id: '71801', name: 'Barcelona-Sants', lat: 41.3798632, lon: 2.14101688 }
];

export const json = (res, data, status = 200) => res.status(status).setHeader('Cache-Control', 'no-store').json(data);
export const todayMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
export const datePath = () => todayMadrid().replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');

function csv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted && c === '"' && text[i + 1] === '"') { field += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift()?.map(x => x.trim()) || [];
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()])));
}

async function readZipEntries(names, onChunk = {}) {
  const response = await fetch(A, { signal: AbortSignal.timeout(45000), cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`GTFS de Renfe no disponible (${response.status}).`);
  const pending = new Map();
  const unzip = new Unzip(file => {
    const name = file.name.split('/').at(-1);
    if (!names.has(name)) return;
    let chunks = [];
    pending.set(name, new Promise((resolve, reject) => {
      file.ondata = (error, data, final) => {
        if (error) return reject(error);
        if (onChunk[name]) onChunk[name](data, final);
        else chunks.push(data);
        if (final) resolve(onChunk[name] ? null : chunks);
      };
    }));
    file.start();
  });
  unzip.register(UnzipInflate);
  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    unzip.push(value || new Uint8Array(), done);
    if (done) break;
  }
  await Promise.all(pending.values());
  for (const name of names) if (!pending.has(name)) throw new Error(`GTFS incompleto: falta ${name}`);
  return new Map(await Promise.all([...pending].map(async ([name, promise]) => [name, await promise])));
}

function serviceRunsToday(calendar, exceptions, ymd) {
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const [y,m,d] = [Number(ymd.slice(0,4)),Number(ymd.slice(4,6)),Number(ymd.slice(6,8))];
  const weekday = days[new Date(Date.UTC(y,m-1,d)).getUTCDay()];
  const active = new Set(calendar.filter(x => ymd >= x.start_date && ymd <= x.end_date && x[weekday] === '1').map(x => x.service_id));
  for (const e of exceptions) if (e.date === ymd) { if (e.exception_type === '1') active.add(e.service_id); else if (e.exception_type === '2') active.delete(e.service_id); }
  return active;
}

export async function loadTodaySchedule() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Falta conectar Vercel Blob: Storage → Create → Blob y enlazarlo al proyecto.');
  const key = `r4-daily/${datePath()}.json`;
  try {
    const blob = await get(key, { access: 'private', useCache: false });
    if (blob?.statusCode === 200) return { schedule: await new Response(blob.stream).json(), cache: 'hit' };
  } catch { /* Primer acceso del día: descargar GTFS. */ }
  const smallNames = new Set(['routes.txt','trips.txt','stops.txt','calendar.txt','calendar_dates.txt']);
  const small = await readZipEntries(smallNames);
  const asText = name => { const chunks=small.get(name), size=chunks.reduce((n,c)=>n+c.length,0), bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;} return csv(strFromU8(bytes)); };
  const routes = new Set(asText('routes.txt').filter(r => r.route_short_name === 'R4').map(r => r.route_id));
  const trips = asText('trips.txt').filter(t => routes.has(t.route_id));
  const wanted = new Set(trips.map(t => t.trip_id));
  const stops = new Map(asText('stops.txt').map(s => [s.stop_id, { id:s.stop_id, name:s.stop_name, lat:Number(s.stop_lat), lon:Number(s.stop_lon) }]));
  const byTrip = new Map();
  let stopBuffer=''; let stopHeaders=[];
  await readZipEntries(new Set(['stop_times.txt']), {'stop_times.txt':(data,final)=>{
    stopBuffer += new TextDecoder().decode(data,{stream:!final});
    const lines=stopBuffer.split(/\r?\n/); stopBuffer=final?'':lines.pop()||'';
    for(const line of lines){ if(!line)continue; const values=line.split(','); if(!stopHeaders.length){stopHeaders=values;continue;} const row=Object.fromEntries(stopHeaders.map((key,i)=>[key,values[i]||''])); if(wanted.has(row.trip_id)){ if(!byTrip.has(row.trip_id))byTrip.set(row.trip_id,[]); byTrip.get(row.trip_id).push([row.stop_id,stops.get(row.stop_id)?.name||row.stop_id,row.arrival_time,row.departure_time,Number(row.stop_sequence)]); }}
  }});
  const calendar = asText('calendar.txt');
  let exceptions=[]; try { exceptions=asText('calendar_dates.txt'); } catch {}
  const serviceSet = serviceRunsToday(calendar, exceptions, todayMadrid());
  const resultTrips=[];
  for (const t of trips) {
    if (!serviceSet.has(t.service_id)) continue;
    const all=(byTrip.get(t.trip_id)||[]).sort((a,b)=>a[4]-b[4]);
    const ci=all.findIndex(s=>s[0]==='78706'), si=all.findIndex(s=>s[0]==='71801');
    if (ci<0 || si<0) continue;
    resultTrips.push({ tripId:t.trip_id, serviceId:t.service_id, headsign:t.trip_headsign||'', stops:all });
  }
  const used = new Set(resultTrips.flatMap(t=>t.stops.map(s=>s[0])));
  const schedule={date:datePath(),fetchedAt:new Date().toISOString(),stations:[...used].map(id=>stops.get(id)).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,'ca')),trips:resultTrips};
  await put(key, JSON.stringify(schedule), { access:'private', addRandomSuffix:false, allowOverwrite:true, contentType:'application/json', cacheControlMaxAge:60 });
  return { schedule, cache:'miss' };
}

export function madridEpoch(ymd, time) {
  const [y,m,d]=[+ymd.slice(0,4),+ymd.slice(4,6),+ymd.slice(6,8)];
  const [h,mi,s]=time.split(':').map(Number); const base=Date.UTC(y,m-1,d+Math.floor(h/24),h%24,mi,s||0); let guess=base;
  for(let i=0;i<2;i++){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).map(x=>[x.type,x.value]));guess+=base-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)}
  return Math.floor(guess/1000);
}
