(function(){
"use strict";

/* ==================== YTM BRIDGE ==================== */
const bridgeEl = document.createElement('script');
bridgeEl.src = chrome.runtime.getURL('bridge.js');
bridgeEl.onload = () => bridgeEl.remove();
(document.head || document.documentElement).appendChild(bridgeEl);

let bridgeSpec = null, bridgeWave = null;
let bridgeTime = 0, bridgeDur = 0, bridgePaused = true;

window.addEventListener('message', e => {
  if (e.source !== window || !e.data || !e.data.__paaudio) return;
  if (e.data.type === 'audio') {
    bridgeSpec = e.data.spec;
    bridgeWave = e.data.wave;
    bridgeTime = e.data.time;
    bridgeDur = e.data.dur;
    bridgePaused = e.data.paused;
  }
});

function ytmCmd(action, value){
  window.postMessage({ __paaudio: true, type: 'cmd', action, value }, '*');
}

function readYTMInfo(){
  const bar = document.querySelector('ytmusic-player-bar');
  if (!bar) return null;
  const t = bar.querySelector('.title');
  const b = bar.querySelector('.byline');
  const im = bar.querySelector('img.image');
  let artist = '', album = '';
  if (b) {
    const ls = b.querySelectorAll('a');
    if (ls[0]) artist = ls[0].textContent.trim();
    if (ls[1]) album = ls[1].textContent.trim();
    if (!artist) artist = b.textContent.trim();
  }
  return {
    title: t ? t.textContent.trim() : '',
    artist: artist || 'UNKNOWN',
    album: album || 'YOUTUBE MUSIC',
    art: im ? im.src : ''
  };
}

/* ==================== YTM QUEUE ==================== */
let ytmQueueCache = [];
let ytmQueueSelected = 0;
let ytmQueueScroll = 0;

function readYTMQueue(){
  // YTMのキューアイテムを複数のセレクタで検索
  let items = document.querySelectorAll('ytmusic-player-queue-item');
  
  // 見つからない場合は別のセレクタを試す
  if (items.length === 0) {
    items = document.querySelectorAll(
      'ytmusic-player-queue-item, ' +
      '.ytmusic-player-queue-item, ' +
      'ytmusic-player-queue-item-renderer'
    );
  }
  
  const result = [];
  items.forEach((el, idx) => {
    const titleEl = el.querySelector('.song-title, .title, [slot="title"]');
    const bylineEl = el.querySelector('.byline, .subtitle, [slot="byline"]');
    const durEl = el.querySelector('.duration, .time');
    
    // 選択状態の判定（複数の方法を試す）
    const isSelected = 
      el.hasAttribute('selected') || 
      el.classList.contains('selected') ||
      el.getAttribute('aria-selected') === 'true' ||
      el.getAttribute('play-button-state') === 'playing' ||
      el.getAttribute('play-button-state') === 'paused';
    
    const title = titleEl 
      ? (titleEl.getAttribute('title') || titleEl.textContent).trim() 
      : '';
    const byline = bylineEl 
      ? bylineEl.textContent.replace(/\s+/g, ' ').trim() 
      : '';
    
    result.push({
      title: title || 'Unknown',
      byline: byline,
      duration: durEl ? durEl.textContent.trim() : '--:--',
      selected: isSelected,
      index: idx
    });
  });
  return result;
}

function openYTMQueue(){
  const bar = document.querySelector('ytmusic-player-bar');
  if (!bar) return false;
  
  // クラス名で探す（YTMのボタンにはクラスがついてる）
  const selectors = [
    'button.queue-button',
    '.queue-button',
    'button[aria-label*="queue" i]',
    'button[title*="queue" i]'
  ];
  for (const s of selectors) {
    const btn = bar.querySelector(s);
    if (btn) {
      console.log('[PAAUDIO] open queue via', s);
      btn.click();
      return true;
    }
  }
  
  // フォールバック: 全ボタンを舐める
  const allBtns = bar.querySelectorAll('button');
  for (const btn of allBtns){
    const cls = (btn.className || '').toLowerCase();
    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (cls.includes('queue') || aria.includes('queue') || aria.includes('キュー')){
      btn.click();
      return true;
    }
  }
  console.log('[PAAUDIO] queue button not found');
  return false;
}
let _queueNavBusy = false;

function playQueueItem(idx){
  if (_queueNavBusy) {
    console.log('[PAAUDIO] nav busy, ignoring');
    return;
  }
  
  const target = idx;
  ytmQueueCache = readYTMQueue();
  let current = ytmQueueCache.findIndex(it => it.selected);
  
  if (current < 0) current = 0;
  
  // 同じ曲 → トグル
  if (current === target) {
    console.log('[PAAUDIO] same track, toggling');
    ytmCmd('toggle');
    return;
  }
  
  _queueNavBusy = true;
  console.log('[PAAUDIO] === SEEK START === target:', target, 'from:', current);
  attemptNav(target, 0);
}

// リトライ付きナビゲーション
const NAV_MAX_RETRY = 8;       // 最大リトライ回数（無限ループ防止）
const NAV_CLICK_INTERVAL = 200; // 1クリック間隔（ms）
const NAV_SETTLE_WAIT = 450;    // 着地確認までの待ち時間（ms）

function attemptNav(target, attempt){
  if (attempt > NAV_MAX_RETRY) {
    console.log('[PAAUDIO] === SEEK ABORT === max retries reached');
    _queueNavBusy = false;
    return;
  }
  
  // 現在位置を読む（YTMが更新されるまで少し待つ）
  ytmQueueCache = readYTMQueue();
  let current = ytmQueueCache.findIndex(it => it.selected);
  if (current < 0) current = 0;
  
  const delta = target - current;
  
  console.log('[PAAUDIO] attempt', attempt, '| current:', current, '→ target:', target, '| delta:', delta);
  
  // 目的の曲に到着！
  if (delta === 0) {
    console.log('[PAAUDIO] === SEEK COMPLETE === landed at:', current);
    _queueNavBusy = false;
    ytmQueueSelected = target;
    return;
  }
  
  // 送る方向と回数
  const dir = delta > 0 ? 'next' : 'prev';
  const btnSel = delta > 0 ? '.next-button' : '.previous-button';
  let remaining = Math.abs(delta);
  
  console.log('[PAAUDIO] firing', remaining, 'x', dir);
  
  function step(){
    if (remaining <= 0) {
      // 着地するまで待ってから次の試行
      setTimeout(() => {
        attemptNav(target, attempt + 1);
      }, NAV_SETTLE_WAIT);
      return;
    }
    
    const bar = document.querySelector('ytmusic-player-bar');
    const btn = bar ? bar.querySelector(btnSel) : null;
    if (btn) {
      btn.click();
    } else {
      // フォールバック: ブリッジ経由
      ytmCmd(dir);
    }
    
    remaining--;
    setTimeout(step, NAV_CLICK_INTERVAL);
  }
  step();
}
/* ==================== YTM MODE ==================== */
function ytmModeClick(){
  const bar = document.querySelector('ytmusic-player-bar');
  if (!bar) return false;
  
  // クラス名 "repeat" のボタンを探す
  const btn = bar.querySelector('button.repeat, .repeat');
  if (btn) {
    console.log('[PAAUDIO] click repeat');
    btn.click();
    return true;
  }
  console.log('[PAAUDIO] repeat button not found');
  return false;
}

/* ==================== FONT 5x7 ==================== */
const FONT = (function(){
  const src = `
A 01110 10001 10001 11111 10001 10001 10001
B 11110 10001 10001 11110 10001 10001 11110
C 01110 10001 10000 10000 10000 10001 01110
D 11110 10001 10001 10001 10001 10001 11110
E 11111 10000 10000 11110 10000 10000 11111
F 11111 10000 10000 11110 10000 10000 10000
G 01110 10001 10000 10111 10001 10001 01111
H 10001 10001 10001 11111 10001 10001 10001
I 11111 00100 00100 00100 00100 00100 11111
J 00111 00010 00010 00010 00010 10010 01100
K 10001 10010 10100 11000 10100 10010 10001
L 10000 10000 10000 10000 10000 10000 11111
M 10001 11011 10101 10101 10001 10001 10001
N 10001 11001 10101 10011 10001 10001 10001
O 01110 10001 10001 10001 10001 10001 01110
P 11110 10001 10001 11110 10000 10000 10000
Q 01110 10001 10001 10001 10101 10010 01101
R 11110 10001 10001 11110 10100 10010 10001
S 01111 10000 10000 01110 00001 00001 11110
T 11111 00100 00100 00100 00100 00100 00100
U 10001 10001 10001 10001 10001 10001 01110
V 10001 10001 10001 10001 10001 01010 00100
W 10001 10001 10001 10101 10101 11011 10001
X 10001 10001 01010 00100 01010 10001 10001
Y 10001 10001 01010 00100 00100 00100 00100
Z 11111 00001 00010 00100 01000 10000 11111
0 01110 10001 10011 10101 11001 10001 01110
1 00100 01100 00100 00100 00100 00100 01110
2 01110 10001 00001 00010 00100 01000 11111
3 11111 00010 00100 00010 00001 10001 01110
4 00010 00110 01010 10010 11111 00010 00010
5 11111 10000 11110 00001 00001 10001 01110
6 00110 01000 10000 11110 10001 10001 01110
7 11111 00001 00010 00100 01000 01000 01000
8 01110 10001 10001 01110 10001 10001 01110
9 01110 10001 10001 01111 00001 00010 01100
. 00000 00000 00000 00000 00000 00110 00110
, 00000 00000 00000 00000 00110 00100 01000
: 00000 00110 00110 00000 00110 00110 00000
; 00000 00110 00110 00000 00110 00100 01000
- 00000 00000 00000 11111 00000 00000 00000
_ 00000 00000 00000 00000 00000 00000 11111
+ 00000 00100 00100 11111 00100 00100 00000
= 00000 00000 11111 00000 11111 00000 00000
* 00000 10101 01110 11111 01110 10101 00000
/ 00001 00010 00010 00100 01000 01000 10000
\\ 10000 01000 01000 00100 00010 00010 00001
% 11001 11010 00010 00100 01000 01011 10011
! 00100 00100 00100 00100 00100 00000 00100
? 01110 10001 00001 00110 00100 00000 00100
' 00100 00100 00000 00000 00000 00000 00000
" 01010 01010 00000 00000 00000 00000 00000
( 00010 00100 01000 01000 01000 00100 00010
) 01000 00100 00010 00010 00010 00100 01000
[ 01110 01000 01000 01000 01000 01000 01110
] 01110 00010 00010 00010 00010 00010 01110
< 00001 00010 00100 01000 00100 00010 00001
> 10000 01000 00100 00010 00100 01000 10000
# 01010 01010 11111 01010 11111 01010 01010
& 01100 10010 10100 01000 10101 10010 01101
| 00100 00100 00100 00100 00100 00100 00100
~ 00000 00000 01001 10110 00000 00000 00000
@ 01110 10001 10111 10101 10111 10000 01110
^ 00100 01010 10001 00000 00000 00000 00000
  `;
  const map = {};
  src.split('\n').forEach(line=>{
    line = line.trim();
    if(!line) return;
    const parts = line.split(/\s+/);
    map[parts[0]] = parts.slice(1).map(s=>parseInt(s,2)).concat([0,0,0,0,0,0,0]).slice(0,7);
  });
  map[' '] = [0,0,0,0,0,0,0];
  return map;
})();

/* ==================== CJK ==================== */
const CJK_W = 11, CJK_PHYS = 16, CJK_SS = 3, CJK_THRESH = 70, CJK_Y_NUDGE = 1;
const cjkCache = new Map();
let _cjkCanvas = null, _cjkCtx = null;
function _ensureCJKCanvas(size){
  if(!_cjkCanvas){ _cjkCanvas = document.createElement('canvas'); _cjkCtx = _cjkCanvas.getContext('2d',{willReadFrequently:true}); }
  if(_cjkCanvas.width < size){ _cjkCanvas.width = size; _cjkCanvas.height = size; }
}
function getCJKBitmap(ch, size){
  const key = ch + '|' + size;
  if(cjkCache.has(key)) return cjkCache.get(key);
  const big = size * CJK_SS;
  _ensureCJKCanvas(big);
  const g = _cjkCtx;
  g.clearRect(0,0,big,big);
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.font = `400 ${Math.floor(big*0.94)}px "Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","Meiryo","MS Gothic",sans-serif`;
  g.fillText(ch, big/2, big/2 + 1);
  const data = g.getImageData(0,0,big,big).data;
  const rows = []; const SS2 = CJK_SS * CJK_SS;
  for(let y=0;y<size;y++){
    const row = new Uint8Array(size);
    for(let x=0;x<size;x++){
      let sum = 0;
      for(let dy=0;dy<CJK_SS;dy++) for(let dx=0;dx<CJK_SS;dx++){
        sum += data[((y*CJK_SS+dy)*big + (x*CJK_SS+dx))*4+3];
      }
      row[x] = (sum/SS2) > CJK_THRESH ? 1 : 0;
    }
    rows.push(row);
  }
  cjkCache.set(key, rows);
  return rows;
}
function isASCII(ch){ return ch.charCodeAt(0) < 128; }

/* ==================== BUFFER ==================== */
const SCALE = 1.5, W = 480, H = 120, PW = 720, PH = 180;
const fb = new Uint8Array(PW*PH);
const glowBuf = new Float32Array(PW*PH);
let clipX0=0, clipY0=0, clipX1=W, clipY1=H;
function setClip(x,y,w,h){ clipX0=Math.max(0,x|0); clipY0=Math.max(0,y|0); clipX1=Math.min(W,(x+w)|0); clipY1=Math.min(H,(y+h)|0); }
function resetClip(){ clipX0=0; clipY0=0; clipX1=W; clipY1=H; }
function px(x,y,c){ x|=0;y|=0; if(x<clipX0||x>=clipX1||y<clipY0||y>=clipY1)return;
  const x0=Math.floor(x*SCALE),x1=Math.floor((x+1)*SCALE),y0=Math.floor(y*SCALE),y1=Math.floor((y+1)*SCALE);
  for(let yy=y0;yy<y1;yy++){const r=yy*PW;for(let xx=x0;xx<x1;xx++){const i=r+xx;if(c>fb[i])fb[i]=c;}}
}
function pset(x,y,c){ x|=0;y|=0; if(x<clipX0||x>=clipX1||y<clipY0||y>=clipY1)return;
  const x0=Math.floor(x*SCALE),x1=Math.floor((x+1)*SCALE),y0=Math.floor(y*SCALE),y1=Math.floor((y+1)*SCALE);
  for(let yy=y0;yy<y1;yy++){const r=yy*PW;for(let xx=x0;xx<x1;xx++)fb[r+xx]=c;}
}
function clearFB(v){ fb.fill(v||0); }
function fillRect(x,y,w,h,c){ for(let j=0;j<h;j++)for(let i=0;i<w;i++)px(x+i,y+j,c); }
function rectOutline(x,y,w,h,c){ for(let i=0;i<w;i++){px(x+i,y,c);px(x+i,y+h-1,c);} for(let j=0;j<h;j++){px(x,y+j,c);px(x+w-1,y+j,c);} }
function hline(x,y,w,c){ for(let i=0;i<w;i++)px(x+i,y,c); }
function vline(x,y,h,c){ for(let j=0;j<h;j++)px(x,y+j,c); }
function blitMono(bits,size,physX,physY,c){
  physY += CJK_Y_NUDGE;
  const cx0=Math.floor(clipX0*SCALE),cx1=Math.floor(clipX1*SCALE),cy0=Math.floor(clipY0*SCALE),cy1=Math.floor(clipY1*SCALE);
  const x0=Math.max(cx0,physX),x1=Math.min(cx1,physX+size),y0=Math.max(cy0,physY),y1=Math.min(cy1,physY+size);
  if(x0>=x1||y0>=y1)return;
  for(let y=y0;y<y1;y++){const r=bits[y-physY],fr=y*PW;
    for(let x=x0;x<x1;x++) if(r[x-physX]){const i=fr+x;if(c>fb[i])fb[i]=c;}}
}
function blitMonoPset(bits,size,physX,physY,c){
  physY += CJK_Y_NUDGE;
  const cx0=Math.floor(clipX0*SCALE),cx1=Math.floor(clipX1*SCALE),cy0=Math.floor(clipY0*SCALE),cy1=Math.floor(clipY1*SCALE);
  const x0=Math.max(cx0,physX),x1=Math.min(cx1,physX+size),y0=Math.max(cy0,physY),y1=Math.min(cy1,physY+size);
  if(x0>=x1||y0>=y1)return;
  for(let y=y0;y<y1;y++){const r=bits[y-physY],fr=y*PW;
    for(let x=x0;x<x1;x++) if(r[x-physX]) fb[fr+x]=c;}
}
const MIN_TRACK = 1;
function spc(sp){ sp=(sp===undefined)?MIN_TRACK:Math.floor(sp); return sp<MIN_TRACK?MIN_TRACK:sp; }
function charW(ch,sp){ sp=spc(sp); if(FONT[ch.toUpperCase()])return 5+sp; if(isASCII(ch))return 5+sp; return CJK_W+sp; }
function tw(s,sp){ sp=spc(sp); s=String(s); let w=0; for(let i=0;i<s.length;i++)w+=charW(s[i],sp); return Math.max(0,w-sp); }
function drawText(s,x,y,c,sp){
  sp=spc(sp); s=String(s); let cx=x;
  for(let n=0;n<s.length;n++){
    const ch=s[n], up=ch.toUpperCase();
    if(FONT[up]){ const g=FONT[up];
      for(let r=0;r<7;r++){const row=g[r];if(!row)continue;for(let b=0;b<5;b++) if(row&(1<<(4-b))) px(cx+b,y+r,c);}
      cx+=5+sp;
    } else if(isASCII(ch)){ const g=FONT['?'];
      for(let r=0;r<7;r++){const row=g[r];if(!row)continue;for(let b=0;b<5;b++) if(row&(1<<(4-b))) px(cx+b,y+r,c);}
      cx+=5+sp;
    } else { const bits=getCJKBitmap(ch,CJK_PHYS); blitMono(bits,CJK_PHYS,Math.floor(cx*SCALE),Math.floor((y-(CJK_W-7)+1)*SCALE),c); cx+=CJK_W+sp; }
  }
}
function drawTextBig(s,x,y,c,sc,sp){
  sc=sc||2; sp=spc(sp); s=String(s); let cx=x;
  for(let n=0;n<s.length;n++){
    const ch=s[n], up=ch.toUpperCase();
    if(FONT[up]||isASCII(ch)){ const g=FONT[up]||FONT['?'];
      for(let r=0;r<7;r++){const row=g[r];if(!row)continue;for(let b=0;b<5;b++) if(row&(1<<(4-b))){for(let dy=0;dy<sc;dy++)for(let dx=0;dx<sc;dx++) px(cx+b*sc+dx,y+r*sc+dy,c);}}
      cx+=(5+sp)*sc;
    } else { const size=CJK_PHYS*sc; const bits=getCJKBitmap(ch,size);
      blitMono(bits,size,Math.floor(cx*SCALE),Math.floor((y-sc*(CJK_W-7)+1)*SCALE),c);
      cx+=(CJK_W+sp)*sc;
    }
  }
}
function drawTextPset(s,x,y,c,sp){
  sp=spc(sp); s=String(s); let cx=x;
  for(let n=0;n<s.length;n++){
    const ch=s[n], up=ch.toUpperCase();
    if(FONT[up]){ const g=FONT[up];
      for(let r=0;r<7;r++){const row=g[r];if(!row)continue;for(let b=0;b<5;b++) if(row&(1<<(4-b))) pset(cx+b,y+r,c);}
      cx+=5+sp;
    } else if(isASCII(ch)){ const g=FONT['?'];
      for(let r=0;r<7;r++){const row=g[r];if(!row)continue;for(let b=0;b<5;b++) if(row&(1<<(4-b))) pset(cx+b,y+r,c);}
      cx+=5+sp;
    } else { const bits=getCJKBitmap(ch,CJK_PHYS); blitMonoPset(bits,CJK_PHYS,Math.floor(cx*SCALE),Math.floor((y-(CJK_W-7)+1)*SCALE),c); cx+=CJK_W+sp; }
  }
}
function ellipsize(s,maxW,sp){
  sp=(sp===undefined)?0:sp; s=String(s);
  if(tw(s,sp)<=maxW) return s;
  const ell='…', ellW=tw(ell,sp); let out='', w=0;
  for(let i=0;i<s.length;i++){ const cw=charW(s[i],sp); if(w+cw+ellW>maxW)break; out+=s[i]; w+=cw; }
  return out+ell;
}
function drawTextRight(s,rx,y,c,sp){ drawText(s,rx-tw(s,sp),y,c,sp); }
function drawTextCenter(s,cx,y,c,sp){ drawText(s,cx-Math.floor(tw(s,sp)/2),y,c,sp); }
function drawTextBigCenter(s,cx,y,c,sc,sp){ sc=sc||2; sp=spc(sp); drawTextBig(s,cx-Math.floor(tw(s,sp)*sc/2),y,c,sc,sp); }
function marquee(s,x,y,w,c,speed){
  s=String(s); const full=tw(s);
  if(full<=w){ drawText(s,x,y,c); return; }
  const total=full+24, off=Math.floor((state.frame*(speed||0.6))%total);
  setClip(x,y-2,w,12);
  drawText(s,x-off,y,c); drawText(s,x-off+total,y,c);
  resetClip();
}

/* ==================== THEMES ==================== */
const THEMES = [
  {name:'CYAN',pal:[[2,8,16],[0,58,88],[0,168,214],[132,244,255],[255,80,80],[80,255,120],[255,220,60],[255,120,255],[80,180,255],[180,120,255],[255,180,80],[60,255,200]]},
  {name:'ICE',pal:[[2,6,20],[8,40,120],[40,120,240],[180,215,255],[255,80,80],[80,255,160],[255,220,100],[255,120,255],[120,180,255],[180,140,255],[255,200,140],[80,240,240]]},
  {name:'AMBER',pal:[[14,6,0],[110,52,0],[230,140,10],[255,224,140],[255,60,60],[120,255,100],[255,255,200],[255,120,255],[255,180,60],[255,120,30],[200,255,120],[255,220,60]]},
  {name:'EMERALD',pal:[[0,12,8],[0,80,50],[0,200,120],[150,255,210],[255,60,80],[255,255,100],[255,220,60],[255,120,255],[120,255,180],[80,220,255],[200,255,140],[60,255,200]]},
  {name:'CRIMSON',pal:[[16,2,4],[110,10,20],[230,40,60],[255,170,180],[255,200,60],[120,255,100],[255,220,120],[255,120,220],[255,120,80],[255,60,140],[255,200,160],[120,240,220]]},
  {name:'VIOLET',pal:[[8,2,18],[60,20,120],[150,70,240],[220,180,255],[255,80,120],[120,255,180],[255,220,100],[100,220,255],[180,120,255],[255,140,220],[140,180,255],[200,255,200]]},
  {name:'MONO',pal:[[8,8,8],[70,70,70],[190,190,190],[255,255,255],[200,200,200],[230,230,230],[255,255,255],[180,180,180],[150,150,150],[220,220,220],[240,240,240],[110,110,110]]},
  {name:'SUNSET',pal:[[16,4,8],[120,30,10],[240,90,20],[255,200,120],[255,60,60],[255,220,80],[255,140,200],[255,120,80],[255,180,60],[220,80,140],[255,220,180],[180,120,255]]},
  {name:'OCEAN',pal:[[0,8,20],[0,50,110],[0,140,200],[120,220,255],[255,80,80],[80,255,180],[255,220,80],[255,120,220],[60,180,255],[120,255,255],[200,255,255],[80,140,255]]},
  {name:'SAKURA',pal:[[18,6,12],[120,40,70],[230,120,160],[255,220,230],[255,80,120],[200,255,180],[255,240,140],[180,220,255],[255,160,200],[255,200,220],[255,220,180],[220,180,255]]},
  {name:'FOREST',pal:[[4,12,4],[20,70,30],[60,180,80],[180,255,180],[255,80,60],[255,240,100],[140,255,180],[255,180,80],[100,220,120],[200,255,140],[255,220,140],[80,200,200]]},
  {name:'NEON',pal:[[10,2,20],[80,10,120],[220,40,240],[255,180,255],[0,240,220],[255,240,80],[255,80,180],[120,255,255],[180,80,255],[80,255,180],[255,120,220],[220,220,255]]}
];
const BTN_COLORS = [
  {name:'CYAN',css:'#37e0ff'},{name:'AMBER',css:'#ffb03a'},{name:'GREEN',css:'#5aff9e'},
  {name:'PINK',css:'#ff6fd8'},{name:'RED',css:'#ff5050'},{name:'BLUE',css:'#4a8fff'},
  {name:'PURPLE',css:'#b06fff'},{name:'WHITE',css:'#ffffff'},{name:'ORANGE',css:'#ff8020'},
  {name:'ICE',css:'#a0e0ff'}
];
const BTN_COLOR_NAMES = [...BTN_COLORS.map(c=>c.name),'CYCLE'];

/* ==================== STATE ==================== */
const state = {
  power:false, phase:'off', bootT:0, frame:0, screen:'main',
  displayPage:0, source:'CD', discIn:true, menuIdx:0, stack:['root'],
  theme:0, bright:2, contrast:2,
  viz:0, clock24:1, scrollOn:1, demoOn:0, beep:1,
  volume:24, clockH:13, clockM:42, clockS:0,
  volAnim:0, lang:1, playMode:0, btnColor:0,
  seekAnim:0, seekDir:0, seekAmount:0,
  trackAnim:0, confirmDialog:null,
  _lastTitle: '',
  eq: new Array(13).fill(0), eqBand:0, eqPreset:0,
  sfMode:1, loudness:0, position:3,
  bass:0, mid:0, treble:0, preGain:0
};
const POS_NAMES = ['FRONT L','FRONT R','REAR','DRIVER'];
const POS_NAMES_JP = ['前左','前右','後部','運転席'];
const THEME_NAMES = THEMES.map(t=>t.name);
const PLAY_MODES = [
  {name:'NORMAL',nameJp:'ノーマル'},
  {name:'REPEAT ALL',nameJp:'全曲リピート'},
  {name:'REPEAT 1',nameJp:'1曲リピート'},
  {name:'SHUFFLE',nameJp:'シャッフル'}
];
const EQ_FREQS = [50,80,125,200,315,500,800,1250,2000,3150,5000,8000,12500];

/* ==================== AUDIO STUB ==================== */
const audioEl = {
  get paused(){ return bridgePaused; },
  get currentTime(){ return bridgeTime; },
  get duration(){ return bridgeDur; },
  get src(){ return bridgeDur > 0 ? 'ytm' : ''; },
  play(){ ytmCmd('play'); },
  pause(){ ytmCmd('pause'); },
  addEventListener(){},
  set src(v){},
  set currentTime(v){ ytmCmd('seek', v); }
};
let isPlaying = false;
let playlist = [{file:null,url:null,title:'',artist:'',album:'',dur:0,art:null,id3Loaded:true,_ytmArt:''}];
let curTrack = 0;
const ytmArtCache = new Map();

function refreshFromYTM(){
  const info = readYTMInfo();
  if(!info || !info.title) return;
  const t = playlist[0];
  t.title = info.title.slice(0,60);
  t.artist = info.artist.slice(0,48);
  t.album = info.album.slice(0,48);
  t._ytmArt = info.art;
  t.art = null;
  state.cdTrack = 0;
  state.discIn = true;
  loadYTMArt(info.art, a => { if(a) t.art = a; });
}
function loadYTMArt(url, cb){
  if(!url) return cb(null);
  if(ytmArtCache.has(url)) return cb(ytmArtCache.get(url));
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { try{ const a = imageToMonoArt(img, 128); ytmArtCache.set(url, a); cb(a); }catch(e){ cb(null); } };
  img.onerror = () => cb(null);
  img.src = url;
}
function imageToMonoArt(img, size){
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, size, size);
  const data = g.getImageData(0,0,size,size).data;
  const out = new Uint8Array(size*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const i=(y*size+x)*4, a=data[i+3]/255;
    out[y*size+x] = Math.round((0.299*data[i]+0.587*data[i+1]+0.114*data[i+2])*a);
  }
  return {w:size,h:size,data:out};
}
function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return h>>>0; }
const BAYER_4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
const ART_LEVELS = [0,1,2,3,4,5,6,7,8];
function generateProceduralArt(seed,size){
  const out = new Uint8Array(size*size);
  let a=seed; const rng=()=>{a|=0;a=a+0x6D2B79F5|0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const v=(x/size)*0.5+(y/size)*0.5;
    out[y*size+x]=Math.max(0,Math.min(3,Math.floor(v*3.5)));
  }
  for(let i=0;i<size;i++){out[i]=3;out[(size-1)*size+i]=3;out[i*size]=3;out[i*size+size-1]=3;}
  for(let i=0;i<out.length;i++) out[i]=Math.min(255,out[i]*85);
  return {w:size,h:size,data:out};
}
function getAlbumArt(track){
  if(!track) return null;
  if(track.art) return track.art;
  if(track._ytmArt){ loadYTMArt(track._ytmArt, a => { if(a) track.art = a; }); }
  if(!track._procArt){ track._procArt = generateProceduralArt(hashStr((track.artist||'')+'|'+(track.album||'')+'|'+(track.title||'')),48); }
  return track._procArt;
}
function drawArtDither(art, ax, ay, targetSize){
  if(!art) return;
  const srcW=art.w, srcH=art.h;
  const scaleX=srcW/targetSize, scaleY=srcH/targetSize;
  const LEVELS=ART_LEVELS.length-1;
  for(let j=0;j<targetSize;j++){
    const sy0=Math.floor(j*scaleY); let sy1=Math.floor((j+1)*scaleY); if(sy1<=sy0)sy1=sy0+1; if(sy1>srcH)sy1=srcH;
    for(let i=0;i<targetSize;i++){
      const sx0=Math.floor(i*scaleX); let sx1=Math.floor((i+1)*scaleX); if(sx1<=sx0)sx1=sx0+1; if(sx1>srcW)sx1=srcW;
      let sum=0,cnt=0;
      for(let sy=sy0;sy<sy1;sy++){const row=sy*srcW;for(let sx=sx0;sx<sx1;sx++){sum+=art.data[row+sx];cnt++;}}
      const lum=(cnt?sum/cnt:0)/255;
      const threshold=(BAYER_4[j%4][i%4]+0.5)/16;
      const dithered=lum+(threshold-0.5)*0.35;
      let level=Math.floor(dithered*LEVELS);
      if(dithered>=1) level=LEVELS;
      if(level<0) level=0;
      pset(ax+i,ay+j,level===0?0:ART_LEVELS[level]);
    }
  }
}

/* ==================== PLAYBACK ==================== */
function playTrack(){ ytmCmd('play'); }
function nextTrack(dir){ ytmCmd(dir>0?'next':'prev'); }
function stopAllAudio(){ ytmCmd('pause'); }
function togglePlayPause(){ ytmCmd('toggle'); }
function changeVolume(d){
  const old=state.volume;
  state.volume = clamp(state.volume + d, 0, 40);
  if(state.volume !== old){
    ytmCmd('volume', state.volume/40);
    state.volAnim = 1.8;
    scheduleSave();
  }
}
function seekBySeconds(sec){
  if(bridgeDur <= 0) return;
  let t = bridgeTime + sec;
  if(t < 0) t = 0;
  if(t > bridgeDur - 0.05) t = bridgeDur - 0.05;
  ytmCmd('seek', t);
  state.seekAnim = 0.7;
  state.seekDir = sec >= 0 ? 1 : -1;
  state.seekAmount = Math.abs(sec);
  if(sec >= 0) seUp3(); else seDn3();
}

/* ==================== SPECTRUM ==================== */
function getSpectrum(n, out){
  if(!out) out = new Float32Array(n);
  if(bridgeSpec && bridgeSpec.length && !bridgePaused){
    const len = bridgeSpec.length;
    for(let i=0;i<n;i++){
      const t = i/n;
      const idx = Math.min(len-1, Math.floor(Math.pow(t,1.7)*len*0.72));
      let v = bridgeSpec[idx]/255;
      v *= (1.0 + t*0.55);
      out[i] = Math.min(1, v*1.15);
    }
    return out;
  }
  const f = state.frame;
  for(let i=0;i<n;i++){
    const t = i/n;
    const a = Math.sin(i*0.62 + f*0.13);
    const b = Math.sin(i*0.21 - f*0.09 + 1.7);
    const c = Math.sin(i*1.31 + f*0.05 + 0.4);
    let v = (a*0.45+0.5)*(b*0.35+0.65)*(c*0.25+0.85);
    v *= (1.15 - t*0.55);
    out[i] = Math.max(0, Math.min(1, v));
  }
  return out;
}
function getWave(n, out){
  if(!out) out = new Float32Array(n);
  if(bridgeWave && bridgeWave.length && !bridgePaused){
    const len = bridgeWave.length;
    for(let i=0;i<n;i++){ const idx = Math.floor(i/n*len); out[i] = (bridgeWave[idx]-128)/128; }
    return out;
  }
  const f = state.frame;
  for(let i=0;i<n;i++){
    const p = i/n*Math.PI*2;
    out[i] = (Math.sin(p*3+f*0.18)*0.5 + Math.sin(p*7-f*0.11)*0.3 + Math.sin(p*13+f*0.07)*0.18) * 0.7;
  }
  return out;
}

/* ==================== LINE3 (helper for visualizers) ==================== */
function line3(a,b,c){
  let x0=a[0]|0, y0=a[1]|0, x1=b[0]|0, y1=b[1]|0;
  const dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
  const sx=x0<x1?1:-1, sy=y0<y1?1:-1;
  let err=dx-dy, guard=0;
  while(guard++ < 1200){
    px(x0,y0,c);
    if(x0===x1 && y0===y1) break;
    const e2 = err*2;
    if(e2 > -dy){ err -= dy; x0 += sx; }
    if(e2 < dx){ err += dx; y0 += sy; }
  }
}

/* ==================== VISUALIZERS — 本家8種 ==================== */

/* 1. 3D BARS */
function viz3DBars(x,y,w,h,f){
  const n=20, depth=4;
  const data=getSpectrum(n);
  const bw=Math.floor(w/n);
  const baseY=y+h-3;
  for(let i=0;i<n;i++){
    const v=data[i];
    const bh=Math.max(2,Math.floor(v*(h-14)));
    const bx=x+i*bw+2;
    for(let j=0;j<bh;j++){
      const yy=baseY-j;
      const c = j > bh*0.7 ? 4 : (j > bh*0.4 ? 6 : 3);
      for(let k=0;k<bw-4;k++) px(bx+k,yy,c);
    }
    for(let d=1;d<=depth;d++){
      for(let k=0;k<bw-4;k++) px(bx+k+d, baseY-bh-d, 7);
    }
    for(let j=0;j<bh;j++){
      const yy=baseY-j;
      for(let d=1;d<=depth;d++) px(bx+bw-4+d, yy-d, 2);
    }
  }
  hline(x, baseY+1, w, 1);
  drawText('3D BARS', x+2, y+2, 1, 0);
}

/* 2. KALEIDOSCOPE */
function vizKaleidoscope(x,y,w,h,f){
  const cx=x+w/2, cy=y+h/2;
  const d=getSpectrum(24);
  const R=Math.min(w,h)*0.42;
  const cols=[4,5,6,7,8,9,10,11,12,13,14];
  for(let s=0;s<6;s++){
    const a0=s/6*Math.PI*2;
    for(let i=0;i<24;i++){
      const len=d[i]*R;
      const a=a0 + i/24*0.5 + f*0.01;
      line3([cx,cy],[cx+Math.cos(a)*len, cy+Math.sin(a)*len*0.75], cols[(i+s)%11]);
    }
  }
  for(let ring=0;ring<R;ring+=10)
    for(let a=0;a<Math.PI*2;a+=0.15)
      px(cx+Math.cos(a)*ring, cy+Math.sin(a)*ring*0.75, 2);
}

/* 3. AURORA */
function vizAurora(x,y,w,h,f){
  const d=getSpectrum(8);
  const cols=[9,10,9,8,7];
  for(let layer=0;layer<5;layer++){
    const baseY=y+h*0.4 + layer*h*0.08;
    for(let i=0;i<w;i++){
      const t=i/w;
      const wave = Math.sin(t*Math.PI*2 + f*0.03 + layer)*h*0.1
                 + Math.sin(t*Math.PI*4 - f*0.05)*h*0.06;
      const yy = baseY + wave + d[layer]*10;
      const thick = 3 + layer*2;
      for(let j=-thick;j<=thick;j++){
        const fade = 1 - Math.abs(j)/thick;
        px(x+i, yy+j, fade > 0.3 ? cols[layer] : 2);
      }
    }
  }
}

/* 4. GRADIENT WAVE */
function vizGradientWave(x,y,w,h,f){
  const wv=getWave(w);
  const cs=[4,6,7,3,10,11,15];
  const mid=y+h/2;
  for(let i=0;i<w;i++){
    const yy = mid - Math.round(wv[i]*(h/2-4));
    let ci = Math.floor(i/w*cs.length);
    if(ci>=cs.length) ci=cs.length-1;
    if(ci<0) ci=0;
    const c=cs[ci];
    for(let k=0;k<5;k++) px(x+i, yy+k, c);
    if(i>0){
      const py = mid - Math.round(wv[i-1]*(h/2-4));
      for(let k=Math.min(py,yy);k<=Math.max(py,yy);k++) px(x+i, k, c);
    }
  }
  hline(x, mid, w, 1);
}

/* 5. PARTICLE FOUNTAIN */
const _pfParts = [];
function vizParticleFountain(x,y,w,h,f){
  const d=getSpectrum(8);
  const rate = 1 + Math.floor(d[0]*4);
  if(_pfParts.length < 140){
    for(let i=0;i<rate;i++){
      _pfParts.push({
        x: w/2 + (Math.random()-0.5)*6,
        y: h-2,
        vx: (Math.random()-0.5)*2.8,
        vy: -2 - Math.random()*2 - d[0]*2,
        life: 1,
        c: 4 + Math.floor(Math.random()*11)
      });
    }
  }
  for(let i=_pfParts.length-1;i>=0;i--){
    const p=_pfParts[i];
    p.x+=p.vx; p.y+=p.vy; p.vy+=0.08; p.life-=0.015;
    if(p.life<=0 || p.y>h || p.x<0 || p.x>w){ _pfParts.splice(i,1); continue; }
    px(x+p.x, y+p.y, p.life>0.5 ? p.c : 2);
  }
}

/* 6. ORBIT TRAILS */
const _orbits = [];
for(let i=0;i<40;i++){
  _orbits.push({a:Math.random()*Math.PI*2, r:20+Math.random()*40, sp:0.03+Math.random()*0.05, c:4+Math.floor(Math.random()*11), trail:[]});
}
function vizOrbitTrails(x,y,w,h,f){
  const cx=x+w/2, cy=y+h/2;
  const d=getSpectrum(4);
  for(let i=0;i<_orbits.length;i++){
    const o=_orbits[i];
    o.a += o.sp * (1 + d[i%4]);
    const px_ = cx + Math.cos(o.a)*o.r;
    const py_ = cy + Math.sin(o.a)*o.r*0.7;
    o.trail.push([px_,py_]);
    if(o.trail.length > 12) o.trail.shift();
    for(let k=0;k<o.trail.length;k++){
      const alpha = (k+1)/o.trail.length;
      px(o.trail[k][0], o.trail[k][1], alpha>0.7 ? o.c : 2);
    }
  }
}

/* 7. WAVEFORM TIME */
function vizWaveformTime(x,y,w,h,f){
  const wv=getWave(w);
  const mid=y+h*0.4;
  hline(x, mid, w, 1);
  for(let i=0;i<w;i++){
    const yy = mid - Math.round(wv[i]*(h*0.25));
    px(x+i, yy, 3);
    if(i>0){
      const py = mid - Math.round(wv[i-1]*(h*0.25));
      for(let k=Math.min(py,yy);k<=Math.max(py,yy);k++) px(x+i, k, 3);
    }
  }
  for(let i=0;i<=8;i++){
    vline(x + i*w/8, mid-25, 4, 2);
    drawText(String(i*10)+'MS', x + i*w/8 - 1, y+h-10, 9);
  }
  drawText('WAVEFORM', x+2, y+2, 10);
}

/* 8. STEREO BALANCE */
function vizStereoBalance(x,y,w,h,f){
  const d=getSpectrum(32);
  let l=0, r=0;
  for(let i=0;i<16;i++) l+=d[i];
  for(let i=16;i<32;i++) r+=d[i];
  l/=16; r/=16;
  const cx=x+w/2, cy=y+h/2;
  const lLen=Math.floor(l*w*0.4);
  for(let i=0;i<lLen;i++) for(let j=0;j<6;j++) px(cx-10-i, cy+j, 9);
  const rLen=Math.floor(r*w*0.4);
  for(let i=0;i<rLen;i++) for(let j=0;j<6;j++) px(cx+10+i, cy+j, 10);
  vline(cx, cy-10, 26, 2); vline(cx-1, cy-10, 26, 2);
  const bal=(r-l)*w*0.4;
  px(cx+bal,cy-14,15); px(cx+bal+1,cy-14,15); px(cx+bal-1,cy-14,15);
  px(cx+bal,cy-15,15); px(cx+bal,cy-13,15);
  drawText('L', x+4, cy, 9);
  drawText('R', x+w-8, cy, 10);
  drawText('BALANCE', x+2, y+2, 10);
}

const VIZ_FUNCS = [viz3DBars, vizKaleidoscope, vizAurora, vizGradientWave, vizParticleFountain, vizOrbitTrails, vizWaveformTime, vizStereoBalance, null];
const VIZ_NAMES = ['3D BARS','KALEIDOSCOPE','AURORA','GRADIENT WAVE','PARTICLE','ORBIT TRAILS','WAVEFORM TIME','STEREO BAL','OFF'];

/* ==================== HELPERS ==================== */
function pad2(n){ n=Math.floor(n); return (n<10?'0':'')+n; }
function fmtTime(sec){ if(!isFinite(sec)||sec<0)sec=0; const m=Math.floor(sec/60),s=Math.floor(sec%60); return pad2(m)+':'+pad2(s); }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function hash1(i){ i=(i^61)^(i>>>16); i=i+(i<<3); i=i^(i>>>4); i=Math.imul(i,0x27d4eb2d); i=i^(i>>>15); return (i>>>0)/4294967296; }
function easeOut(p){ return 1-Math.pow(1-p,3); }
function L(en,jp){ return state.lang===1?jp:en; }
function timeStr(){
  let h=state.clockH, m=state.clockM;
  if(state.clock24===1){ let hh=h%12; if(hh===0)hh=12; return (h>=12?'午後 ':'午前 ')+pad2(hh)+':'+pad2(m); }
  return pad2(h)+':'+pad2(m);
}
function timeStrShort(){
  let h=state.clockH, m=state.clockM;
  if(state.clock24===1){ let hh=h%12; if(hh===0)hh=12; return pad2(hh)+':'+pad2(m); }
  return pad2(h)+':'+pad2(m);
}
let fadeSnap=null, fadeT=0;
function fadeTransition(fn){ fadeSnap=new Uint8Array(fb); fadeT=0.30; fn(); }
function drawFadeOverlay(){
  if(fadeT<=0||!fadeSnap) return;
  const p=1-fadeT/0.30, fadeK=1-p;
  for(let i=0;i<fb.length;i++){ const ov=(fadeSnap[i]*fadeK)|0; if(ov>fb[i]) fb[i]=ov; }
  if(p>=1) fadeSnap=null;
}
const JP_OPTS = {
  'NORMAL':'ノーマル','REPEAT ALL':'全曲リピート','REPEAT 1':'1曲リピート','SHUFFLE':'シャッフル',
  'ON':'オン','OFF':'オフ','FLAT':'フラット','ROCK':'ロック','POP':'ポップ','JAZZ':'ジャズ',
  'CLASSICAL':'クラシック','VOCAL':'ボーカル','BASS+':'低音+',
  'FRONT L':'前左','FRONT R':'前右','REAR':'後部','DRIVER':'運転席',
  'CYAN':'シアン','ICE':'アイス','AMBER':'アンバー','GREEN':'グリーン','PINK':'ピンク',
  'RED':'レッド','BLUE':'ブルー','PURPLE':'パープル','WHITE':'ホワイト','ORANGE':'オレンジ','CYCLE':'カラーサイクル',
  'EMERALD':'エメラルド','CRIMSON':'クリムゾン','VIOLET':'バイオレット','MONO':'モノ',
  'SUNSET':'サンセット','OCEAN':'オーシャン','SAKURA':'サクラ','FOREST':'フォレスト','NEON':'ネオン',
  '24H':'24時間','12H':'12時間','ENGLISH':'英語','日本語':'日本語',
  '3D BARS':'3Dバー','KALEIDOSCOPE':'万華鏡','AURORA':'オーロラ','GRADIENT WAVE':'虹色波形',
  'PARTICLE':'粒子噴水','ORBIT TRAILS':'軌道残像','WAVEFORM TIME':'波形+時間','STEREO BAL':'ステレオバランス'
};
function T(s){ return (state.lang===1 && JP_OPTS[s]) ? JP_OPTS[s] : s; }

/* SE */
let actxSE = null;
function initSE(){ if(!actxSE){ try{ actxSE = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } }
function seTone(freq, start, dur, type, vol){
  if(!state.beep || !actxSE) return;
  try{
    const t = actxSE.currentTime + start;
    const o = actxSE.createOscillator(), g = actxSE.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol||0.12, t+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g); g.connect(actxSE.destination);
    o.start(t); o.stop(t+dur+0.03);
  }catch(e){}
}
function seUp3(){ seTone(2000, 0, 0.03, 'square', 0.09); }
function seDn3(){ seTone(950, 0, 0.03, 'square', 0.09); }
function seBt5(){ seTone(440,0,0.07,'square',0.10); seTone(660,0.07,0.07,'square',0.10); seTone(880,0.14,0.14,'square',0.12); }
function seSd5(){ seTone(523,0,0.08,'square',0.10); seTone(392,0.08,0.08,'square',0.10); seTone(262,0.16,0.16,'square',0.12); }
function seNm3(){ seTone(1500,0,0.020,'sine',0.10); seTone(2600,0.016,0.024,'square',0.08); }

function menuKey(){ return state.stack[state.stack.length-1]; }
function curMenu(){ return MENUS[menuKey()]; }
function enterMenu(key){ if(!MENUS[key])return; fadeTransition(()=>{ state.stack.push(key); state.menuIdx=0; state.screen='menu'; }); }
function menuBack(){ fadeTransition(()=>{ if(state.stack.length>1){ state.stack.pop(); state.menuIdx=0; } else state.screen='main'; }); }
function setEqBand(i,db){ state.eq[i]=db; }
function applyEqGroups(){
  const p = EQ_PRESETS[state.eqPreset] || EQ_PRESETS[0];
  for(let i=0;i<13;i++){
    let v=p[i];
    if(i<=3) v+=state.bass;
    else if(i<=8) v+=state.mid;
    else v+=state.treble;
    state.eq[i]=clamp(v,-12,12);
  }
  ytmCmd('eq', state.eq);
}
function memoryClear(){ state.eq.fill(0); state.bass=state.mid=state.treble=0; ytmCmd('eq', state.eq); scheduleSave(); }
function fullInit(){
  memoryClear();
  state.theme=0; state.viz=0; state.bright=2; state.contrast=2;
  state.clock24=1; state.demoOn=0; state.scrollOn=1;
  state.volume=24; ytmCmd('volume', state.volume/40);
  state.position=3; state.displayPage=0; state.playMode=0;
  scheduleSave();
}

/* ==================== MENUS ==================== */
const MENUS = {
  root: { title:'MAIN MENU', titleJp:'メインメニュー', items:[
    {t:'sub', label:'EQUALIZER', labelJp:'イコライザ', to:'eqmenu'},
    {t:'sub', label:'LISTENING POS', labelJp:'リスニング', to:'position'},
    {t:'sub', label:'DISPLAY', labelJp:'表示設定', to:'display'},
    {t:'sub', label:'PLAYBACK', labelJp:'再生設定', to:'playback'},
    {t:'sub', label:'CLOCK', labelJp:'時計', to:'clock'},
    {t:'sub', label:'SYSTEM', labelJp:'システム', to:'system'},
    {t:'info',label:'VERSION', labelJp:'バージョン', val:'PAA-100 / YTM 1.1'}
  ]},
  eqmenu: { title:'EQUALIZER', titleJp:'イコライザー', items:[
    {t:'act', label:'13BAND GRAPHIC EQ', labelJp:'13バンドEQ', act:()=>{ fadeTransition(()=>{ state.screen='eq'; }); }},
    {t:'sel', label:'PRESET', labelJp:'プリセット', key:'eqPreset', opts:['FLAT','ROCK','POP','JAZZ','CLASSICAL','VOCAL','BASS+']},
    {t:'act', label:'FLAT ALL', labelJp:'全フラット', act:()=>{ for(let i=0;i<13;i++) setEqBand(i,0); ytmCmd('eq', state.eq); scheduleSave(); }}
  ]},
  position: { title:'LISTENING POS', titleJp:'リスニング位置', items:[
    {t:'sel', label:'SEAT', labelJp:'シート', key:'position', opts:POS_NAMES}
  ]},
  display: { title:'DISPLAY', titleJp:'表示設定', items:[
    {t:'sel', label:'COLOR', labelJp:'色', key:'theme', opts:THEME_NAMES},
    {t:'sel', label:'BUTTON GLOW', labelJp:'ボタン発光', key:'btnColor', opts:BTN_COLOR_NAMES},
    {t:'num', label:'BRIGHTNESS', labelJp:'明るさ', key:'bright', min:0, max:4, step:1},
    {t:'num', label:'CONTRAST', labelJp:'コントラスト', key:'contrast', min:0, max:4, step:1},
    {t:'sel', label:'VISUALIZER', labelJp:'ビジュアライザ', key:'viz', opts:VIZ_NAMES},
    {t:'sel', label:'PAGE', labelJp:'ページ', key:'displayPage', opts:['INFO','VIZ','SPLIT','CLOCK']},
    {t:'sel', label:'CLOCK', labelJp:'時計表示', key:'clock24', opts:['24H','12H']},
    {t:'sel', label:'TITLE SCROLL', labelJp:'スクロール', key:'scrollOn', opts:['ON','OFF']},
    {t:'sel', label:'DEMO MODE', labelJp:'デモ', key:'demoOn', opts:['OFF','ON']},
    {t:'act', label:'PANEL TEST', labelJp:'パネルテスト', act:()=>{ fadeTransition(()=>{ state.screen='test'; }); }}
  ]},
  playback: { title:'PLAYBACK', titleJp:'再生設定', items:[
    {t:'sel', label:'PLAY MODE', labelJp:'再生モード', key:'playMode', opts:PLAY_MODES.map(m=>m.name)},
    {t:'num', label:'VOLUME', labelJp:'音量', key:'volume', min:0, max:40, step:2},
    {t:'act', label:'STOP', labelJp:'停止', act:()=>{ stopAllAudio(); }}
  ]},
  clock: { title:'CLOCK', titleJp:'時計', items:[
    {t:'info', label:'HOUR', labelJp:'時', dyn:()=>pad2(state.clockH)},
    {t:'info', label:'MINUTE', labelJp:'分', dyn:()=>pad2(state.clockM)},
    {t:'info', label:'SECOND', labelJp:'秒', dyn:()=>pad2(state.clockS)},
    {t:'sel', label:'FORMAT', labelJp:'表示形式', key:'clock24', opts:['24H','12H']}
  ]},
  system: { title:'SYSTEM', titleJp:'システム', items:[
    {t:'sel', label:'KEY BEEP', labelJp:'キービープ', key:'beep', opts:['OFF','ON']},
    {t:'sel', label:'LANGUAGE', labelJp:'言語', key:'lang', opts:['ENGLISH','日本語']},
    {t:'act', label:'INITIALIZE ALL', labelJp:'全初期化', act:()=>{ fullInit(); }}
  ]}
};
const EQ_PRESETS = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0],
  [5,4,2,0,-1,-1,0,1,3,4,5,5,4],
  [-1,0,2,3,2,0,-1,-1,0,2,3,3,2],
  [3,2,1,1,0,0,0,1,2,2,3,4,4],
  [0,0,0,0,0,0,0,0,0,1,2,4,5],
  [-2,-1,0,1,3,4,4,3,1,0,-1,-2,-2],
  [7,6,4,2,0,0,0,1,3,5,6,7,7]
];

/* ==================== SCREEN CONSTANTS ==================== */
let pwrLedEl, mediaLedEl, eqLedEl, demoLedEl;
const STATUS_H = 16, INFO_H = 18;
const MAIN_TOP = STATUS_H, MAIN_BOT = H - INFO_H, MAIN_H = MAIN_BOT - MAIN_TOP, INFO_TOP = MAIN_BOT;

/* ==================== DRAW STATUS BAR ==================== */
function drawStatusBar(){
  for(let y=0;y<STATUS_H;y++) for(let x=0;x<W;x++) pset(x,y,y<2?1:2);
  const src = state.source;
  let srcColor = 3;
  if(src==='AUX') srcColor = 5;
  let xp = 4;
  if(src==='CD'||src==='MD'){
    let statusTxt, statusColor;
    if(bridgeDur<=0){ statusTxt = L('NO SIGNAL','信号なし'); statusColor = 3; }
    else if(!bridgePaused){ statusTxt = L('PLAYING','再生中'); statusColor = 5; }
    else { statusTxt = L('PAUSE','一時停止'); statusColor = 4; }
    drawText(statusTxt, xp, 4, statusColor);
    xp += tw(statusTxt,0) + 6;
  }
  drawText(src, xp, 4, srcColor);
  const sepX = xp + tw(src) + 6;
  vline(sepX, 3, 10, 2);
  // モード名を大きく表示
  const modeNames = ['NORMAL', 'REPEAT ALL', 'REPEAT 1', 'SHUFFLE'];
  const modeColors = [2, 6, 6, 6];   // 通常時は暗め、リピート中は目立つ色
  const modeTxt = modeNames[state.playMode] || 'NORMAL';
  drawText(modeTxt, sepX + 6, 4, modeColors[state.playMode] || 2);
  
  // リピート/シャッフル中は点滅する丸マーク
  if(state.playMode !== 0){
    const blink = (Math.floor(state.frame / 4) % 2) === 0;
    if(blink){
      const mx = sepX + 6 + tw(modeTxt, 0) + 4;
      px(mx, 5, 6);
      px(mx+1, 5, 6);
      px(mx+2, 5, 6);
      px(mx, 6, 6);
      px(mx+1, 6, 6);
      px(mx+2, 6, 6);
    }
  }
  const t = timeStr();
  drawText(t, W-4-tw(t), 4, 2);
  const vw = 44;
  const vx = W - 4 - tw(t) - 10 - vw;
  for(let i=0;i<vw;i++){
    const on = (i/vw) < (state.volume/40);
    const c = on ? (i>vw*0.85?4:(i>vw*0.65?6:3)) : 1;
    px(vx+i,4,c); px(vx+i,5,c); px(vx+i,6,c);
  }
  rectOutline(vx-1, 3, vw+2, 5, 1);
}

function drawBackground(){
  const f = state.frame;
  for(let y=4;y<H;y+=8) for(let x=4;x<W;x+=8){
    const d = Math.hypot(x-W/2, y-H/2);
    if(Math.sin(d*0.05 - f*0.15) > 0.3) pset(x, y, 1);
  }
  const data = getSpectrum(8);
  const bass = (data[0]+data[1]+data[2])/3;
  if(bass > 0.3){
    for(let i=0;i<3;i++){
      const r = ((f*2 + i*40) % 130);
      const a = 1 - r/130;
      if(a < 0.12) continue;
      const c = a > 0.6 ? 2 : 1;
      for(let ang=0;ang<Math.PI*2;ang+=0.12)
        px(W/2 + Math.cos(ang)*r, H/2 + Math.sin(ang)*r*0.5, c);
    }
  }
}

/* ==================== MAIN SCREEN ==================== */
function drawMain(){
  clearFB(0);
  const page = state.displayPage % 4;
  const vizIdx = state.viz;
  const hasViz = vizIdx >= 0 && vizIdx < VIZ_FUNCS.length-1 && VIZ_FUNCS[vizIdx];
  if(hasViz && (page === 1)) VIZ_FUNCS[vizIdx](0, 0, W, H, state.frame);
  else drawBackground();
  drawStatusBar();
  hline(0, STATUS_H-1, W, 2);
  drawMainDisc();
  hline(0, INFO_TOP-1, W, 2);
  drawInfoBar();
}

function drawInfoBar(){
  for(let y=0;y<INFO_H;y++){
    const yy = INFO_TOP + y;
    for(let x=0;x<W;x++) pset(x, yy, (y===0||y===INFO_H-1)?2:1);
  }
  const info = readYTMInfo();
  let line1 = 'YOUTUBE MUSIC';
  if(info && info.title) line1 = info.artist + ' - ' + info.title;
  const modeNames = ['NORMAL', 'REPEAT ALL', 'REPEAT 1', 'SHUFFLE'];
  const modeIcons = ['', '[REP ALL]', '[REP 1]', '[SHUF]'];
  let line2 = (bridgePaused ? 'PAUSE' : 'PLAY') + '  ' + 
              (modeIcons[state.playMode] || '') + ' ' + 
              T(modeNames[state.playMode]);
  const TITLE_MAX_W = Math.floor(W/2) - 6;
  if(state.scrollOn) marquee(line1, 4, INFO_TOP+5, TITLE_MAX_W, 3, 0.55);
  else drawText(ellipsize(line1, TITLE_MAX_W, 0), 4, INFO_TOP+5, 3);
  drawText(line2, 4, INFO_TOP+5, 1, 0);
  if(bridgeDur > 0){
    const txt = fmtTime(bridgeTime) + ' / ' + fmtTime(bridgeDur);
    drawText(txt, W-4-tw(txt), INFO_TOP+5, 2, 0);
  }
}

function drawMainDisc(){
  const areaY = MAIN_TOP, areaH = MAIN_H;
  const info = readYTMInfo();
  if(!info || !info.title){
    drawTextCenter(L('PLAY YOUTUBE MUSIC','YouTube Music で再生してください'), W/2, areaY+22, 3);
    const cx=W/2, cy=areaY+56;
    for(let a=0;a<Math.PI*2;a+=0.06){
      px(cx+Math.cos(a)*24, cy+Math.sin(a)*24*0.55, 1);
      px(cx+Math.cos(a)*20, cy+Math.sin(a)*20*0.55, 1);
    }
    return;
  }
  const page = state.displayPage % 4;
  if(page === 0) drawDiscInfo(0, areaY, W, areaH);
  else if(page === 1){
    const vizIdx = state.viz;
    if(vizIdx >= VIZ_FUNCS.length-1 || !VIZ_FUNCS[vizIdx]) drawDiscInfo(0, areaY, W, areaH);
  }
  else if(page === 2){
    const halfW = W>>1;
    drawDiscInfo(0, areaY, halfW, areaH, true);
    vline(halfW, areaY, areaH, 1);
    const vizIdx = state.viz;
    if(vizIdx < VIZ_FUNCS.length-1 && VIZ_FUNCS[vizIdx]) VIZ_FUNCS[vizIdx](halfW+1, areaY, W-halfW-1, areaH, state.frame);
  }
  else drawClockInMain();
}

function drawDiscInfo(x, y, w, h, compact){
  const track = playlist[0];
  const art = getAlbumArt(track);
  const artSize = compact ? Math.min(h-8, Math.floor(w*0.7)) : Math.min(h-8, 68);
  const ax = x + 8;
  const ay = y + (h - artSize)/2;
  const data = getSpectrum(4);
  const lvl = (data[0]+data[1]+data[2]+data[3])/4;
  const borderC = 2 + Math.floor(lvl*2);
  if(art){
    rectOutline(ax-1, ay-1, artSize+2, artSize+2, borderC);
    rectOutline(ax-2, ay-2, artSize+4, artSize+4, 1);
    drawArtDither(art, ax, ay, artSize);
  } else {
    rectOutline(ax-1, ay-1, artSize+2, artSize+2, 2);
    drawTextCenter('NO ART', ax+artSize/2, ay+artSize/2-3, 1);
  }
  const tx = ax + artSize + (compact?6:12);
  const tw_ = w - (tx - x) - 6;
  if(!compact){
    const dots = '.'.repeat(Math.floor(state.frame/8)%4);
    drawText(L('NOW PLAYING','再生中') + dots, tx, y+4, 1, 0);
  }
  if(track){
    setClip(tx, y, tw_, h);
    const ty = compact ? y+4 : y+16;
    drawTextBig(track.title.slice(0, Math.floor(tw_/8)), tx, ty, 3, 1, 1);
    drawText(track.artist.slice(0, Math.floor(tw_/6)), tx, ty+12, 2, 0);
    drawText(track.album.slice(0, Math.floor(tw_/6)), tx, ty+22, 1, 0);
    resetClip();
  }
  if(!compact && track){
    const pw = w - 16;
    const px0 = x+8, py0 = y+h-10;
    drawText(fmtTime(bridgeTime), px0, py0-10, 2, 0);
    drawTextRight(fmtTime(bridgeDur), px0+pw, py0-10, 2, 0);
    rectOutline(px0-1, py0-1, pw+2, 6, 1);
    for(let i=0;i<pw;i++){
      const on = bridgeDur>0 && (i/pw) < (bridgeTime/bridgeDur);
      if(on){
        const c = (i/pw) > 0.9 ? 4 : 3;
        for(let k=0;k<4;k++) px(px0+i, py0+k, c);
      }
    }
    if(bridgeDur>0) vline(px0 + Math.floor((bridgeTime/bridgeDur)*pw), py0-2, 8, 3);
  }
}

function drawClockInMain(){
  const cx = W/2, y0 = MAIN_TOP;
  drawTextCenter(L('CURRENT TIME','現在時刻'), cx, y0+4, 1);
  drawTextBigCenter(timeStrShort(), cx, y0+20, 3, 5, 1);
  const sec = state.clockS, tw_ = 180, barY = y0+74;
  for(let i=0;i<60;i++){
    const on = i <= sec;
    const c = on ? (i>50?4:(i>40?6:3)) : 1;
    const xx = cx - tw_/2 + i*(tw_/60);
    px(xx, barY, c); px(xx, barY+1, c);
  }
  const ampm = state.clock24===1 ? (state.clockH<12 ? L('AM','午前') : L('PM','午後')) : '24H';
  drawTextCenter(ampm, cx, y0+62, 2);
}

/* ==================== MENU SCREEN ==================== */
function drawMenu(){
  clearFB(0); drawBackground();
  const m = curMenu();
  if(!m){ fadeTransition(()=>{ state.screen='main'; }); return; }
  fillRect(0,0,W,STATUS_H,2);
  hline(0, STATUS_H-1, W, 3);
  const title = (state.lang === 1 && m.titleJp) ? m.titleJp : m.title;
  let cx = 6;
  for(let n=0;n<title.length;n++){
    const ch = title[n], up = ch.toUpperCase();
    if(FONT[up]){
      const g = FONT[up];
      for(let r=0;r<7;r++) for(let b=0;b<5;b++) if(g[r]&(1<<(4-b))) pset(cx+b,4+r,0);
      cx += 6;
    } else {
      const bits = getCJKBitmap(ch, CJK_PHYS);
      blitMonoPset(bits, CJK_PHYS, Math.floor(cx*SCALE), Math.floor((4-(CJK_W-7)+1)*SCALE), 0);
      cx += CJK_W + 1;
    }
  }
  if(state.stack.length > 1){ const bt = L('BACK','戻る'); drawText(bt, W-6-tw(bt), 4, 3); }
  const maxItems = 7;
  let start = 0;
  if(state.menuIdx >= maxItems) start = state.menuIdx - maxItems + 1;
  for(let i=0;i<maxItems;i++){
    const idx = start + i;
    if(idx >= m.items.length) break;
    const it = m.items[idx];
    const y = MAIN_TOP + 4 + i*14;
    const sel = idx === state.menuIdx;
    if(sel){ fillRect(0,y-3,W,13,1); drawText('>', 4, y, 3, 0); }
    const label = (state.lang===1 && it.labelJp) ? it.labelJp : it.label;
    drawText(label, 18, y, sel?3:2);
    let rightTxt = '', rightColor = sel?3:2;
    if(it.t==='sel'){ const vi = clamp(state[it.key]|0, 0, it.opts.length-1); rightTxt = T(it.opts[vi]); }
    else if(it.t==='num'){ const v=state[it.key]|0; rightTxt = (v>0&&it.unit==='dB'?'+':'')+v+(it.unit?(' '+it.unit):''); }
    else if(it.t==='sub'){ rightTxt = '>'; rightColor = sel?6:2; }
    else if(it.t==='info'){ rightTxt = it.dyn ? it.dyn() : it.val; rightColor = 1; }
    if(rightTxt) drawText(rightTxt, W - 6 - tw(rightTxt, 1), y, rightColor);
  }
}

/* ==================== EQ SCREEN ==================== */
function drawEQ(){
  clearFB(0); drawBackground();
  fillRect(0,0,W,STATUS_H,2);
  hline(0, STATUS_H-1, W, 3);
  drawText(L('13BAND EQ','13バンドEQ'), 6, 4, 0);
  const et = L('BACK','戻る');
  drawText(et, W-6-tw(et), 4, 3);
  const x0=16, bw=34;
  const barTop=MAIN_TOP+6, barBot=MAIN_BOT-18;
  const midY=Math.floor((barTop+barBot)/2), halfH=midY-barTop;
  hline(x0, midY, 13*bw-8, 2);
  for(let i=0;i<13;i++){
    const bx=x0+i*bw, sel=i===state.eqBand;
    if(sel) rectOutline(bx-3, barTop-4, bw-2, barBot-barTop+10, 3);
    const v=state.eq[i];
    const pxH=Math.round(Math.abs(v)/12*halfH);
    const barW=bw-10;
    if(v>=0){
      for(let j=0;j<pxH;j++){
        const yy=midY-1-j; if(yy<barTop) break;
        const c = j>halfH*0.75?4:5;
        for(let k=0;k<barW;k++) px(bx+k,yy,c);
      }
    } else {
      for(let j=0;j<pxH;j++){
        const yy=midY+1+j; if(yy>barBot) break;
        for(let k=0;k<barW;k++) px(bx+k,yy,4);
      }
    }
    px(bx+barW/2, midY, 3);
  }
  const fr = EQ_FREQS[state.eqBand];
  const fstr = fr>=1000 ? (fr/1000).toFixed(fr%1000?2:0)+'k' : String(fr);
  const v = state.eq[state.eqBand];
  hline(0, INFO_TOP-1, W, 2);
  drawText(fstr + ' Hz', 6, INFO_TOP+3, 3);
  drawTextRight((v>0?'+':'')+v+' dB', W-6, INFO_TOP+3, 3);
}

/* ==================== TEST ==================== */
function drawTest(){
  clearFB(0);
  const g = (state.frame*3)%40;
  for(let y=0;y<H;y+=2) for(let x=0;x<W;x+=2) pset(x,y,(((x/2+y/2+g)|0)%4));
  rectOutline(0,0,W,H,3);
  drawText(L('OEL TEST','OELテスト'), 8, 6, 3, 0);
  for(let i=0;i<12;i++) fillRect(W-14, 6+i*9, 8, 8, i);
}

/* ==================== QUEUE ==================== */
function drawQueue(){
  clearFB(0); drawBackground();
  drawStatusBar();
  hline(0, STATUS_H-1, W, 2);
  const tabY = STATUS_H + 3;
  drawText(L('QUEUE','再生キュー'), 4, tabY, 6);
  const total = ytmQueueCache.length;
  drawTextRight(total + L(' ITEMS',' 曲'), W-4, tabY, 1);
  hline(0, STATUS_H+15, W, 1);
  const LIST_TOP = STATUS_H+17, LIST_BOT = H-INFO_H-1, ROW_H = 12;
  const maxRows = Math.floor((LIST_BOT-LIST_TOP)/ROW_H);
  if(total === 0){
    drawTextCenter(L('QUEUE IS EMPTY','キューが空です'), W/2, (LIST_TOP+LIST_BOT)/2, 2);
    drawTextCenter(L('BAND: LOAD QUEUE','BAND: キュー読込'), W/2, (LIST_TOP+LIST_BOT)/2+14, 1);
  } else {
    if(ytmQueueSelected < ytmQueueScroll) ytmQueueScroll = ytmQueueSelected;
    if(ytmQueueSelected >= ytmQueueScroll + maxRows) ytmQueueScroll = ytmQueueSelected - maxRows + 1;
    const maxScroll = Math.max(0, total - maxRows);
    ytmQueueScroll = clamp(ytmQueueScroll, 0, maxScroll);
    for(let i=0;i<maxRows;i++){
      const idx = ytmQueueScroll + i;
      if(idx >= total) break;
      const item = ytmQueueCache[idx];
      const y = LIST_TOP + i*ROW_H;
      const sel = idx === ytmQueueSelected;
      if(sel){ fillRect(0,y-1,W,ROW_H,1); drawText('>', 2, y+2, 3, 0); }
      if(item.selected){
        const pulse = (Math.floor(state.frame/4)%2)===0;
        if(pulse) drawText('>', 12, y+2, 5, 0);
      } else {
        drawText(pad2(idx+1), 12, y+2, sel?3:2, 0);
      }
      const TITLE_X = 32, TITLE_W = 250;
      const titleColor = sel ? 3 : (item.selected ? 5 : 2);
      drawText(ellipsize(item.title, TITLE_W, 0), TITLE_X, y+2, titleColor, 0);
      const ARTIST_X = 290, ARTIST_W = 150;
      drawText(ellipsize(item.byline, ARTIST_W, 0), ARTIST_X, y+2, sel?2:1, 0);
      drawTextRight(item.duration, W-6, y+2, sel?3:1, 0);
    }
    if(total > maxRows){
      const trackH = LIST_BOT-LIST_TOP;
      const barH = Math.max(8, Math.floor(trackH*maxRows/total));
      const barY = LIST_TOP + Math.floor((trackH-barH)*ytmQueueScroll/Math.max(1,total-maxRows));
      vline(W-1, LIST_TOP, trackH, 1);
      fillRect(W-1, barY, 2, barH, 3);
    }
  }
  hline(0, H-INFO_H-1, W, 2);
  const ly = H-INFO_H+3;
  drawText('Q ' + (ytmQueueSelected+1) + '/' + total, 4, ly, 2, 0);
  const hint = L('[UD]SEL [ENT]PLAY [BAND]EXIT','[↑↓]選択 [決定]再生 [BAND]終了');
  const hintX = Math.max(80, W-6-tw(hint, 0));
  drawText(hint, hintX, ly, 1, 0);
}

/* ==================== BOOT ==================== */
const T_RISE_END = 2.0, T_PLSE_END = 4.0, T_DSPR_END = 5.6, T_TRANS_END = 7.0;
let BOOT_PIX = null, bootParticles = [];
function computeBootLogo(){
  if(BOOT_PIX) return BOOT_PIX;
  const saved = new Uint8Array(fb);
  clearFB(0);
  drawTextBigCenter('PAAUDIO', W>>1, 35, 3, 5, 1);
  BOOT_PIX = [];
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    if(fb[Math.floor(y*SCALE)*PW + Math.floor(x*SCALE)]) BOOT_PIX.push({x,y});
  }
  fb.set(saved);
  return BOOT_PIX;
}
function initBootParticles(){
  const src = computeBootLogo();
  bootParticles = src.map((q,i)=>({tx:q.x, ty:q.y, i, s1:hash1(i*13+7)}));
}
function drawBoot(){
  if(!bootParticles.length) initBootParticles();
  clearFB(0);
  const t = state.bootT;
  if(t < T_RISE_END){
    const p = t/T_RISE_END;
    for(const q of bootParticles){
      const ep = Math.min(1, p/0.8), e = easeOut(ep);
      const y0 = H + q.s1*80;
      const wob = Math.sin(t*3 + q.i*0.1)*20*(1-e);
      const x = Math.round(q.tx + wob*(1-e));
      const y = Math.round(y0*(1-e) + q.ty*e);
      if(x>=0&&x<W&&y>=0&&y<H) px(x, y, 3);
    }
    return;
  }
  if(t < T_PLSE_END){
    const dt = t - T_RISE_END;
    for(const q of bootParticles){
      const d = Math.hypot(q.tx-W/2, q.ty-H/2);
      const ph = (dt*3 - d*0.02) % 2;
      const pulse = ph < 0.3 ? 1 : 0;
      const c = 3 + Math.round(pulse*Math.min(1,dt/0.4)*3);
      px(q.tx, q.ty, c);
    }
    return;
  }
  if(t < T_DSPR_END){
    const dt = t - T_PLSE_END;
    const p = Math.min(1, dt/(T_DSPR_END - T_PLSE_END));
    for(const q of bootParticles){
      const a = q.s1*6.28, r = p*200;
      const x = q.tx + Math.cos(a)*r, y = q.ty + Math.sin(a)*r*0.6;
      if(p > 0.9) continue;
      if(x>=0&&x<W&&y>=0&&y<H) px(x, y, p<0.5?3:2);
    }
    return;
  }
}
function drawBootTransition(){
  const t = state.bootT - T_DSPR_END;
  const total = T_TRANS_END - T_DSPR_END;
  const raw = Math.min(1, t/total);
  clearFB(0); drawMain();
  const ease = 1 - Math.pow(1-raw, 3);
  const cy = H/2;
  const halfH = ease*(H/2+4);
  const y0 = Math.max(0, Math.floor(cy-halfH));
  const y1 = Math.min(H, Math.ceil(cy+halfH));
  for(let y=0;y<y0;y++) for(let x=0;x<W;x++) pset(x, y, 0);
  for(let y=y1;y<H;y++) for(let x=0;x<W;x++) pset(x, y, 0);
  if(raw < 0.98){
    if(y0>0&&y0<H) for(let x=0;x<W;x++){ px(x, y0, 3); if(y0-1>=0) px(x, y0-1, 6); }
    if(y1>0&&y1<H) for(let x=0;x<W;x++){ px(x, y1-1, 3); if(y1<H) px(x, y1, 6); }
  }
}

/* ==================== OVERLAYS ==================== */
function drawVolumeOverlay(){
  clearFB(0);
  const f = state.frame;
  if(state.volAnim < 0.35) return;
  const v = state.volume, cx = W/2, cy = 42;
  for(let i=0;i<4;i++){
    const phase = (f*0.8 + i*22) % 68;
    const r = 12 + phase*1.4;
    const alpha = 1 - phase/68;
    if(alpha < 0.15) continue;
    for(let ang=0; ang<Math.PI*2; ang+=0.16){
      px(cx + Math.cos(ang)*r, cy + Math.sin(ang)*r*0.55, alpha>0.6?3:2);
    }
  }
  drawTextBigCenter(String(v), cx, 18, 3, 5, 1);
  drawTextCenter(L('VOLUME','音量'), cx, 4, 2);
  const barX=30, barY=82, barW=W-60, barH=11;
  const segs=40, segW=barW/segs;
  for(let i=0;i<segs;i++){
    const on = i < v;
    const bx = Math.floor(barX + i*segW);
    const bw = Math.max(1, Math.ceil(segW)-1);
    const c = on ? (i<26?5:(i<34?6:4)) : 1;
    for(let x=0;x<bw;x++) for(let y=0;y<barH;y++) px(bx+x, barY+y, c);
  }
  rectOutline(barX-2, barY-2, barW+4, barH+4, 2);
}
function drawSeekOverlay(){
  clearFB(0);
  if(state.seekAnim < 0.08) return;
  const dir = state.seekDir, amount = Math.round(state.seekAmount||10);
  const cx = W/2;
  for(let y=34;y<86;y++) for(let x=0;x<W;x++) if(((x>>1)+(y>>1))%2===0) px(x, y, 1);
  const arrow = dir >= 0 ? '>>' : '<<';
  drawTextBigCenter(arrow + ' ' + amount + 's', cx, 40, 3, 3, 1);
  drawTextCenter(L('SEEK','シーク'), cx, 72, 2);
  if(bridgeDur > 0){
    const barW = W-80, bx = 40, by = 90;
    rectOutline(bx-1, by-1, barW+2, 7, 1);
    const pw = Math.max(1, Math.floor(barW*(bridgeTime/bridgeDur)));
    for(let i=0;i<pw;i++) for(let k=0;k<5;k++) px(bx+i, by+k, 3);
    drawTextCenter(fmtTime(bridgeTime)+' / '+fmtTime(bridgeDur), cx, 102, 2);
  }
}

/* ==================== PRESENT ==================== */
let cvs, gcv, ctx, gctx, imgData, gImgData;
function present(){
  const pal = THEMES[state.theme % THEMES.length].pal;
  const bright = state.bright, contrast = state.contrast;
  const d = imgData.data, gd = gImgData.data;
  const N = PW*PH;
  for(let i=0;i<N;i++){
    const cur = fb[i];
    const g = glowBuf[i]*0.62;
    glowBuf[i] = cur > g ? cur : g;
  }
  const brightMul = 1 + (bright-2)*0.10;
  const contrastMul = 1 + (contrast-2)*0.16;
  for(let i=0;i<N;i++){
    const v = fb[i];
    const c = pal[v] || pal[0];
    let r = c[0], g = c[1], b = c[2];
    r = clamp((r-128)*contrastMul+128, 0, 255)*brightMul;
    g = clamp((g-128)*contrastMul+128, 0, 255)*brightMul;
    b = clamp((b-128)*contrastMul+128, 0, 255)*brightMul;
    const o = i*4;
    d[o]=r; d[o+1]=g; d[o+2]=b; d[o+3]=255;
    const gv = glowBuf[i];
    const gidx = Math.min(pal.length-1, Math.round(gv));
    const gc = pal[gidx];
    const gk = Math.min(1, gv/3);
    gd[o]=gc[0]*gk; gd[o+1]=gc[1]*gk; gd[o+2]=gc[2]*gk; gd[o+3]=255;
  }
  ctx.putImageData(imgData, 0, 0);
  gctx.putImageData(gImgData, 0, 0);
}

/* ==================== UPDATE / DRAW ==================== */
function syncClock(){
  const now = new Date();
  state.clockH = now.getHours();
  state.clockM = now.getMinutes();
  state.clockS = now.getSeconds();
}
function applyButtonGlow(){
  const ui = document.getElementById('paaudio-root');
  if(!ui) return;
  if(!state.power){
    ui.style.setProperty('--btn-text', '#c3ccd6');
    ui.style.setProperty('--btn-glow', 'transparent');
    return;
  }
  const idx = state.btnColor|0;
  let color;
  if(idx >= BTN_COLORS.length){ color = `hsl(${(state.frame*0.6)%360}, 100%, 62%)`; }
  else color = BTN_COLORS[idx].css;
  ui.style.setProperty('--btn-text', color);
  ui.style.setProperty('--btn-glow', color);
}
function update(dt){
  state.frame++;
  syncClock();
  
  // YTMの実際のモードを毎フレーム読む（表示と同期させる）
  if(state.power && state.phase === 'run'){
    const ytmMode = readYTMMode();
    if(ytmMode !== state.playMode) state.playMode = ytmMode;
    
    // 曲検知ポーリング（毎フレーム、タイトルが変わったら更新）
    const info = readYTMInfo();
    if(info && info.title && info.title !== state._lastTitle){
      console.log('[PAAUDIO] track changed:', info.title);
      state._lastTitle = info.title;
      refreshFromYTM();
      state.trackAnim = 1.2;
    }
  }
  
  if(state.phase === 'boot'){
    state.bootT += dt;
    if(state.bootT > T_TRANS_END){ state.phase='run'; state.screen='main'; }
  } else if(state.phase === 'shutdown'){
    state.bootT += dt;
    if(state.bootT > 1.2){
      state.phase='off'; state.power=false;
      clearFB(0); glowBuf.fill(0);
      if(pwrLedEl) pwrLedEl.classList.remove('on');
    }
  }
  if(state.volAnim > 0){ state.volAnim -= dt; if(state.volAnim<0) state.volAnim=0; }
  if(state.seekAnim > 0){ state.seekAnim -= dt; if(state.seekAnim<0) state.seekAnim=0; }
  applyButtonGlow();
  if(fadeT > 0){ fadeT -= dt; if(fadeT<0) fadeT=0; }
  if(state.phase === 'run' && state.screen === 'main' && state.demoOn){
    state.demoViz = (state.demoViz||0) + dt;
    if(state.demoViz > 4){
      state.demoViz = 0;
      state.viz = (state.viz + 1) % (VIZ_FUNCS.length-1);
    }
  }
  if(mediaLedEl){
    if(!bridgePaused && bridgeDur > 0) mediaLedEl.classList.add('on');
    else mediaLedEl.classList.remove('on');
  }
  if(eqLedEl){
    let active=false;
    for(let i=0;i<13;i++) if(state.eq[i]!==0){active=true;break;}
    if(active) eqLedEl.classList.add('on'); else eqLedEl.classList.remove('on');
  }
  if(demoLedEl){
    if(state.demoOn) demoLedEl.classList.add('on'); else demoLedEl.classList.remove('on');
  }
  isPlaying = !bridgePaused;
}
function draw(){
  if(state.phase === 'off'){ clearFB(0); return; }
  if(state.phase === 'boot' || state.phase === 'shutdown'){
    if(state.phase === 'shutdown'){
      clearFB(0);
      const p = clamp(1 - state.bootT/1.2, 0, 1);
      const h = Math.floor(H*p*p);
      if(h > 0){
        const y = Math.floor((H-h)/2);
        for(let j=0;j<h;j++) for(let i=0;i<W;i++){
          const d = Math.abs(j-h/2);
          pset(i, y+j, d<1?3:(d<2?6:1));
        }
      }
      if(p > 0.5) drawTextCenter(L('SEE YOU','さようなら'), W/2, 52, 3, 0);
      return;
    }
    if(state.bootT < T_DSPR_END) drawBoot();
    else drawBootTransition();
    return;
  }
  switch(state.screen){
    case 'main': drawMain(); break;
    case 'menu': drawMenu(); break;
    case 'eq': drawEQ(); break;
    case 'test': drawTest(); break;
    case 'queue': drawQueue(); break;
    default: drawMain();
  }
  if(fadeT > 0) drawFadeOverlay();
  if(state.seekAnim > 0) drawSeekOverlay();
  else if(state.volAnim > 0) drawVolumeOverlay();
}

/* ==================== INPUT ==================== */
function pressKey(k){
  if(k === 'POWER'){
    if(state.phase === 'off'){
      initSE();
      if(actxSE && actxSE.state === 'suspended') actxSE.resume();
      state.power=true; state.phase='boot'; state.bootT=0;
      state.screen='main'; state.stack=['root']; state.menuIdx=0;
      if(pwrLedEl) pwrLedEl.classList.add('on');
      seBt5();
    } else {
      stopAllAudio();
      state.phase='shutdown'; state.bootT=0;
      seSd5();
    }
    return;
  }
  if(state.phase !== 'run') return;
  if(k==='UP'||k==='RIGHT') seUp3();
  else if(k==='DOWN'||k==='LEFT') seDn3();
  else seNm3();
  switch(k){
    case 'MENU':
      if(state.screen === 'menu'){
        fadeTransition(()=>{ state.screen='main'; state.stack=['root']; state.menuIdx=0; });
      } else {
        fadeTransition(()=>{ state.stack=['root']; state.menuIdx=0; state.screen='menu'; });
      }
      break;
    case 'DISPLAY':
      if(state.screen === 'main'){
        state.displayPage = (state.displayPage + 1) % 4;
      } else if(state.screen === 'test'){ state.screen='main'; }
      break;
    case 'VIZ':
      // VIZはビジュアライザを変えるだけ（DISPページは変更しない）
      if(state.screen === 'main' || state.screen === 'menu'){
        state.viz = (state.viz + 1) % VIZ_FUNCS.length;
      }
      break;
    case 'MODE': {
      const clicked = ytmModeClick();
      if (clicked) {
        // YTMのリピート状態を読み取って表示を更新
        setTimeout(() => {
          const mode = readYTMMode();
          state.playMode = mode;
          scheduleSave();
        }, 200);
      } else {
        // YTMのボタンが見つからない場合は内部モードだけ進める
        state.playMode = (state.playMode + 1) % PLAY_MODES.length;
        scheduleSave();
      }
      break;
    }
        case 'BAND': {
      if(state.screen === 'queue'){
        fadeTransition(()=>{ state.screen='main'; });
        break;
      }
      ytmQueueCache = readYTMQueue();
      console.log('[PAAUDIO] BAND pressed, initial items:', ytmQueueCache.length);
      
      if(ytmQueueCache.length === 0){
        openYTMQueue();
        let tries = 0;
        const poll = setInterval(()=>{
          tries++;
          ytmQueueCache = readYTMQueue();
          console.log('[PAAUDIO] poll', tries, 'items:', ytmQueueCache.length);
          if(ytmQueueCache.length > 0 || tries > 15){
            clearInterval(poll);
            const s = ytmQueueCache.findIndex(it=>it.selected);
            ytmQueueSelected = s>=0?s:0;
            ytmQueueScroll = 0;
          }
        }, 200);
      } else {
        const s = ytmQueueCache.findIndex(it=>it.selected);
        ytmQueueSelected = s>=0?s:0;
        ytmQueueScroll = 0;
      }
      fadeTransition(()=>{ state.screen='queue'; });
      break;
    }
    case 'ENTER': handleEnter(); break;
    case 'BACK': handleBack(); break;
    case 'UP': case 'DOWN': case 'LEFT': case 'RIGHT': handleDirection(k); break;
  }
  scheduleSave();
}
function readYTMMode(){
  const bar = document.querySelector('ytmusic-player-bar');
  if (!bar) return 0;
  
  // 属性 repeat-mode を読む（NONE / ALL / ONE / SHUFFLE）
  const mode = (bar.getAttribute('repeat-mode') || 'NONE').toUpperCase();
  console.log('[PAAUDIO] repeat-mode:', mode);
  
  if (mode === 'ONE')     return 2; // REPEAT 1
  if (mode === 'ALL')     return 1; // REPEAT ALL
  return 0;                         // NORMAL
}
function handleEnter(){
  if(state.screen === 'queue'){ playQueueItem(ytmQueueSelected); return; }
  if(state.screen === 'main'){
    togglePlayPause();
    return;
  }
  if(state.screen === 'eq' || state.screen === 'test'){
    fadeTransition(()=>{ state.screen='menu'; }); return;
  }
  if(state.screen === 'menu'){
    const m = curMenu();
    const it = m.items[state.menuIdx];
    if(!it) return;
    if(it.t === 'sub') enterMenu(it.to);
    else if(it.t === 'act') it.act();
    else if(it.t === 'sel'){ state[it.key] = ((state[it.key]|0)+1)%it.opts.length; applyMenuSideEffect(it); }
    else if(it.t === 'num'){ let v=(state[it.key]|0)+it.step; if(v>it.max) v=it.min; state[it.key]=v; applyMenuSideEffect(it); }
  }
  scheduleSave();
}
function handleBack(){
  if(state.screen === 'queue'){ fadeTransition(()=>{ state.screen='main'; }); return; }
  if(state.screen === 'main'){
    fadeTransition(()=>{ state.stack=['root']; state.menuIdx=0; state.screen='menu'; });
    return;
  }
  if(state.screen === 'eq' || state.screen === 'test'){ fadeTransition(()=>{ state.screen='menu'; }); return; }
  if(state.screen === 'menu') menuBack();
}
function handleDirection(k){
  const d = (k==='UP')?-1:(k==='DOWN')?1:0;
  const h = (k==='LEFT')?-1:(k==='RIGHT')?1:0;
  if(state.screen === 'queue'){
    const total = ytmQueueCache.length;
    if(d!==0 && total>0) ytmQueueSelected = (ytmQueueSelected + d + total) % total;
    return;
  }
  if(state.screen === 'main'){
    if(h !== 0){
      // 短押し: 前/次の曲
      nextTrack(h);
    }
    if(d !== 0){
      changeVolume(-d);
    }
    return;
  }
  if(state.screen === 'menu'){
    const m = curMenu();
    const nItems = m.items.length;
    if(d !== 0){ state.menuIdx = (state.menuIdx + d + nItems) % nItems; return; }
    const it = m.items[state.menuIdx];
    if(!it) return;
    if(it.t === 'sel'){ state[it.key] = ((state[it.key]|0)+h+it.opts.length)%it.opts.length; applyMenuSideEffect(it); }
    else if(it.t === 'num'){
      let v=(state[it.key]|0)+h*it.step;
      if(v>it.max) v=it.min;
      if(v<it.min) v=it.max;
      state[it.key]=v; applyMenuSideEffect(it);
    } else if(it.t === 'sub'){ if(h===1) enterMenu(it.to); }
    scheduleSave();
    return;
  }
  if(state.screen === 'eq'){
    if(h !== 0) state.eqBand = (state.eqBand + h + 13) % 13;
    if(d !== 0){
      let nv = state.eq[state.eqBand] - d;
      if(nv > 12) nv = -12;
      if(nv < -12) nv = 12;
      setEqBand(state.eqBand, nv);
      ytmCmd('eq', state.eq);
    }
    scheduleSave();
    return;
  }
}
function applyMenuSideEffect(it){
  if(!it) return;
  if(it.key==='bass'||it.key==='mid'||it.key==='treble') applyEqGroups();
  else if(it.key==='eqPreset'){
    const p = EQ_PRESETS[state.eqPreset]||EQ_PRESETS[0];
    for(let i=0;i<13;i++) setEqBand(i, p[i]);
    ytmCmd('eq', state.eq);
  }
  else if(it.key==='volume'){ ytmCmd('volume', state.volume/40); }
}

/* Long-hold seek */
const HOLD_DELAY_MS=450, HOLD_REPEAT_MS=180, SEEK_STEP=10;
let holdTimer=null, holdInterval=null, holdFired=false;
function canLongSeek(){
  return state.phase==='run' && state.screen==='main'
    && bridgeDur > 0 && !bridgePaused;
}
function beginHold(k){
  if(holdTimer) clearTimeout(holdTimer);
  if(holdInterval) clearInterval(holdInterval);
  holdFired = false;
  holdTimer = setTimeout(()=>{
    holdTimer = null; holdFired = true;
    seekBySeconds(k==='RIGHT' ? SEEK_STEP : -SEEK_STEP);
    holdInterval = setInterval(()=>{ seekBySeconds(k==='RIGHT' ? SEEK_STEP : -SEEK_STEP); }, HOLD_REPEAT_MS);
  }, HOLD_DELAY_MS);
}
function endHold(){
  if(holdTimer){ clearTimeout(holdTimer); holdTimer=null; }
  if(holdInterval){ clearInterval(holdInterval); holdInterval=null; }
  const f = holdFired; holdFired = false; return f;
}

/* ==================== LOCAL STORAGE ==================== */
const LS_KEY = 'PAAUDIO_PAA100_YTM';
const PERSIST_KEYS = ['theme','bright','contrast','viz','clock24','scrollOn','demoOn','btnColor','beep','lang','volume','position','eq','eqPreset','bass','mid','treble','preGain','playMode','displayPage'];
let _saveTimer = null;

function scheduleSave(){
  if(_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveSettings, 250);
}

function saveSettings(){
  try{
    const obj = {};
    PERSIST_KEYS.forEach(k=>{
      const v = state[k];
      obj[k] = Array.isArray(v) ? v.slice() : v;
    });
    // chrome.storage.local を使用（より確実に保存される）
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [LS_KEY]: obj });
    } else {
      // フォールバック: localStorage
      localStorage.setItem(LS_KEY, JSON.stringify(obj));
    }
  }catch(e){ console.warn('[PAAUDIO] save failed', e); }
}

function loadSettings(callback){
  const restore = (obj) => {
    if (!obj) { if (callback) callback(); return; }
    PERSIST_KEYS.forEach(k=>{
      if(obj[k] !== undefined && obj[k] !== null){
        const cur = state[k];
        if(Array.isArray(cur) && Array.isArray(obj[k])){
          for(let i=0;i<Math.min(cur.length, obj[k].length);i++){
            const n = Number(obj[k][i]);
            if(isFinite(n)) cur[i]=n;
          }
        } else if(typeof cur === 'number'){
          const n = Number(obj[k]);
          if(isFinite(n)) state[k]=n;
        } else {
          state[k]=obj[k];
        }
      }
    });
    if (callback) callback();
  };

  // chrome.storage.local から読み込み
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([LS_KEY], (result) => {
      if (result && result[LS_KEY]) {
        restore(result[LS_KEY]);
      } else {
        // フォールバック: localStorage
        try {
          const raw = localStorage.getItem(LS_KEY);
          if (raw) restore(JSON.parse(raw));
          else restore(null);
        } catch(e) { restore(null); }
      }
    });
  } else {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) restore(JSON.parse(raw));
      else restore(null);
    } catch(e) { restore(null); }
  }
}

/* ==================== LOOP ==================== */
let lastTick = performance.now();
const FRAME_MS = 1000/15;
function loop(now){
  requestAnimationFrame(loop);
  const elapsed = now - lastTick;
  if(elapsed < FRAME_MS) return;
  const dt = Math.min(0.25, elapsed/1000);
  lastTick = now;
  update(dt);
  draw();
  present();
}

/* ==================== UI INJECTION ==================== */
function injectUI(){
  if(document.getElementById('paaudio-root')) return;
  const style = document.createElement('style');
  style.textContent = 'ytmusic-player-bar{display:none!important}';
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'paaudio-root';
  root.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;justify-content:center;pointer-events:none;';
  document.body.appendChild(root);
  const shadow = root.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
<style>
:host{--btn-text:#c3ccd6;--btn-glow:transparent;}
*{box-sizing:border-box;}
.stage{width:min(calc(100vw - 40px),calc((100vh - 40px)*1.8),1180px);aspect-ratio:18/10;position:relative;margin:0 auto;pointer-events:auto;}
.unit{position:absolute;top:0;left:0;width:1180px;aspect-ratio:18/10;transform-origin:0 0;transform:scale(var(--unit-scale,1));border-radius:14px;padding:14px 16px 16px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.018) 0 1px,rgba(0,0,0,.02) 1px 3px),linear-gradient(180deg,#4a4f56 0%,#2e3238 6%,#24272c 22%,#1c1f23 50%,#22262b 78%,#141619 100%);box-shadow:0 1px 0 rgba(255,255,255,.22) inset,0 -1px 0 rgba(0,0,0,.7) inset,0 24px 60px rgba(0,0,0,.85),0 4px 14px rgba(0,0,0,.6);border:1px solid #0b0c0e;display:flex;flex-direction:column;font-family:"Helvetica Neue",Arial,"Hiragino Kaku Gothic ProN",sans-serif;color:#cfd6dd;}
.unit::after{content:"";position:absolute;inset:0;border-radius:14px;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.07),transparent 40%);}
.brandbar{display:flex;align-items:baseline;gap:10px;padding:0 4px 10px;border-bottom:1px solid rgba(0,0,0,.6);box-shadow:0 1px 0 rgba(255,255,255,.06);margin-bottom:12px;}
.brand{font-size:15px;font-weight:800;letter-spacing:.34em;color:#d8dee5;text-shadow:0 1px 0 #000,0 0 10px rgba(120,190,255,.25);}
.model{font-size:11px;letter-spacing:.22em;color:#8d97a2;border-left:1px solid #454b52;padding-left:10px;}
.sub{font-size:9px;letter-spacing:.28em;color:#5f6a76;margin-left:auto;}
.leds{display:flex;gap:6px;margin-left:12px;}
.led{width:6px;height:6px;border-radius:50%;background:#1a1d21;box-shadow:0 0 0 1px #000 inset,0 0 2px rgba(0,0,0,.9);transition:background .15s,box-shadow .15s;}
.led.on{background:#37e0ff;box-shadow:0 0 6px #37e0ff,0 0 14px rgba(55,224,255,.6),0 0 0 1px #0a2a33 inset;}
.led.amber.on{background:#ffb03a;box-shadow:0 0 6px #ffb03a,0 0 14px rgba(255,176,58,.6);}
.led.green.on{background:#5aff9e;box-shadow:0 0 6px #5aff9e,0 0 14px rgba(90,255,158,.6);}
.led.pink.on{background:#ff6fd8;box-shadow:0 0 6px #ff6fd8,0 0 14px rgba(255,111,216,.6);}
.screenWrap{padding:0 4px 14px;}
.screenBezel{position:relative;border-radius:8px;padding:8px;background:linear-gradient(180deg,#0b0c0e,#050607 60%,#0d0f11);box-shadow:0 2px 6px rgba(0,0,0,.9) inset,0 0 0 1px #000,0 1px 0 rgba(255,255,255,.12);overflow:hidden;}
.screenInner{position:relative;border-radius:3px;overflow:hidden;background:#000306;box-shadow:0 0 0 1px #000 inset,0 0 22px rgba(0,120,180,.14) inset;}
canvas#cvs,canvas#glow{display:block;width:100%;height:auto;image-rendering:pixelated;image-rendering:crisp-edges;aspect-ratio:480/120;}
canvas#glow{position:absolute;inset:0;filter:blur(6px) saturate(1.5);opacity:.75;mix-blend-mode:screen;pointer-events:none;}
.scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,rgba(0,0,0,0) 0px,rgba(0,0,0,0) 1px,rgba(0,0,0,.30) 1px,rgba(0,0,0,.30) 2px);mix-blend-mode:multiply;opacity:.65;}
.dotmask{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(rgba(0,0,0,.55) 0.5px,transparent 0.6px);background-size:2px 2px;opacity:.5;}
.vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 45%,rgba(0,0,0,.55) 100%);}
.glare{position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.055) 0%,rgba(255,255,255,0) 42%);}
.panel{margin-top:4px;padding:12px 6px 6px;border-top:1px solid rgba(0,0,0,.65);box-shadow:0 -1px 0 rgba(255,255,255,.06) inset;}
.btnrow{display:grid;gap:8px;margin-bottom:9px;}
.row1{grid-template-columns:repeat(6,1fr);}
button.k{-webkit-tap-highlight-color:transparent;touch-action:none;appearance:none;position:relative;border:1px solid #0a0c0e;border-radius:6px;padding:12px 2px 11px;font-family:inherit;font-size:10.5px;font-weight:700;letter-spacing:.09em;color:var(--btn-text);background:linear-gradient(180deg,#41464d 0%,#2c3036 18%,#212429 55%,#1a1d21 100%);box-shadow:0 1px 0 rgba(255,255,255,.20) inset,0 -2px 3px rgba(0,0,0,.55) inset,0 3px 0 #0c0e10,0 5px 8px rgba(0,0,0,.55);cursor:pointer;user-select:none;transition:transform .04s linear,box-shadow .04s linear,background .04s linear,color .08s linear;text-shadow:0 1px 0 #000,0 0 5px var(--btn-glow),0 0 11px var(--btn-glow);min-height:44px;}
button.k:hover{background:linear-gradient(180deg,#4a5058 0%,#33383f 18%,#262a30 55%,#1e2126 100%);}
button.k:active,button.k.press{transform:translateY(3px);box-shadow:0 1px 0 rgba(255,255,255,.10) inset,0 -1px 2px rgba(0,0,0,.7) inset,0 0 0 #0c0e10,0 1px 2px rgba(0,0,0,.5);background:linear-gradient(180deg,#2a2e34,#1c1f23);color:var(--btn-text);text-shadow:0 1px 0 #000,0 0 8px var(--btn-glow),0 0 18px var(--btn-glow);}
button.k .sm{display:block;font-size:8px;letter-spacing:.16em;color:currentColor;opacity:.45;margin-top:2px;font-weight:600;}
button.k.arrow{font-size:15px;letter-spacing:0;padding:10px 2px;}
.rowControl{display:grid;grid-template-columns:4fr 2.2fr;gap:10px;margin-bottom:9px;}
.dpad{display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr;grid-template-areas:". up ." "left down right";gap:6px;}
.dpad [data-k="UP"]{grid-area:up;}.dpad [data-k="LEFT"]{grid-area:left;}.dpad [data-k="DOWN"]{grid-area:down;}.dpad [data-k="RIGHT"]{grid-area:right;}
.rowControlRight{display:grid;grid-template-rows:1fr 1fr;gap:6px;}
</style>
<div class="stage"><div class="unit">
<div class="brandbar">
<div class="brand">PAAUDIO</div><div class="model">PAA-100</div>
<div class="sub">OEL SOUND STATION &nbsp;/&nbsp; YTM</div>
<div class="leds">
<div class="led" id="ledPwr"></div><div class="led amber" id="ledMedia"></div>
<div class="led green" id="ledEq"></div><div class="led pink" id="ledDemo"></div>
</div></div>
<div class="screenWrap"><div class="screenBezel"><div class="screenInner">
<canvas id="cvs" width="720" height="180"></canvas>
<canvas id="glow" width="720" height="180"></canvas>
<div class="dotmask"></div><div class="scan"></div><div class="glare"></div><div class="vig"></div>
</div></div></div>
<div class="panel">
<div class="btnrow row1">
<button class="k" data-k="POWER">POWER<span class="sm">P</span></button>
<button class="k" data-k="BAND">BAND<span class="sm">B</span></button>
<button class="k" data-k="MENU">MENU<span class="sm">M</span></button>
<button class="k" data-k="DISPLAY">DISP<span class="sm">D</span></button>
<button class="k" data-k="MODE">MODE<span class="sm">R</span></button>
<button class="k" data-k="VIZ">VIZ<span class="sm">V</span></button>
</div>
<div class="rowControl">
<div class="dpad">
<button class="k arrow" data-k="UP">▲<span class="sm">↑</span></button>
<button class="k arrow" data-k="LEFT">◀<span class="sm">←</span></button>
<button class="k arrow" data-k="DOWN">▼<span class="sm">↓</span></button>
<button class="k arrow" data-k="RIGHT">▶<span class="sm">→</span></button>
</div>
<div class="rowControlRight">
<button class="k" data-k="ENTER">ENTER<span class="sm">RET</span></button>
<button class="k" data-k="BACK">BACK<span class="sm">ESC</span></button>
</div>
</div>
</div></div></div>
`;

  cvs = shadow.getElementById('cvs');
  gcv = shadow.getElementById('glow');
  ctx = cvs.getContext('2d');
  gctx = gcv.getContext('2d');
  imgData = ctx.createImageData(PW, PH);
  gImgData = gctx.createImageData(PW, PH);
  pwrLedEl = shadow.getElementById('ledPwr');
  mediaLedEl = shadow.getElementById('ledMedia');
  eqLedEl = shadow.getElementById('ledEq');
  demoLedEl = shadow.getElementById('ledDemo');

  (function(){
    const st = shadow.querySelector('.stage');
    const fit = ()=>{ const s = st.clientWidth / 1180; root.style.setProperty('--unit-scale', s.toFixed(5)); };
    window.addEventListener('resize', fit);
    setTimeout(fit, 50);
  })();

  shadow.querySelectorAll('button.k').forEach(btn=>{
    const k = btn.dataset.k;
    if(k === 'LEFT' || k === 'RIGHT'){
      let mode = null;
      btn.addEventListener('pointerdown', e=>{
        e.preventDefault();
        if(mode) return;
        try{ btn.setPointerCapture(e.pointerId); }catch(_){}
        btn.classList.add('press');
        if(canLongSeek()){ mode='hold'; beginHold(k); }
        else { mode='short'; pressKey(k); }
      });
      const finish = ()=>{
        btn.classList.remove('press');
        if(mode === 'hold'){ const f = endHold(); if(!f) pressKey(k); }
        mode = null;
      };
      btn.addEventListener('pointerup', finish);
      btn.addEventListener('pointercancel', finish);
      btn.addEventListener('contextmenu', e=>e.preventDefault());
    } else {
      btn.addEventListener('click', ()=>{ pressKey(k); });
      btn.addEventListener('contextmenu', e=>e.preventDefault());
    }
  });

  const KEYMAP = {
    'p':'POWER','b':'BAND','m':'MENU','d':'DISPLAY','r':'MODE','v':'VIZ',
    'arrowleft':'LEFT','arrowright':'RIGHT','arrowup':'UP','arrowdown':'DOWN',
    'enter':'ENTER','escape':'BACK','backspace':'BACK',' ':'ENTER'
  };
  const heldKeyMode = new Map();
  window.addEventListener('keydown', e=>{
    if(e.target && (e.target.tagName === 'INPUT' || e.target.isContentEditable)) return;
    const k = e.key.toLowerCase();
    const mapped = KEYMAP[k];
    if(!mapped) return;
    e.preventDefault();
    if(e.repeat) return;
    if(heldKeyMode.has(mapped)) return;
    if(mapped === 'LEFT' || mapped === 'RIGHT'){
      if(canLongSeek()){ heldKeyMode.set(mapped, 'hold'); beginHold(mapped); }
      else { heldKeyMode.set(mapped, 'short'); pressKey(mapped); }
    } else {
      heldKeyMode.set(mapped, 'short');
      pressKey(mapped);
    }
  });
  window.addEventListener('keyup', e=>{
    const k = e.key.toLowerCase();
    const mapped = KEYMAP[k];
    if(!mapped) return;
    const mode = heldKeyMode.get(mapped);
    if(!mode) return;
    heldKeyMode.delete(mapped);
    if(mode === 'hold'){ const f = endHold(); if(!f) pressKey(mapped); }
  });

  state.stack = ['root'];
  glowBuf.fill(0);
  const warm = '音量時計表示起動中完了再生停止選局放送入力設定前左右後部運転席低音中高音';
  for(let i=0;i<warm.length;i++){ try{ getCJKBitmap(warm[i], CJK_PHYS); }catch(e){} }
  loadSettings(() => {
    syncClock();
    applyButtonGlow();
    clearFB(0);
    requestAnimationFrame(loop);
  });
}
/* ==================== START ==================== */
function waitAndStart(){
  if(!document.body || !document.querySelector('video')){
    return setTimeout(waitAndStart, 500);
  }
  injectUI();
  refreshFromYTM();
  const bar = document.querySelector('ytmusic-player-bar');
  if(bar){
    let lastTitle = '';
    new MutationObserver(()=>{
      const info = readYTMInfo();
      if(!info || !info.title) return;
      if(info.title !== lastTitle){
        lastTitle = info.title;
        refreshFromYTM();
        state.trackAnim = 1.2;
      }
    }).observe(bar, {subtree:true, childList:true, characterData:true});
  }
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', waitAndStart);
} else {
  waitAndStart();
}

})();