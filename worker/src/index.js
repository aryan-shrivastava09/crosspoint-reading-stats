const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const safeInt=(v)=>Number.isFinite(Number(v))?Math.trunc(Number(v)):0;
const bar=(seconds,max)=>{const n=max?Math.round(clamp(seconds/max,0,1)*10):0;return '#'.repeat(n)+'-'.repeat(10-n)};
const dur=(s)=>{s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?`${h}h ${String(m).padStart(2,'0')}m`:`${m} min`};
const utcDay=(ts)=>new Date(ts*1000).toISOString().slice(0,10);

export default {async fetch(req,env){
  const u=new URL(req.url);
  if(u.pathname==='/health') return json({ok:true});
  if(u.pathname==='/api/session'&&req.method==='POST') return ingest(req,env);
  if(u.pathname==='/api/catalog'&&req.method==='GET') return catalog(req,u,env);
  return json({error:'not found'},404);
}};

async function ingest(req,env){
  const key=(req.headers.get('X-Device-Key')||'').trim();
  if(key.length<16) return json({error:'invalid device key'},401);
  let x; try{x=await req.json()}catch{return json({error:'invalid json'},400)}
  const eventId=String(x.event_id||'').slice(0,128), book=String(x.book||'').slice(0,512), doc=String(x.document||'').slice(0,64);
  const st=safeInt(x.start_time), et=safeInt(x.end_time), sec=clamp(safeInt(x.duration_seconds),0,86400), sp=clamp(safeInt(x.start_progress_bp),0,10000), ep=clamp(safeInt(x.end_progress_bp),0,10000), ets=safeInt(x.event_ts);
  if(!eventId||!book||st<=0||et<=st||sec<10) return json({error:'invalid session'},400);
  await env.DB.prepare(`INSERT OR IGNORE INTO sessions(device_key,event_id,book,document,start_time,end_time,duration_seconds,start_progress_bp,end_progress_bp,event_ts,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(key,eventId,book,doc,st,et,sec,sp,ep,ets,Math.floor(Date.now()/1000)).run();
  return json({ok:true});
}

async function catalog(req,u,env){
  const key=(req.headers.get('X-Device-Key')||u.searchParams.get('key')||'').trim(); if(key.length<16)return json({items:[{id:'setup',title:'Setup required',subtitle:'Check config.json'}]});
  const now=Math.floor(Date.now()/1000), today=utcDay(now), days=[]; for(let i=6;i>=0;i--){days.push(new Date((now-i*86400)*1000).toISOString().slice(0,10))}
  const r=await env.DB.prepare(`SELECT book,document,end_time,duration_seconds,end_progress_bp FROM sessions WHERE device_key=? ORDER BY end_time DESC LIMIT 5000`).bind(key).all();
  const rows=r.results||[], byDay=Object.fromEntries(days.map(d=>[d,0])); let total=0,todaySec=0,week=0,todayCount=0; const books=new Map();
  for(const s of rows){const sec=Number(s.duration_seconds)||0,d=utcDay(Number(s.end_time));total+=sec;if(d===today){todaySec+=sec;todayCount++}if(byDay[d]!==undefined){byDay[d]+=sec;week+=sec}const id=s.document||s.book;let b=books.get(id);if(!b)b={book:s.book,sec:0,pct:0,last:0,count:0};b.sec+=sec;b.count++;if(Number(s.end_time)>b.last){b.last=Number(s.end_time);b.pct=(Number(s.end_progress_bp)||0)/100}books.set(id,b)}
  const todayAvg=todayCount?todaySec/todayCount:0, activeDays=new Set(rows.map(s=>utcDay(Number(s.end_time))));let streak=0;for(let i=0;i<3660;i++){const d=new Date((now-i*86400)*1000).toISOString().slice(0,10);if(activeDays.has(d))streak++;else if(i===0)continue;else break}
  const max=Math.max(1,...Object.values(byDay)),items=[];
  items.push({id:'today',title:`TODAY  ${dur(todaySec)}`,subtitle:`${todayCount} sessions | avg ${dur(todayAvg)}`,description:'Reading time recorded today.'});
  items.push({id:'week',title:`LAST 7 DAYS  ${dur(week)}`,subtitle:`${streak} day streak | lifetime ${dur(total)}`,description:'Active reading time over the last seven days.'});
  for(const d of days){const label=new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'});items.push({id:'d-'+d,title:`${label}  ${bar(byDay[d],max)}`,subtitle:dur(byDay[d]),description:`${label}: ${dur(byDay[d])} active reading time.`})}
  const top=[...books.values()].sort((a,b)=>b.last-a.last).slice(0,3);if(top.length)items.push({id:'books',title:'RECENT BOOKS',subtitle:'Progress | active time',description:'Your most recently read books.'});for(const b of top){items.push({id:'b-'+b.last,title:`${String(b.book).split('/').pop()}  ${Math.round(b.pct)}%`,subtitle:`${dur(b.sec)} | ${b.count} sessions`,description:`${dur(b.sec)} active reading across ${b.count} sessions.`})}
  const page=Math.max(1,safeInt(u.searchParams.get('page'))||1),limit=clamp(safeInt(u.searchParams.get('limit'))||13,1,16),start=(page-1)*(limit-1);return json({items:items.slice(start,start+limit)});
}
