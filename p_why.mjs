import {chromium} from 'playwright';
import {createServer} from 'http';
import {readFileSync,existsSync} from 'fs';
import {extname,join} from 'path';
import {ATHLETE} from '/home/user/Workout-/tests/lib/harness.mjs';
const ROOT=process.argv[2];
const MT={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.mp4':'video/mp4','.webmanifest':'application/manifest+json'};
const srv=createServer((q,s)=>{let p=join(ROOT,decodeURIComponent(q.url.split('?')[0]));if(p.endsWith('/'))p+='index.html';
 if(!existsSync(p)){s.writeHead(404);s.end();return;}
 s.writeHead(200,{'content-type':MT[extname(p)]||'application/octet-stream'});s.end(readFileSync(p));});
await new Promise(r=>srv.listen(0,r));
const b=await chromium.launch();const page=await (await b.newContext()).newPage();
await page.goto(`http://localhost:${srv.address().port}/index.html`);
await page.waitForFunction(()=>typeof STATE!=='undefined'&&document.querySelector('.view.active'),null,{timeout:20000});
await page.waitForTimeout(1200);
console.log(ROOT, JSON.stringify(await page.evaluate((base)=>{
  eval(base)();
  const iso=d=>{const x=new Date(Date.now()-d*86400000);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
  const D=STATE.nutrition.days;
  for(let w=0;w<4;w++)for(let d=0;d<2;d++)D[iso(w*7+d)]={opened:true,ruckVal:5,ruckUnit:'dist',ruckLvl:'brisk',ruckLb:25};
  STATE.prep={date:iso(-70),planFrom:iso(35),path:'operator',results:{}};
  STATE.footLog=[]; normalizeState();
  const wk=()=>{const w=ruckLadderWeek();return {km:w.km,lb:w.lb,climbing:w.climbing,hold:w.footHold,wkNo:w.wk};};
  const scan=[];
  for(let back=0;back<20;back++){
    STATE.prep.planFrom=iso(7+back*7);
    STATE.footLog=[];
    const free=wk();
    STATE.footLog=[{date:iso(0),state:'hotspot'}];
    const held=wk();
    scan.push({back,free:free.climbing,freeKm:free.km,heldKm:held.km,heldClimb:held.climbing,wkNo:free.wkNo});
  }
  return {anyKmHeld:scan.some(x=>x.heldKm<x.freeKm), weeks:scan.map(x=>x.back+' wk'+' '+x.free+' '+x.freeKm+'->'+x.heldKm+' '+x.heldClimb)};
}, ATHLETE)));
await b.close();srv.close();
