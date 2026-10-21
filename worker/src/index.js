const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const safeInt=v=>Number.isFinite(Number(v))?Math.trunc(Number(v)):0;
const day=ts=>new Date(ts*1000).toISOString().slice(0,10);
const sd=s=>{s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?`${h}h${m?String(m).padStart(2,'0')+'m':''}`:`${m}m`};
const dur=s=>{s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?`${h}h ${String(m).padStart(2,'0')}m`:`${m} min`};
const compact=s=>{s=Math.max(0,Math.round(s));if(s<3600)return`${Math.round(s/60)}m`;const h=Math.floor(s/3600);return`${h}h`};
const bar=(v,max,n=18)=>{const x=v>0&&max?Math.max(1,Math.round(clamp(v/max,0,1)*n)):0;return'='.repeat(x)+'-'.repeat(n-x)};
const title=p=>String(p||'Unknown book').split('/').pop().replace(/\.(epub|pdf|txt|fb2|mobi)$/i,'');
const GOAL=2700;
const pad=(s,n)=>String(s).length>=n?String(s).slice(0,n):String(s)+' '.repeat(n-String(s).length);
const pair=(a,b)=>`${pad(a,16)} • ${b}`;
const monthName=i=>['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i];

export default{async fetch(req,env){const u=new URL(req.url);if(u.pathname==='/health')return json({ok:true});if(u.pathname==='/api/session'&&req.method==='POST')return ingest(req,env);if(u.pathname==='/api/catalog'&&req.method==='GET')return catalog(req,u,env);return json({error:'not found'},404)}};

async function ingest(req,env){
  const key=(req.headers.get('X-Device-Key')||'').trim();
  if(key.length<16)return json({error:'invalid device key'},401);
  let x;try{x=await req.json()}catch{return json({error:'invalid json'},400)}
  const eid=String(x.event_id||'').slice(0,128),book=String(x.book||'').slice(0,512),doc=String(x.document||'').slice(0,64),st=safeInt(x.start_time),et=safeInt(x.end_time),sec=clamp(safeInt(x.duration_seconds),0,86400),sp=clamp(safeInt(x.start_progress_bp),0,10000),ep=clamp(safeInt(x.end_progress_bp),0,10000),ets=safeInt(x.event_ts);
  if(!eid||!book||st<=0||et<=st||sec<10)return json({error:'invalid session'},400);
  await env.DB.prepare(`INSERT OR IGNORE INTO sessions(device_key,event_id,book,document,start_time,end_time,duration_seconds,start_progress_bp,end_progress_bp,event_ts,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(key,eid,book,doc,st,et,sec,sp,ep,ets,Math.floor(Date.now()/1000)).run();
  return json({ok:true});
}

async function catalog(req,u,env){
  const key=(req.headers.get('X-Device-Key')||u.searchParams.get('key')||'').trim();
  if(key.length<16)return json({items:[{id:'setup',title:'Setup required',subtitle:'Check config.json',description:'A valid device key is required.'}]});
  const page=Math.max(1,safeInt(u.searchParams.get('page'))||1);
  return page===1?overview(key,env):insights(key,env);
}

async function overview(key,env){
  const now=Math.floor(Date.now()/1000),today=day(now),days=[];
  for(let i=6;i>=0;i--)days.push(day(now-i*86400));
  const start7=Math.floor(Date.parse(days[0]+'T00:00:00Z')/1000);
  const recent=await env.DB.prepare(`SELECT book,document,end_time,duration_seconds,start_progress_bp,end_progress_bp FROM sessions WHERE device_key=? AND end_time>=? ORDER BY end_time DESC`).bind(key,start7).all();
  const latest=await env.DB.prepare(`SELECT book,document,end_time,duration_seconds,start_progress_bp,end_progress_bp FROM sessions WHERE device_key=? ORDER BY end_time DESC LIMIT 1000`).bind(key).all();
  const rows=recent.results||[],byDay=Object.fromEntries(days.map(d=>[d,0]));let todaySec=0,todayCount=0,week=0;
  for(const s of rows){const sec=+s.duration_seconds||0,d=day(+s.end_time);if(byDay[d]!==undefined){byDay[d]+=sec;week+=sec}if(d===today){todaySec+=sec;todayCount++}}
  const activeDays=(await env.DB.prepare(`SELECT DISTINCT date(end_time,'unixepoch') d FROM sessions WHERE device_key=? ORDER BY d`).bind(key).all()).results||[];
  const aset=new Set(activeDays.map(x=>x.d));let streak=0;for(let i=0;i<36600;i++){const d=day(now-i*86400);if(aset.has(d))streak++;else if(i===0)continue;else break}
  const books=new Map();for(const s of latest.results||[]){const id=s.document||s.book;if(!books.has(id))books.set(id,{book:s.book,pct:(+s.end_progress_bp||0)/100,last:+s.end_time||0})}
  const top=[...books.values()].sort((a,b)=>b.last-a.last).slice(0,3),scale=Math.max(GOAL,...Object.values(byDay),1),goalPct=Math.round(clamp(todaySec/GOAL*100,0,100));
  const items=[];
  items.push({id:'today',title:`TODAY ${sd(todaySec)}    GOAL ${sd(todaySec)}/45m ${goalPct}%`,subtitle:`${todayCount} session${todayCount===1?'':'s'}       STREAK ${streak}d`,description:'Today, daily goal and current reading streak.'});
  days.forEach((d,i)=>{const label=new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'});items.push({id:'d-'+d,title:`${label}  ${bar(byDay[d],scale,18)}  ${sd(byDay[d])}`,subtitle:i===0?`LAST 7 DAYS  ${dur(week)}`:' ',description:`${label}: ${dur(byDay[d])} active reading time.`})});
  for(let i=0;i<3;i++){const b=top[i];if(b)items.push({id:'b-'+b.last,title:`${i===0?'RECENT  ':''}${title(b.book)}`,subtitle:`${bar(b.pct,100,22)}  ${Math.round(b.pct)}%`,description:`${Math.round(b.pct)}% complete.`});else items.push({id:'book-empty-'+i,title:i===0?'RECENT BOOKS':' ',subtitle:' ',description:'No additional recent book yet.'})}
  items.push({id:'insights',title:'READING INSIGHTS',subtitle:'Year, month and lifetime activity  >',description:'Open the next page for reading insights.'});
  items.push({id:'more',title:' ',subtitle:' ',description:'Pagination lookahead.'});
  return json({items});
}

async function insights(key,env){
  const now=new Date(),year=now.getUTCFullYear(),prev=year-1,month=now.getUTCMonth(),monthPrefix=`${year}-${String(month+1).padStart(2,'0')}`;
  const daily=(await env.DB.prepare(`SELECT date(end_time,'unixepoch') d, SUM(duration_seconds) sec FROM sessions WHERE device_key=? GROUP BY d ORDER BY d`).bind(key).all()).results||[];
  const monthly=(await env.DB.prepare(`SELECT strftime('%Y-%m',end_time,'unixepoch') m, SUM(duration_seconds) sec FROM sessions WHERE device_key=? AND strftime('%Y',end_time,'unixepoch') IN (?,?) GROUP BY m ORDER BY m`).bind(key,String(year),String(prev)).all()).results||[];
  const life=(await env.DB.prepare(`SELECT COALESCE(SUM(duration_seconds),0) sec, COUNT(DISTINCT date(end_time,'unixepoch')) active_days FROM sessions WHERE device_key=?`).bind(key).first())||{sec:0,active_days:0};
  const finished=(await env.DB.prepare(`SELECT COUNT(*) n FROM (SELECT COALESCE(NULLIF(document,''),book) k, MAX(end_progress_bp) p FROM sessions WHERE device_key=? GROUP BY k HAVING p>=9900)`).bind(key).first())||{n:0};
  const monthRows=daily.filter(x=>String(x.d).startsWith(monthPrefix)),monthSec=monthRows.reduce((a,x)=>a+(+x.sec||0),0),avgDay=monthRows.length?monthSec/monthRows.length:0;
  let best={d:'-',sec:0};for(const x of monthRows)if((+x.sec||0)>best.sec)best={d:x.d,sec:+x.sec||0};
  const active=daily.map(x=>x.d),aset=new Set(active);let streak=0,longest=0,run=0,previous='';for(const d of active){if(previous&&(new Date(d)-new Date(previous))/86400000===1)run++;else run=1;longest=Math.max(longest,run);previous=d}const nowSec=Math.floor(Date.now()/1000);for(let i=0;i<36600;i++){const d=day(nowSec-i*86400);if(aset.has(d))streak++;else if(i===0)continue;else break}
  const cur=Array(12).fill(0),old=Array(12).fill(0);for(const x of monthly){const [y,m]=x.m.split('-').map(Number);if(y===year)cur[m-1]=+x.sec||0;else if(y===prev)old[m-1]=+x.sec||0}
  const yearSec=cur.reduce((a,b)=>a+b,0),prevSec=old.reduce((a,b)=>a+b,0),maxSec=Math.max(...cur,1),bestMonth=cur.indexOf(Math.max(...cur));
  const levels=5,chart=[];for(let row=levels;row>=1;row--){let line='';for(let i=0;i<12;i++){const h=cur[i]>0?Math.max(1,Math.round(cur[i]/maxSec*levels)):0;const label=h===row?compact(cur[i]).slice(0,3):'';line+=pad(label,3)}chart.push(line.trimEnd()||' ')}
  const labels='J  F  M  A  M  J  J  A  S  O  N  D';
  const bestDate=best.d==='-'?'-':new Date(best.d+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
  const items=[];
  items.push({id:'month',title:`THIS MONTH  ${dur(monthSec)}`,subtitle:pair(`${monthRows.length} active days`,`avg ${sd(avgDay)}/day`),description:'Current calendar month.'});
  items.push({id:'best',title:pair(`Best day ${bestDate}`,dur(best.sec)),subtitle:pair(`STREAK ${streak}d`,`LONGEST ${longest}d`),description:'Best day is the highest reading-time date in the current month.'});
  items.push({id:'year-head',title:`${year} ACTIVITY`,subtitle:' ',description:'Monthly reading activity for the current calendar year.'});
  chart.forEach((line,i)=>items.push({id:'chart-'+i,title:line,subtitle:' ',description:'Annual activity chart.'}));
  items.push({id:'months',title:labels,subtitle:' ',description:'January through December.'});
  items.push({id:'most',title:pair(`MOST ACTIVE ${monthName(bestMonth)}`,dur(cur[bestMonth])),subtitle:pair(`${year} ${dur(yearSec)}`,`${prev} ${dur(prevSec)}`),description:'Most active month and current/previous year totals.'});
  items.push({id:'life',title:`LIFETIME  ${dur(+life.sec||0)}`,subtitle:pair(`${life.active_days||0} active days`,`${finished.n||0} books read`),description:'Lifetime reading totals. Books read currently uses completed reading progress until direct SD /read-folder enumeration is available to the plugin.'});
  return json({items});
}
