const fs=require('fs'),p=require('path');const R=__dirname;
const body=fs.readFileSync(p.join(R,'src/body.html'),'utf8').replace('/*__DSP__*/',()=>fs.readFileSync(p.join(R,'src/dsp.js'),'utf8'));
fs.mkdirSync(p.join(R,'dist'),{recursive:true});
fs.writeFileSync(p.join(R,'dist','artifact.html'),body);
const head=`<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0E6E66"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg"><link rel="apple-touch-icon" href="icon.svg"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style></head><body>`;
fs.writeFileSync(p.join(R,'index.html'),head+body+'</body></html>');
fs.writeFileSync(p.join(R,'icon.svg'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0E6E66"/><g stroke="#fff" stroke-width="44" stroke-linecap="round"><path d="M96 216v80M176 136v240M256 76v360M336 156v200M416 216v80"/></g></svg>`);
fs.writeFileSync(p.join(R,'manifest.webmanifest'),JSON.stringify({name:'Kontho Voice Studio',short_name:'Kontho',lang:'bn',start_url:'./',display:'standalone',background_color:'#F3F5F4',theme_color:'#0E6E66',icons:[{src:'icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}],share_target:undefined},null,1));
fs.writeFileSync(p.join(R,'sw.js'),`// Network first so updates show at once; cache keeps the app working offline.
const C='kontho-v2';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','icon.svg','manifest.webmanifest'])));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||(u.origin!==location.origin&&!u.host.includes('cdnjs')&&!u.host.includes('fonts.')))return;
e.respondWith(fetch(e.request).then(res=>{const cp=res.clone();caches.open(C).then(c=>c.put(e.request,cp));return res}).catch(()=>caches.match(e.request)))});
`);
console.log('built',body.length);
