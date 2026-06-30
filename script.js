// ─── FIREBASE IMPORTS ───
import { loginWithGoogle, logout, onAuthChange, pushToCloud, pullFromCloud, mergeWithCloud,
  validateUsername, isUsernameAvailable, claimUsername, getMyProfile,
  searchUserByUsername, findUserByFriendCode, sendFriendRequest, listFriendRequests,
  listenFriendRequests, acceptFriendRequest, rejectFriendRequest, removeFriend, getFriendsList,
  addFriendToMyList,
  CHALLENGE_TYPES, createChallenge, listMyChallenges, listenMyChallenges, acceptChallenge,
  declineChallenge, deleteChallenge, updateChallengeProgress, finishChallenge, listenChallenge }
  from './firebase.js';

// ══════════════════════════════════════════════════════════
// AUDIO
// ══════════════════════════════════════════════════════════
const AudioCtx=window.AudioContext||window.webkitAudioContext;let audioCtx=null;
function getAudio(){if(!audioCtx)audioCtx=new AudioCtx();return audioCtx;}
function playStarSound(n=1){try{const ctx=getAudio();
  const freqs=n===1?[523.25,659.25,783.99,1046.50]:n===2?[523.25,659.25,783.99,1046.50,1318.51]:n===3?[392,523.25,659.25,783.99,1046.50,1318.51,1567.98]:[261.63,392,523.25,659.25,783.99,1046.50,1318.51,1567.98,2093];
  freqs.forEach((freq,i)=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.type='sine';osc.frequency.setValueAtTime(freq,ctx.currentTime+i*0.09);gain.gain.setValueAtTime(0.22+n*0.04,ctx.currentTime+i*0.09);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.09+0.28);osc.start(ctx.currentTime+i*0.09);osc.stop(ctx.currentTime+i*0.09+0.32);});}catch(e){}}

// ══════════════════════════════════════════════════════════
// GLOBALS
// ══════════════════════════════════════════════════════════
const COLORS=['#7F77DD','#1D9E75','#378ADD','#D85A30','#BA7517','#D4537E','#639922','#888780','#e24b4a','#5DCAA5','#EF9F27','#534AB7'];
let selectedColor=COLORS[0],editColor=COLORS[0],editingId=null,activities=[],todayKey='';
let calViewYear=new Date().getFullYear(),calViewMonth=new Date().getMonth();
let confirmCallback=null;
let currentUser=null; // Firebase user object

// ══════════════════════════════════════════════════════════
// PWA — Service Worker + Install Banner
// ══════════════════════════════════════════════════════════
let deferredInstallPrompt=null;

function registerSW(){
  if(!('serviceWorker' in navigator))return;
  navigator.serviceWorker.register('/DesafioHV9/service-worker.js').then(reg=>{
    console.log('[SW] registrado:', reg.scope);
    scheduleNotifications(reg);
  }).catch(e=>console.warn('[SW] error:', e));
}

window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault();
  deferredInstallPrompt=e;
  if(!localStorage.getItem('dhv_pwa_dismissed')){
    document.getElementById('pwa-banner').classList.add('show');
  }
});

window.addEventListener('appinstalled', ()=>{
  document.getElementById('pwa-banner').classList.remove('show');
  localStorage.setItem('dhv_pwa_installed','1');
  showToast('✅ App instalada exitosamente');
});

document.getElementById('pwa-install-btn').addEventListener('click', async ()=>{
  if(!deferredInstallPrompt)return;
  deferredInstallPrompt.prompt();
  const {outcome}=await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;
  document.getElementById('pwa-banner').classList.remove('show');
  if(outcome==='accepted')showToast('🎉 ¡Instalando DesafioHV!');
});

document.getElementById('pwa-dismiss-btn').addEventListener('click', ()=>{
  document.getElementById('pwa-banner').classList.remove('show');
  localStorage.setItem('dhv_pwa_dismissed','1');
});

// ══════════════════════════════════════════════════════════
// NOTIFICACIONES PUSH
// ══════════════════════════════════════════════════════════
async function requestNotifPermission(){
  if(!('Notification' in window))return false;
  if(Notification.permission==='granted')return true;
  const result=await Notification.requestPermission();
  return result==='granted';
}

function scheduleNotifications(swReg){
  if(Notification.permission!=='granted')return;
  // Recordatorio diario a las 20:00 si no llegaste al 100%
  const now=new Date();
  const remind=new Date(now.getFullYear(),now.getMonth(),now.getDate(),20,0,0);
  let delay=remind-now;
  if(delay<0)delay+=86400000; // mañana

  if(swReg&&swReg.active){
    swReg.active.postMessage({
      type:'SCHEDULE_REMINDER',
      delayMs:delay,
      title:'DesafioHV ⭐ — Recordatorio',
      body:'Son las 20:00. ¿Completaste tus actividades de hoy?'
    });
  }
}

// Mostrar card de notificaciones en la vista "Hoy" si no están activadas
function renderNotifCard(){
  const existing=document.getElementById('notif-card');if(existing)existing.remove();
  if(!('Notification' in window))return;
  if(Notification.permission==='granted'){
    const card=document.createElement('div');
    card.id='notif-card';card.className='notif-card';
    card.innerHTML=`<div class="notif-card-icon">🔔</div><div class="notif-card-text"><div class="notif-card-title">Notificaciones activas</div><div class="notif-card-sub">Te avisamos a las 20:00 si no terminaste el día.</div></div><span class="notif-enabled-badge">✓ Activadas</span>`;
    document.getElementById('main').insertBefore(card,document.getElementById('main').firstChild);
    return;
  }
  if(Notification.permission==='denied')return;
  const card=document.createElement('div');
  card.id='notif-card';card.className='notif-card';
  card.innerHTML=`<div class="notif-card-icon">🔔</div><div class="notif-card-text"><div class="notif-card-title">Activá las notificaciones</div><div class="notif-card-sub">Te avisamos antes de que venza tu racha.</div></div><button class="notif-enable-btn" onclick="enableNotifs()">Activar</button>`;
  document.getElementById('main').insertBefore(card,document.getElementById('main').firstChild);
}

window.enableNotifs=async function(){
  const granted=await requestNotifPermission();
  if(granted){
    showToast('🔔 Notificaciones activadas');
    navigator.serviceWorker.ready.then(reg=>scheduleNotifications(reg));
  }else{
    showToast('⚠️ Permiso denegado en el navegador');
  }
  renderNotifCard();
};

// ══════════════════════════════════════════════════════════
// GOOGLE AUTH UI
// ══════════════════════════════════════════════════════════
function showAuthScreen(){
  document.getElementById('auth-screen').style.display='flex';
  hideLoadingScreen();
}
function hideAuthScreen(){
  document.getElementById('auth-screen').style.display='none';
}

document.getElementById('btn-google-login').addEventListener('click', async ()=>{
  let user;
  try{
    user=await loginWithGoogle();
  }catch(e){
    console.error('[login error]',e);
    showToast('❌ Error al iniciar sesión. Intentá de nuevo.');
    return;
  }
  // Login exitoso: a partir de acá cualquier error es solo de sincronización
  hideAuthScreen();
  showToast('✅ Bienvenido, '+user.displayName.split(' ')[0]+'!');
  try{
    const result=await mergeWithCloud(user.uid);
    if(result==='pulled'){
      loadData();render();
      showToast('☁️ Progreso restaurado desde la nube');
    } else {
      showSyncIndicator();
    }
  }catch(e){
    console.error('[sync error]',e);
    showToast('⚠️ Sesión iniciada, pero hubo un problema al sincronizar');
  }
});

document.getElementById('auth-skip-btn').addEventListener('click', ()=>{
  localStorage.setItem('dhv_auth_skipped','1');
  hideAuthScreen();
  initApp();
});

// ══════════════════════════════════════════════════════════
// SYNC INDICATOR
// ══════════════════════════════════════════════════════════
function showSyncIndicator(){
  const el=document.getElementById('sync-indicator');
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2200);
}

// Auto-sync cada vez que se guarda data
async function autoSync(){
  if(!currentUser)return;
  try{
    await pushToCloud(currentUser.uid);
    showSyncIndicator();
  }catch(e){console.warn('[sync] error:',e);}
}

window.manualSync=async function(){
  if(!currentUser){showToast('⚠️ Iniciá sesión para sincronizar');return;}
  showToast('☁️ Sincronizando...');
  try{
    await pushToCloud(currentUser.uid);
    showToast('✅ Progreso guardado en la nube');
  }catch(e){showToast('❌ Error al sincronizar');}
};

// ══════════════════════════════════════════════════════════
// DRAWER USER CHIP
// ══════════════════════════════════════════════════════════
function renderDrawerUser(user){
  const slot=document.getElementById('drawer-user-slot');
  if(!user){slot.innerHTML='';return;}
  const avatarHtml=user.photoURL
    ?`<img src="${user.photoURL}" alt="avatar"/>`
    :`<span>${user.displayName?user.displayName[0].toUpperCase():'U'}</span>`;
  const displayLine = (myProfile && myProfile.username) ? '@'+myProfile.username : (user.displayName||'Usuario');
  const subLine = (myProfile && myProfile.username) ? (user.displayName||user.email||'') : (user.email||'');
  slot.innerHTML=`
    <div class="drawer-user">
      <div class="drawer-user-avatar">${avatarHtml}</div>
      <div class="drawer-user-info">
        <div class="drawer-user-name">${displayLine}</div>
        <div class="drawer-user-email">${subLine}</div>
      </div>
      <button class="btn-logout" onclick="handleLogout()">Salir</button>
    </div>`;
}

window.handleLogout=async function(){
  openConfirm('Cerrar sesión','Tu progreso quedará guardado en la nube.',async ()=>{
    await logout();
    showToast('👋 Sesión cerrada');
  },'Cerrar sesión');
};

// ══════════════════════════════════════════════════════════
// DÍAS DE SEMANA
// ══════════════════════════════════════════════════════════
const DAY_NAMES=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const DAY_NAMES_FULL=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const ALL_DAYS=[0,1,2,3,4,5,6];

function getRestDay(){const v=localStorage.getItem('dhv_rest_day');return v===null||v===''?null:parseInt(v);}
function setRestDay(v){if(v===null)localStorage.removeItem('dhv_rest_day');else localStorage.setItem('dhv_rest_day',v);}
function isTodayRestDay(){const r=getRestDay();if(r===null)return false;return new Date().getDay()===r;}
function isKeyRestDay(key){const r=getRestDay();if(r===null)return false;const[y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d).getDay()===r;}
function getActDays(act){return act.days&&act.days.length?act.days:ALL_DAYS;}
function actAppliesToday(act){const dow=new Date().getDay();return getActDays(act).includes(dow);}
function actAppliesToKey(act,key){const[y,m,d]=key.split('-').map(Number);const dow=new Date(y,m-1,d).getDay();return getActDays(act).includes(dow);}
function todayActivities(){return activities.filter(a=>actAppliesToday(a));}

let newActDays=[...ALL_DAYS];
let editActDays=[...ALL_DAYS];

function buildDayPicker(containerId,currentDays,onChange){
  const container=document.getElementById(containerId);if(!container)return;
  container.innerHTML=DAY_NAMES.map((name,i)=>`<button type="button" class="day-pill${currentDays.includes(i)?' day-pill-on':''}" data-day="${i}" onclick="toggleDayPill(this,'${containerId}',${i})">${name}</button>`).join('');
}
window.toggleDayPill=function(btn,containerId,day){
  const container=document.getElementById(containerId);
  const pills=[...container.querySelectorAll('.day-pill')];
  const activeDays=pills.filter(p=>p.classList.contains('day-pill-on')).map(p=>parseInt(p.dataset.day));
  if(activeDays.includes(day)){if(activeDays.length===1){showToast('Debe haber al menos 1 día');return;}btn.classList.remove('day-pill-on');}
  else btn.classList.add('day-pill-on');
  const newDays=[...container.querySelectorAll('.day-pill.day-pill-on')].map(p=>parseInt(p.dataset.day)).sort();
  if(containerId==='f-days')newActDays=newDays;
  else if(containerId==='e-days')editActDays=newDays;
};

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function getDateKey(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function getTodayKey(){return getDateKey(new Date());}
function timeToMin(t){if(!t||!t.includes(':'))return 0;const[h,m]=t.split(':').map(Number);return h*60+m;}
function nowMin(){const n=new Date();return n.getHours()*60+n.getMinutes();}
function isSkippedAct(actId){return localStorage.getItem(`dhv_skip_act_${todayKey}_${actId}`)===`1`;}
function setSkippedAct(actId,v){if(v)localStorage.setItem(`dhv_skip_act_${todayKey}_${actId}`,'1');else localStorage.removeItem(`dhv_skip_act_${todayKey}_${actId}`);}
function calcTodayPct(){
  if(isTodayRestDay())return 100;
  const todays=todayActivities();
  if(!todays.length)return 0;
  return Math.round(todays.filter(a=>a.done).length/todays.length*100);
}
function calcSnapPct(snap){
  if(!snap||snap.skipped)return null;
  if(snap.restDay)return 100;
  if(!snap.total)return 0;
  return Math.round((snap.done||0)/snap.total*100);
}

// ══════════════════════════════════════════════════════════
// MODOS
// ══════════════════════════════════════════════════════════
function getMode(){return localStorage.getItem('dhv_mode')||'easy';}
function setMode(m){localStorage.setItem('dhv_mode',m);applyModeTheme(m);}
function applyModeTheme(m){
  document.body.setAttribute('data-mode',m);
  const pill=document.getElementById('streak-pill'),banner=document.getElementById('streak-banner'),sv=document.getElementById('streak-val');
  if(!pill)return;
  if(m==='medium'){pill.style.cssText='background:rgba(250,180,50,0.12);border-color:rgba(250,180,50,0.3);color:#f5c842';if(banner){banner.style.background='linear-gradient(90deg,rgba(245,200,66,0.07),rgba(250,180,50,0.04))';banner.style.borderColor='rgba(245,200,66,0.2)';}if(sv)sv.style.color='#f5c842';}
  else if(m==='hard'){pill.style.cssText='background:rgba(226,75,75,0.12);border-color:rgba(226,75,75,0.3);color:#e24b4b';if(banner){banner.style.background='linear-gradient(90deg,rgba(226,75,75,0.07),rgba(200,50,50,0.04))';banner.style.borderColor='rgba(226,75,75,0.2)';}if(sv)sv.style.color='#e24b4b';}
  else{pill.style.cssText='';if(banner){banner.style.background='';banner.style.borderColor='';}if(sv)sv.style.color='';}
  const mi=document.getElementById('mode-indicator');
  if(mi){const labels={easy:'🟣 Fácil',medium:'🟡 Media',hard:'🔴 Difícil'};mi.textContent=labels[m]||'🟣 Fácil';}
}
function canMark(act){
  const now=nowMin(),s=timeToMin(act.start),e=timeToMin(act.end),mode=getMode();
  if(mode==='easy')return e<s?now>=s||now<e:now>=s;
  else if(mode==='medium'){const endReal=e<=s?e+1440:e,win=endReal+180,nowAdj=(now<s&&e<s)?now+1440:now;return nowAdj>=s&&nowAdj<=win;}
  else{const endReal=e<=s?e+1440:e,win=endReal+30,nowAdj=(now<s&&e<s)?now+1440:now;return nowAdj>=s&&nowAdj<=win;}
}
function isWindowExpired(act){
  const mode=getMode();if(mode==='easy')return false;
  const now=nowMin(),s=timeToMin(act.start),e=timeToMin(act.end),endReal=e<=s?e+1440:e;
  const deadline=endReal+(mode==='hard'?30:180),nowAdj=(now<s&&e<s)?now+1440:now;
  return nowAdj>deadline;
}
function countExpiredPending(){if(getMode()==='easy')return 0;return activities.filter(a=>!a.done&&!isSkippedAct(a.id)&&isWindowExpired(a)).length;}

// ══════════════════════════════════════════════════════════
// DATA (con autoSync)
// ══════════════════════════════════════════════════════════
function loadData(){
  const raw=localStorage.getItem('dhv_activities');activities=raw?JSON.parse(raw):[];
  todayKey=getTodayKey();const lastDay=localStorage.getItem('dhv_day');
  if(lastDay&&lastDay!==todayKey){
    const wasRestDay=isKeyRestDay(lastDay);
    const actsForLastDay=activities.filter(a=>actAppliesToKey(a,lastDay));
    const snap={key:lastDay,total:actsForLastDay.length,done:actsForLastDay.filter(a=>a.done).length,skipped:false,restDay:wasRestDay,acts:activities.map(a=>({id:a.id,name:a.name,color:a.color,done:a.done,manualSkip:localStorage.getItem(`dhv_skip_act_${lastDay}_${a.id}`)===`1`}))};
    saveHistoryDay(snap);activities=activities.map(a=>({...a,done:false}));saveData(false);
  }
  localStorage.setItem('dhv_day',todayKey);
}
function saveData(sync=true){
  localStorage.setItem('dhv_activities',JSON.stringify(activities));
  if(sync)autoSync();
}
function saveHistoryDay(snap){
  const raw=localStorage.getItem('dhv_history');const hist=raw?JSON.parse(raw):[];
  const idx=hist.findIndex(h=>h.key===snap.key);if(idx>=0)hist[idx]=snap;else hist.unshift(snap);
  localStorage.setItem('dhv_history',JSON.stringify(hist));
  autoSync();
}
function getHistory(){return JSON.parse(localStorage.getItem('dhv_history')||'[]');}

// ══════════════════════════════════════════════════════════
// STARS
// ══════════════════════════════════════════════════════════
function getTotalStars(){return parseInt(localStorage.getItem('dhv_total_stars')||'0');}
function addStars(n){localStorage.setItem('dhv_total_stars',Math.max(0,getTotalStars()+n));autoSync();}
function getSpentStars(){return parseInt(localStorage.getItem('dhv_spent_stars')||'0');}
function addSpentStars(n){localStorage.setItem('dhv_spent_stars',getSpentStars()+n);autoSync();}
function getAvailableStars(){return Math.max(0,getTotalStars()-getSpentStars());}
function getInventory(){return JSON.parse(localStorage.getItem('dhv_inventory')||'{"streak_recover":0,"day_shield":0,"next_shield":0,"double_star":0}');}
function saveInventory(inv){localStorage.setItem('dhv_inventory',JSON.stringify(inv));autoSync();}
function getPurchaseHistory(){return JSON.parse(localStorage.getItem('dhv_purchase_hist')||'[]');}
function addPurchaseHistory(entry){const h=getPurchaseHistory();h.unshift(entry);localStorage.setItem('dhv_purchase_hist',JSON.stringify(h.slice(0,30)));autoSync();}
function hasTodayShield(){return localStorage.getItem('dhv_shield_day')===todayKey;}
function hasTomorrowShield(){const d=new Date();d.setDate(d.getDate()+1);return localStorage.getItem('dhv_shield_next')===getDateKey(d);}
function activateTodayShield(){localStorage.setItem('dhv_shield_day',todayKey);}
function activateTomorrowShield(){const d=new Date();d.setDate(d.getDate()+1);localStorage.setItem('dhv_shield_next',getDateKey(d));}

// ══════════════════════════════════════════════════════════
// REWARD POPUP
// ══════════════════════════════════════════════════════════
function showRewardPopup(amount,label){
  const old=document.getElementById('reward-popup');if(old)old.remove();
  const el=document.createElement('div');el.id='reward-popup';el.className='reward-popup';
  el.innerHTML=`<div class="rp-stars">${'⭐'.repeat(amount)}</div><div class="rp-amount">+${amount} estrella${amount>1?'s':''}</div><div class="rp-label">${label}</div>`;
  document.body.appendChild(el);
  playStarSound(amount);launchFlyingStarsFromPopup(amount);
  requestAnimationFrame(()=>{el.classList.add('rp-show');});
  setTimeout(()=>{el.classList.add('rp-hide');setTimeout(()=>el.remove(),600);},3200);
}
function launchFlyingStarsFromPopup(amount){
  const statEl=document.getElementById('star-badge');if(!statEl)return;
  const targetRect=statEl.getBoundingClientRect();
  const tx=targetRect.left+targetRect.width/2,ty=targetRect.top+targetRect.height/2;
  const count=Math.min(amount*2+2,8);
  for(let i=0;i<count;i++){setTimeout(()=>{
    const star=document.createElement('div');star.className='flying-star';star.textContent='⭐';
    const sx=window.innerWidth-140+(Math.random()-.5)*60,sy=80+(Math.random()-.5)*30;
    star.style.left=sx+'px';star.style.top=sy+'px';document.body.appendChild(star);
    star.animate([{transform:'translate(0,0) scale(1.5)',opacity:1},{transform:`translate(${(tx-sx)*0.5}px,${(ty-sy)*0.5-50}px) scale(1.2)`,opacity:1,offset:0.5},{transform:`translate(${tx-sx}px,${ty-sy}px) scale(0.3)`,opacity:0}],{duration:950+i*60,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
    setTimeout(()=>star.remove(),1100+i*60);
  },i*80);}
}

// ══════════════════════════════════════════════════════════
// MISIONES (mismo código original)
// ══════════════════════════════════════════════════════════
const MISSION_POOL=[
  {id:'all_done',icon:'🏆',name:'Día perfecto',desc:'Completá el 100% de tus actividades.',stars:2,check:()=>calcTodayPct()===100&&activities.length>0},
  {id:'no_skip',icon:'🎯',name:'Sin excusas',desc:'100% del día sin ningún "No hice".',stars:3,check:()=>activities.length>0&&activities.every(a=>!isSkippedAct(a.id))&&calcTodayPct()===100},
  {id:'first_three',icon:'⚡',name:'Arranque explosivo',desc:'Completá las primeras 3 actividades sin saltear.',stars:1,check:()=>{const s=[...activities].sort((a,b)=>timeToMin(a.start)-timeToMin(b.start)).slice(0,3);return s.length===3&&s.every(a=>a.done)&&s.every(a=>!isSkippedAct(a.id));}},
  {id:'five_done',icon:'💪',name:'Máquina',desc:'Completá 5 actividades en un día.',stars:1,check:()=>activities.filter(a=>a.done).length>=5},
  {id:'six_done',icon:'🦾',name:'Imparable',desc:'Completá 6 o más actividades en un día.',stars:2,check:()=>activities.filter(a=>a.done).length>=6},
  {id:'early_bird',icon:'🌅',name:'Madrugador',desc:'Completá una actividad antes de las 8:00.',stars:1,check:()=>activities.some(a=>a.done&&timeToMin(a.start)<480)},
  {id:'night_owl',icon:'🌙',name:'Noctámbulo',desc:'Completá una actividad después de las 21:00.',stars:1,check:()=>activities.some(a=>a.done&&timeToMin(a.start)>=1260)},
  {id:'sunrise_and_night',icon:'🌓',name:'Dueño del día',desc:'Completá actividades antes de las 8 y después de las 21.',stars:2,check:()=>activities.some(a=>a.done&&timeToMin(a.start)<480)&&activities.some(a=>a.done&&timeToMin(a.start)>=1260)},
  {id:'streak_3',icon:'🔥',name:'En racha',desc:'Mantené una racha de 3 días consecutivos.',stars:1,check:()=>calcStreak()>=3},
  {id:'streak_7',icon:'🌋',name:'Racha de fuego',desc:'Mantené una racha de 7 días consecutivos.',stars:2,check:()=>calcStreak()>=7},
  {id:'streak_14',icon:'💥',name:'Dos semanas seguidas',desc:'14 días consecutivos al 100%.',stars:3,check:()=>calcStreak()>=14},
  {id:'streak_30',icon:'👑',name:'El mes eterno',desc:'30 días consecutivos al 100%.',stars:4,check:()=>calcStreak()>=30},
  {id:'four_hours',icon:'⏳',name:'Hora punta',desc:'4 actividades distintas en menos de 6 horas.',stars:2,check:()=>{const d=activities.filter(a=>a.done).sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));if(d.length<4)return false;for(let i=0;i<=d.length-4;i++){const sp=timeToMin(d[i+3].end)-timeToMin(d[i].start);if(sp<=360&&sp>0)return true;}return false;}},
  {id:'hard_mode_done',icon:'💀',name:'Modo extremo',desc:'3 actividades completadas en Modo Difícil.',stars:2,check:()=>getMode()==='hard'&&activities.filter(a=>a.done).length>=3},
  {id:'hard_perfect',icon:'☠️',name:'Sin compasión',desc:'Día al 100% en Modo Difícil.',stars:4,check:()=>getMode()==='hard'&&calcTodayPct()===100&&activities.length>0},
  {id:'medium_perfect',icon:'⚡',name:'Precisión media',desc:'Día al 100% en Modo Media.',stars:2,check:()=>getMode()==='medium'&&calcTodayPct()===100&&activities.length>0},
  {id:'comeback',icon:'↩️',name:'Comebackeador',desc:'Completá una actividad tras haber marcado "No hice" en otra.',stars:1,check:()=>activities.some(a=>isSkippedAct(a.id))&&activities.some(a=>a.done)},
  {id:'half_day',icon:'🌗',name:'Media jornada',desc:'Llegá al 50% del día.',stars:1,check:()=>calcTodayPct()>=50&&activities.length>0},
  {id:'speed_two',icon:'🏃',name:'Sprint',desc:'Completá 2 actividades en menos de 2 horas.',stars:1,check:()=>{const d=activities.filter(a=>a.done).sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));for(let i=0;i<d.length-1;i++){const sp=timeToMin(d[i+1].end)-timeToMin(d[i].start);if(sp<=120&&sp>0)return true;}return false;}},
  {id:'all_colors',icon:'🎨',name:'Arco iris',desc:'Completá actividades de al menos 4 colores distintos.',stars:2,check:()=>new Set(activities.filter(a=>a.done).map(a=>a.color)).size>=4},
  {id:'ten_total',icon:'🎖️',name:'Veterano',desc:'Acumulá 10 días perfectos en el historial.',stars:2,check:()=>calcTotalPerfect()>=10},
  {id:'twenty_total',icon:'🏅',name:'Leyenda',desc:'Acumulá 20 días perfectos.',stars:3,check:()=>calcTotalPerfect()>=20},
  {id:'fifty_total',icon:'🌟',name:'Inmortal',desc:'Acumulá 50 días perfectos.',stars:4,check:()=>calcTotalPerfect()>=50},
  {id:'bought_item',icon:'🛒',name:'Primer gasto',desc:'Comprá un item en la tienda.',stars:1,check:()=>getPurchaseHistory().length>0},
  {id:'three_items',icon:'🏪',name:'Comprador serial',desc:'Comprá 3 items en la tienda (total histórico).',stars:2,check:()=>getPurchaseHistory().length>=3},
  {id:'midday_done',icon:'☀️',name:'Mediodía activo',desc:'Completá una actividad entre las 12:00 y las 14:00.',stars:1,check:()=>activities.some(a=>a.done&&timeToMin(a.start)>=720&&timeToMin(a.start)<840)},
  {id:'late_night',icon:'🌃',name:'Trasnochador',desc:'Completá una actividad después de las 23:00.',stars:1,check:()=>activities.some(a=>a.done&&timeToMin(a.start)>=1380)},
  {id:'seven_acts',icon:'🎯',name:'Semana comprimida',desc:'Completá 7 actividades en un día.',stars:3,check:()=>activities.filter(a=>a.done).length>=7},
  {id:'no_miss_week',icon:'📅',name:'Semana sin fallas',desc:'7 días consecutivos al 100%.',stars:3,check:()=>calcStreak()>=7},
  {id:'double_used',icon:'🌟',name:'Estrella doble',desc:'Usá el power-up de doble estrella.',stars:1,check:()=>!!localStorage.getItem('dhv_double_star_until')&&Date.now()<parseInt(localStorage.getItem('dhv_double_star_until'))},
  {id:'shield_used',icon:'🛡️',name:'Escudo activado',desc:'Activá un escudo de racha.',stars:1,check:()=>hasTodayShield()},
  {id:'three_done_hard',icon:'🔥',name:'Fuego en difícil',desc:'Completá 3 actividades consecutivas en Modo Difícil.',stars:2,check:()=>{if(getMode()!=='hard')return false;const sorted=[...activities].sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));let consec=0;for(const a of sorted){if(a.done&&!isSkippedAct(a.id))consec++;else consec=0;if(consec>=3)return true;}return false;}},
];
const SECONDARY_MISSION_IDS=new Set(['streak_7','streak_14','streak_30','ten_total','twenty_total','fifty_total','ten_days_total','thirty_days_total','no_miss_week','three_items']);

function getDailySeed(){const key='dhv_seed_'+todayKey;let seed=localStorage.getItem(key);if(!seed){seed=Math.floor(Math.random()*999999)+parseInt(todayKey.replace(/-/g,''));localStorage.setItem(key,seed);}return parseInt(seed);}
function getDailyMissions(){
  const key='dhv_missions_'+todayKey;const raw=localStorage.getItem(key);if(raw)return JSON.parse(raw);
  let s=getDailySeed();const pool=[...MISSION_POOL];const selected=[];
  for(let i=pool.length-1;i>0;i--){s=(s*1664525+1013904223)&0x7fffffff;const j=s%(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
  const dailyPool=pool.filter(m=>!SECONDARY_MISSION_IDS.has(m.id));
  const secondaryPool=pool.filter(m=>SECONDARY_MISSION_IDS.has(m.id));
  const easy=dailyPool.filter(m=>m.stars===1),med=dailyPool.filter(m=>m.stars===2),hard=dailyPool.filter(m=>m.stars>=3);
  if(easy.length)selected.push({...easy[0],claimed:false});
  if(med.length)selected.push({...med[0],claimed:false});
  if(hard.length)selected.push({...hard[0],claimed:false});
  for(let i=0;selected.length<3&&i<secondaryPool.length;i++){if(!selected.find(x=>x.id===secondaryPool[i].id))selected.push({...secondaryPool[i],claimed:false});}
  for(let i=0;selected.length<3&&i<pool.length;i++){if(!selected.find(x=>x.id===pool[i].id))selected.push({...pool[i],claimed:false});}
  localStorage.setItem(key,JSON.stringify(selected));return selected;
}
function saveDailyMissions(m){localStorage.setItem('dhv_missions_'+todayKey,JSON.stringify(m));autoSync();}

window.claimMission=function(idx){
  const missions=getDailyMissions(),m=missions[idx];if(!m||m.claimed)return;
  const def=MISSION_POOL.find(p=>p.id===m.id);
  if(!def||!def.check()){showToast('❌ Aún no completaste esta misión');return;}
  missions[idx].claimed=true;saveDailyMissions(missions);
  addStars(def.stars);showRewardPopup(def.stars,'¡Misión completada!');
  if(def.stars>=3)launchConfetti();
  setTimeout(()=>{render();if(document.getElementById('missions-view').style.display!=='none')renderMissionsPage();},400);
};

function renderMissions(){
  const container=document.getElementById('missions-list');if(!container)return;
  const missions=getDailyMissions();
  container.innerHTML=missions.map((m,i)=>{
    const def=MISSION_POOL.find(p=>p.id===m.id);const done=def?def.check():false;const claimed=m.claimed;const stars='⭐'.repeat(def?def.stars:1);
    return`<div class="mission-card ${claimed?'mission-done':done?'mission-ready':''}"><div class="mission-icon">${m.icon}</div><div class="mission-body"><div class="mission-name">${m.name}</div><div class="mission-desc">${m.desc}</div></div><div class="mission-right">${claimed?`<span class="mission-badge-done">✓ +${def.stars}⭐</span>`:done?`<button class="mission-claim-btn" onclick="claimMission(${i})">+${def.stars}⭐</button>`:`<span class="mission-reward">${stars}</span>`}</div></div>`;
  }).join('');
}

function makeMpCard(m,i,def,isDone,isClaimed,isSecondary){
  const stars='⭐'.repeat(def?def.stars:1);
  const diffLabel=['','🟢 Fácil','🟡 Media','🟠 Difícil','🔴 Épica'][def?def.stars:1];
  const tag=isSecondary?'<span class="mp-tag-time mp-tag-secondary">🏅 Largo plazo</span>':'<span class="mp-tag-time mp-tag-daily">⏱ Hoy</span>';
  return`<div class="mp-card ${isClaimed?'mp-done':isDone?'mp-ready':''}"><div class="mp-top"><span class="mp-icon">${m.icon}</span><div class="mp-info"><div class="mp-name">${m.name}</div><div class="mp-diff">${diffLabel} ${tag}</div></div><div class="mp-stars">${stars}</div></div><div class="mp-desc">${m.desc}</div><div class="mp-action">${isClaimed?'<span class="mp-badge-done">✓ Reclamada</span>':isDone?`<button class="mp-claim-btn" onclick="claimMission(${i})">Reclamar +${def.stars}⭐</button>`:'<span class="mp-pending">Pendiente</span>'}</div></div>`;
}

function renderMissionsPage(){
  const missions=getDailyMissions();
  const container=document.getElementById('missions-page-list');if(!container)return;
  const secContainer=document.getElementById('missions-page-secondary');
  const secTitle=document.getElementById('mp-secondary-title');
  const daily=[],secondary=[];
  missions.forEach((m,i)=>{if(SECONDARY_MISSION_IDS.has(m.id))secondary.push({m,i});else daily.push({m,i});});
  const dailyDone=daily.filter(({m})=>{const d=MISSION_POOL.find(p=>p.id===m.id);return d&&d.check();}).length;
  const dailyClaimed=daily.filter(({m})=>m.claimed).length;
  document.getElementById('mp-progress').textContent=`${dailyClaimed}/${daily.length} diarias reclamadas · ${dailyDone}/${daily.length} completadas`;
  document.getElementById('mp-prog-fill').style.width=(daily.length?dailyClaimed/daily.length*100:0)+'%';
  container.innerHTML=daily.map(({m,i})=>{const def=MISSION_POOL.find(p=>p.id===m.id);return makeMpCard(m,i,def,def?def.check():false,m.claimed,false);}).join('');
  if(secondary.length>0){secTitle.style.display='';secContainer.innerHTML=secondary.map(({m,i})=>{const def=MISSION_POOL.find(p=>p.id===m.id);return makeMpCard(m,i,def,def?def.check():false,m.claimed,true);}).join('');}
  else{secTitle.style.display='none';secContainer.innerHTML='';}
  const pool=MISSION_POOL.filter(p=>!missions.find(m=>m.id===p.id));
  document.getElementById('mp-pool').innerHTML=`<div class="mp-pool-title" onclick="togglePoolPreview()">📋 Otras posibles misiones (${pool.length}) <span id="mp-pool-arrow">▼</span></div><div id="mp-pool-list" style="display:none">${pool.map(p=>`<div class="mp-pool-item"><span>${p.icon}</span><span>${p.name}</span><span>${'⭐'.repeat(p.stars)}</span></div>`).join('')}</div>`;
}
window.togglePoolPreview=function(){const l=document.getElementById('mp-pool-list'),a=document.getElementById('mp-pool-arrow');if(l.style.display==='none'){l.style.display='flex';a.textContent='▲';}else{l.style.display='none';a.textContent='▼';}};

// ══════════════════════════════════════════════════════════
// LOGROS
// ══════════════════════════════════════════════════════════
function getClaimedAchievements(){return JSON.parse(localStorage.getItem('dhv_claimed_ach')||'[]');}
window.claimAchievement=function(id){
  const claimed=getClaimedAchievements();if(claimed.includes(id))return;
  const ach=ACHIEVEMENTS.find(a=>a.id===id);if(!ach||!ach.check())return;
  claimed.push(id);localStorage.setItem('dhv_claimed_ach',JSON.stringify(claimed));
  addStars(ach.stars);showRewardPopup(ach.stars,`¡Logro: ${ach.name}!`);
  if(ach.stars>=3)launchConfetti();if(ach.stars===4){setTimeout(launchConfetti,800);}
  setTimeout(()=>renderProfile(),400);
};

const ACHIEVEMENTS=[
  {id:'first_act',icon:'🌱',name:'Primer paso',desc:'Completá tu primera actividad.',cat:'Inicio',stars:1,check:()=>activities.some(a=>a.done)||getHistory().some(d=>d.done>0)},
  {id:'first_day',icon:'📅',name:'Primer día',desc:'Completá un día al 100%.',cat:'Inicio',stars:1,check:()=>calcTodayPct()===100||calcTotalPerfect()>=1},
  {id:'first_skip',icon:'🙈',name:'Nadie es perfecto',desc:'Marcá una actividad como "No hice".',cat:'Inicio',stars:1,check:()=>getHistory().some(d=>d.acts&&d.acts.some(a=>a.manualSkip))||activities.some(a=>isSkippedAct(a.id))},
  {id:'first_store',icon:'🛒',name:'Primer compra',desc:'Comprá algo en la tienda.',cat:'Inicio',stars:1,check:()=>getPurchaseHistory().length>0},
  {id:'setup_routine',icon:'🗓️',name:'Rutina armada',desc:'Tenés 3 o más actividades en tu rutina.',cat:'Inicio',stars:1,check:()=>activities.length>=3},
  {id:'full_routine',icon:'📋',name:'Rutina completa',desc:'Tenés 5 o más actividades.',cat:'Inicio',stars:1,check:()=>activities.length>=5},
  {id:'streak_2',icon:'🔥',name:'Dos en fila',desc:'2 días consecutivos al 100%.',cat:'Rachas',stars:1,check:()=>calcStreak()>=2},
  {id:'streak_5',icon:'🌡️',name:'Racha de 5',desc:'5 días consecutivos al 100%.',cat:'Rachas',stars:2,check:()=>calcStreak()>=5},
  {id:'streak_7',icon:'💥',name:'Una semana',desc:'7 días consecutivos.',cat:'Rachas',stars:2,check:()=>calcStreak()>=7},
  {id:'streak_14',icon:'🌊',name:'Dos semanas',desc:'14 días consecutivos.',cat:'Rachas',stars:3,check:()=>calcStreak()>=14},
  {id:'streak_21',icon:'⚡',name:'Tres semanas',desc:'21 días consecutivos.',cat:'Rachas',stars:3,check:()=>calcStreak()>=21},
  {id:'streak_30',icon:'👑',name:'Mes perfecto',desc:'30 días consecutivos.',cat:'Rachas',stars:4,check:()=>calcStreak()>=30},
  {id:'streak_60',icon:'🌟',name:'Dos meses',desc:'60 días consecutivos.',cat:'Rachas',stars:4,check:()=>calcStreak()>=60},
  {id:'streak_100',icon:'💫',name:'Centenario',desc:'100 días consecutivos.',cat:'Rachas',stars:4,check:()=>calcStreak()>=100},
  {id:'perfect_5',icon:'🎯',name:'5 veces 100%',desc:'5 días perfectos en el historial.',cat:'Perfección',stars:2,check:()=>calcTotalPerfect()>=5},
  {id:'perfect_10',icon:'🏅',name:'10 perfectos',desc:'10 días perfectos.',cat:'Perfección',stars:2,check:()=>calcTotalPerfect()>=10},
  {id:'perfect_25',icon:'🏆',name:'25 perfectos',desc:'25 días perfectos.',cat:'Perfección',stars:3,check:()=>calcTotalPerfect()>=25},
  {id:'perfect_50',icon:'💎',name:'50 perfectos',desc:'50 días perfectos.',cat:'Perfección',stars:4,check:()=>calcTotalPerfect()>=50},
  {id:'no_skip_day',icon:'🎖️',name:'Día impoluto',desc:'Día al 100% sin ningún "No hice".',cat:'Perfección',stars:2,check:()=>activities.length>0&&activities.every(a=>!isSkippedAct(a.id))&&calcTodayPct()===100},
  {id:'seven_acts_day',icon:'🦾',name:'Superhuman',desc:'Completá 7 actividades en un día.',cat:'Perfección',stars:3,check:()=>activities.filter(a=>a.done).length>=7},
  {id:'ten_acts_day',icon:'🤖',name:'Máquina de tiempo',desc:'Completá 10 actividades en un día.',cat:'Perfección',stars:4,check:()=>activities.filter(a=>a.done).length>=10},
  {id:'early',icon:'🌅',name:'Madrugador',desc:'Completá una actividad antes de las 8:00.',cat:'Horarios',stars:1,check:()=>activities.some(a=>a.done&&timeToMin(a.start)<480)||getHistory().some(d=>d.acts&&d.acts.some(a=>a.done&&timeToMin(a.start||'00:00')<480))},
  {id:'late',icon:'🌙',name:'Noctámbulo',desc:'Completá una actividad después de las 21:00.',cat:'Horarios',stars:1,check:()=>activities.some(a=>a.done&&timeToMin(a.start)>=1260)},
  {id:'late_night',icon:'🌃',name:'Trasnochador',desc:'Completá una actividad después de las 23:00.',cat:'Horarios',stars:2,check:()=>activities.some(a=>a.done&&timeToMin(a.start)>=1380)},
  {id:'full_day_coverage',icon:'🌞',name:'Dueño del día',desc:'Actividades antes de las 8 y después de las 21.',cat:'Horarios',stars:2,check:()=>activities.some(a=>a.done&&timeToMin(a.start)<480)&&activities.some(a=>a.done&&timeToMin(a.start)>=1260)},
  {id:'mode_medium_first',icon:'🟡',name:'Modo Media',desc:'Completá un día en Modo Media.',cat:'Modos',stars:2,check:()=>getMode()==='medium'&&calcTodayPct()===100},
  {id:'mode_hard_first',icon:'🔴',name:'Primer día difícil',desc:'Completá cualquier actividad en Modo Difícil.',cat:'Modos',stars:2,check:()=>getMode()==='hard'&&activities.some(a=>a.done)},
  {id:'mode_hard_perfect',icon:'💀',name:'Sin piedad',desc:'Día al 100% en Modo Difícil.',cat:'Modos',stars:4,check:()=>getMode()==='hard'&&calcTodayPct()===100&&activities.length>0},
  {id:'mode_hard_7',icon:'☠️',name:'Masoquista',desc:'7 actividades completadas en Modo Difícil en un día.',cat:'Modos',stars:4,check:()=>getMode()==='hard'&&activities.filter(a=>a.done).length>=7},
  {id:'shield_hero',icon:'🛡️',name:'Escudo activado',desc:'Activá un escudo de racha.',cat:'Tienda',stars:1,check:()=>hasTodayShield()},
  {id:'recovered',icon:'⚡',name:'Recuperador',desc:'Recuperá una racha con el item.',cat:'Tienda',stars:2,check:()=>getHistory().some(d=>d.recovered)},
  {id:'double_star_used',icon:'🌟',name:'Potenciado',desc:'Usá el power-up de doble estrella.',cat:'Tienda',stars:1,check:()=>!!localStorage.getItem('dhv_double_star_until')},
  {id:'collector',icon:'💰',name:'Coleccionista',desc:'Acumulá 100 estrellas en total.',cat:'Tienda',stars:3,check:()=>getTotalStars()>=100},
  {id:'rich',icon:'💎',name:'Rico',desc:'Acumulá 300 estrellas en total.',cat:'Tienda',stars:4,check:()=>getTotalStars()>=300},
  {id:'mission_first',icon:'🎯',name:'Primera misión',desc:'Completá y reclamá tu primera misión diaria.',cat:'Misiones',stars:1,check:()=>{const m=getDailyMissions();return m.some(x=>x.claimed);}},
  {id:'mission_all_day',icon:'🏅',name:'Triple misión',desc:'Reclamá las 3 misiones del día.',cat:'Misiones',stars:3,check:()=>getDailyMissions().every(m=>m.claimed)},
  {id:'ten_days_total',icon:'📊',name:'Historial sólido',desc:'Registrá 10 días en el historial.',cat:'Constancia',stars:2,check:()=>getHistory().length>=10},
  {id:'thirty_days_total',icon:'📈',name:'Mes completo',desc:'Registrá 30 días en el historial.',cat:'Constancia',stars:3,check:()=>getHistory().length>=30},
];

function renderProfile(){
  const streak=calcStreak(),totalPerfect=calcTotalPerfect(),mode=getMode();
  document.getElementById('ps-streak').textContent=streak;
  document.getElementById('ps-total').textContent=totalPerfect;
  document.getElementById('ps-acts').textContent=activities.length;
  const modeLabels={easy:'🟣 Fácil',medium:'🟡 Media',hard:'🔴 Difícil'};
  document.getElementById('ps-mode').textContent=modeLabels[mode]||'🟣 Fácil';
  const claimed=getClaimedAchievements();
  const totalStars=ACHIEVEMENTS.reduce((s,a)=>s+(claimed.includes(a.id)?a.stars:0),0);
  document.getElementById('ps-ach-stars').textContent=totalStars;

  // Nombre de perfil: prioridad al @username elegido, sino el nombre de Google
  if (myProfile && myProfile.username) {
    document.getElementById('profile-name').textContent = '@' + myProfile.username;
  } else if (currentUser && currentUser.displayName) {
    document.getElementById('profile-name').textContent = currentUser.displayName;
  }

  // Badge de nube
  const cloudSlot=document.getElementById('profile-cloud-slot');
  if(currentUser){
    const usernameTag = myProfile && myProfile.username ? '' : ' · <span style="cursor:pointer;text-decoration:underline" onclick="switchTab(\'friends\')">elegir @usuario</span>';
    cloudSlot.innerHTML=`<div class="profile-cloud-badge">☁️ Sincronizado con Google${usernameTag}</div>`;
  } else {
    cloudSlot.innerHTML=`<div style="font-size:0.72rem;color:var(--text3);margin-top:6px">Sin cuenta — solo en este dispositivo</div>`;
  }

  const cats=[...new Set(ACHIEVEMENTS.map(a=>a.cat))];
  const grid=document.getElementById('rewards-grid');
  grid.innerHTML=cats.map(cat=>{
    const achs=ACHIEVEMENTS.filter(a=>a.cat===cat);
    return`<div class="ach-category"><div class="ach-cat-title">${cat}</div>${achs.map(a=>{
      const isClaimed=claimed.includes(a.id);const isUnlocked=!isClaimed&&a.check();const stars='⭐'.repeat(a.stars);const diffColor=['','#6bcf7f','#f5c842','#ff9640','#e24b4b'][a.stars];
      return`<div class="reward-card ${isClaimed?'unlocked':isUnlocked?'reward-claimable':''}"><div class="reward-icon-wrap" style="${isClaimed?`box-shadow:0 0 12px ${diffColor}40`:''}"><span class="reward-icon">${a.icon}</span></div><div class="reward-info"><div class="reward-name">${a.name} <span style="font-size:0.6rem;color:${diffColor};font-weight:700">${stars}</span></div><div class="reward-desc">${a.desc}</div>${isClaimed?'<span class="reward-badge-done">✓ Reclamado</span>':isUnlocked?`<button class="reward-claim-btn" onclick="claimAchievement('${a.id}')">¡Reclamar +${a.stars}⭐!</button>`:`<div class="reward-prog-bar"><div class="reward-prog-fill" style="width:0%"></div></div>`}</div></div>`;
    }).join('')}</div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
// CONFIRM / DRAWER / TUTORIAL
// ══════════════════════════════════════════════════════════
window.openConfirm=function(title,msg,cb,okLabel='Confirmar'){confirmCallback=cb;document.getElementById('confirm-title').textContent=title;document.getElementById('confirm-msg').textContent=msg;document.getElementById('confirm-ok-btn').textContent=okLabel;document.getElementById('confirm-overlay').classList.add('open');document.getElementById('confirm-ok-btn').onclick=()=>{closeConfirm();if(cb)cb();};};
window.closeConfirm=function(){document.getElementById('confirm-overlay').classList.remove('open');confirmCallback=null;};
window.openDrawer=function(){document.getElementById('drawer').classList.add('open');document.getElementById('drawer-overlay').classList.add('open');};
window.closeDrawer=function(){document.getElementById('drawer').classList.remove('open');document.getElementById('drawer-overlay').classList.remove('open');};

let tutPage=0;
const TUT_PAGES=[
  {type:'welcome',btn:'Ver los modos →'},
  {type:'mode',mode:'easy',emoji:'🟣',title:'Modo Fácil',color:'var(--purple-light)',bg:'rgba(127,119,221,0.08)',border:'rgba(127,119,221,0.25)',streakEmoji:'🔥',desc:'El modo clásico. Sin presión de tiempo.',rules:[{i:'✅',t:'Marcás después de la hora sin límite.'},{i:'⭐',t:'1 estrella por actividad.'},{i:'🔥',t:'Racha morada.'},{i:'🆓',t:'"No hice" no penaliza.'}],btn:'Siguiente →'},
  {type:'mode',mode:'medium',emoji:'🟡',title:'Modo Media',color:'#f5c842',bg:'rgba(245,200,66,0.08)',border:'rgba(245,200,66,0.25)',streakEmoji:'⚡',desc:'3 horas para confirmar tras el horario.',rules:[{i:'⏳',t:'3 horas para marcar tras terminar.'},{i:'⭐',t:'-1⭐ si vence el tiempo.'},{i:'🟡',t:'Racha amarilla.'},{i:'⚡',t:'Manejable pero exigente.'}],btn:'Siguiente →'},
  {type:'mode',mode:'hard',emoji:'🔴',title:'Modo Difícil',color:'#e24b4b',bg:'rgba(226,75,75,0.08)',border:'rgba(226,75,75,0.25)',streakEmoji:'💀',desc:'30 minutos. Sin piedad.',rules:[{i:'⏱️',t:'Solo 30 min tras terminar la actividad.'},{i:'💸',t:'-2⭐ si vence el tiempo.'},{i:'🔴',t:'Racha roja.'},{i:'💀',t:'El modo más extremo.'}],btn:'¡Elegir y empezar!'},
];
function renderTutPage(){
  const p=TUT_PAGES[tutPage];const box=document.querySelector('.tut-box');if(!box)return;
  const dots=TUT_PAGES.map((_,i)=>`<div class="tut-dot ${i===tutPage?'active':''}" onclick="goTutPage(${i})"></div>`).join('');
  const isLast=tutPage===TUT_PAGES.length-1;
  if(p.type==='welcome'){
    box.innerHTML=`<div class="tut-dots">${dots}</div><div class="tut-logo">Desafio<span>HV</span> ⭐</div><div class="tut-tagline">Organizá y dominá tus 24 horas</div><div class="tut-steps">${[{i:'➕',t:'Creá tu rutina',d:'Actividades con horario y color.'},{i:'🎯',t:'Misiones diarias',d:'3 desafíos nuevos cada día, ganás ⭐.'},{i:'🏆',t:'Logros',d:'Más de 35 logros con 1-4⭐ de recompensa.'},{i:'🏪',t:'Tienda',d:'Usá tus ⭐ para comprar power-ups.'}].map(s=>`<div class="tut-step"><div class="tut-icon">${s.i}</div><div class="tut-step-text"><strong>${s.t}</strong><span>${s.d}</span></div></div>`).join('')}</div><button class="tut-btn" onclick="goTutPage(1)">${p.btn}</button>`;
  }else{
    box.innerHTML=`<div class="tut-dots">${dots}</div><div class="tut-mode-badge" style="background:${p.bg};border:1px solid ${p.border};color:${p.color}">${p.emoji} ${p.title}</div><div class="tut-mode-desc">${p.desc}</div><div class="tut-mode-streak" style="border-color:${p.border};background:${p.bg}"><span>${p.streakEmoji}</span><span style="color:${p.color};font-weight:700;font-size:0.82rem">Racha ${p.title.replace('Modo ','')}</span></div><div class="tut-rules">${p.rules.map(r=>`<div class="tut-rule"><span class="tut-rule-icon">${r.i}</span><span>${r.t}</span></div>`).join('')}</div>${isLast?`<div class="tut-mode-select"><div class="tut-mode-lbl">Elegí tu modo:</div><div class="tut-mode-btns"><button class="tut-mode-pick easy" onclick="pickModeAndStart('easy')">🟣 Fácil</button><button class="tut-mode-pick medium" onclick="pickModeAndStart('medium')">🟡 Media</button><button class="tut-mode-pick hard" onclick="pickModeAndStart('hard')">🔴 Difícil</button></div></div>`:`<button class="tut-btn" onclick="goTutPage(${tutPage+1})">${p.btn}</button>`}<button class="tut-skip-btn" onclick="pickModeAndStart('easy')">Saltar tutorial</button>`;
  }
}
window.goTutPage=function(n){tutPage=n;renderTutPage();};
window.pickModeAndStart=function(m){setMode(m);closeTutorial();};
function closeTutorial(){const el=document.getElementById('tutorial');el.style.opacity='0';el.style.transition='opacity 0.4s';setTimeout(()=>el.style.display='none',400);localStorage.setItem('dhv_tutorial_seen','1');}

// ══════════════════════════════════════════════════════════
// MODE SELECTOR
// ══════════════════════════════════════════════════════════
window.openModeSelector=function(){document.getElementById('mode-modal').style.display='flex';renderModeModal();};
window.closeModeSelector=function(){document.getElementById('mode-modal').style.display='none';};
function renderModeModal(){
  const cur=getMode(),expired=countExpiredPending();
  const modes=[
    {id:'easy',emoji:'🟣',name:'Fácil',color:'var(--purple-light)',bg:'rgba(127,119,221,0.1)',border:'rgba(127,119,221,0.3)',desc:'Sin presión de tiempo.',streak:'Racha morada 🔥',stars:'+1⭐ por actividad'},
    {id:'medium',emoji:'🟡',name:'Media',color:'#f5c842',bg:'rgba(245,200,66,0.1)',border:'rgba(245,200,66,0.3)',desc:'3 horas para marcar. -1⭐ si vence.',streak:'Racha amarilla ⚡',stars:'-1⭐ si vence'},
    {id:'hard',emoji:'🔴',name:'Difícil',color:'#e24b4b',bg:'rgba(226,75,75,0.1)',border:'rgba(226,75,75,0.3)',desc:'30 min para marcar. -2⭐ si vence.',streak:'Racha roja 💀',stars:'-2⭐ si vence'},
  ];
  const warn=expired>0?`<div class="mode-expired-warn">⚠️ Tenés <strong>${expired} actividad${expired>1?'es':''} vencida${expired>1?'s':''}</strong>. Cambiar a un modo más exigente podría penalizarte.</div>`:'';
  document.getElementById('mode-modal-body').innerHTML=warn+modes.map(m=>`<div class="mode-option ${cur===m.id?'selected':''}" style="--mc:${m.color};--mb:${m.bg};--mbo:${m.border}" onclick="selectMode('${m.id}')"><div class="mode-opt-head"><span class="mode-opt-emoji">${m.emoji}</span><span class="mode-opt-name" style="color:${m.color}">${m.name}</span>${cur===m.id?'<span class="mode-opt-active">Activo</span>':''}</div><div class="mode-opt-desc">${m.desc}</div><div class="mode-opt-tags"><span class="mode-opt-tag" style="color:${m.color};border-color:${m.border};background:${m.bg}">${m.streak}</span><span class="mode-opt-tag" style="color:${m.color};border-color:${m.border};background:${m.bg}">${m.stars}</span></div></div>`).join('');
}
window.selectMode=function(m){
  const cur=getMode();if(cur===m){closeModeSelector();return;}
  const expired=countExpiredPending(),modeNames={easy:'Fácil',medium:'Media',hard:'Difícil'};
  const doSwitch=()=>{setMode(m);closeModeSelector();render();showToast(`Modo: ${modeNames[m]}`);};
  if(expired>0&&(m==='medium'||m==='hard')){const penalty=m==='hard'?2:1;openConfirm(`⚠️ Actividades vencidas`,`${expired} actividad${expired>1?'es':''} vencida${expired>1?'s':''}. Perderías -${penalty}⭐ por cada una. ¿Continuar?`,doSwitch,'Cambiar igual');}
  else doSwitch();
};

// ══════════════════════════════════════════════════════════
// AUTO-SKIP
// ══════════════════════════════════════════════════════════
function checkExpiredActivities(){
  const mode=getMode();if(mode==='easy')return;let changed=false;
  activities.forEach(act=>{
    if(!act.done&&!isSkippedAct(act.id)&&isWindowExpired(act)){
      setSkippedAct(act.id,true);const penalty=mode==='hard'?2:1;addStars(-penalty);changed=true;showToast(`⏰ "${act.name}" venció. -${penalty}⭐`);
    }
  });
  if(changed)render();
}

// ══════════════════════════════════════════════════════════
// PARTICLES & CLOCK
// ══════════════════════════════════════════════════════════
function initParticles(){
  const canvas=document.getElementById('particles'),ctx=canvas.getContext('2d');let W,H,pts;
  function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;pts=Array.from({length:45},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*0.2,vy:(Math.random()-.5)*0.2,r:Math.random()*1.3+0.3,alpha:Math.random()*0.18+0.04,hue:Math.random()>0.7?'14,165,176':Math.random()>0.5?'196,78,216':'127,119,221'}));}
  resize();window.addEventListener('resize',resize);
  function draw(){ctx.clearRect(0,0,W,H);pts.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0)p.x=W;if(p.x>W)p.x=0;if(p.y<0)p.y=H;if(p.y>H)p.y=0;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=`rgba(${p.hue},${p.alpha})`;ctx.fill();});requestAnimationFrame(draw);}
  draw();
}
function updateDate(){const d=new Date();const dias=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'],meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];document.getElementById('top-bar-date').textContent=`${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`;}
function drawClock(){
  const svg=document.getElementById('clock-svg');svg.setAttribute('viewBox','0 0 280 280');
  const cx=140,cy=140,R=104,rInner=60;let html='';
  html+=`<circle cx="${cx}" cy="${cy}" r="${R+12}" fill="none" stroke="rgba(127,119,221,0.05)" stroke-width="20"/>`;
  html+=`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(127,119,221,0.12)" stroke-width="1.2"/>`;
  for(let h=0;h<24;h++){const angle=(h/24)*2*Math.PI-Math.PI/2,isMajor=h%6===0,isSemi=h%3===0,tickLen=isMajor?10:isSemi?6:3.5;const x1=cx+(R-1)*Math.cos(angle),y1=cy+(R-1)*Math.sin(angle),x2=cx+(R-1+tickLen)*Math.cos(angle),y2=cy+(R-1+tickLen)*Math.sin(angle);html+=`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="rgba(127,119,221,${isMajor?0.5:0.18})" stroke-width="${isMajor?1.6:0.8}" stroke-linecap="round"/>`;if(isMajor){const lx=cx+(R+18)*Math.cos(angle),ly=cy+(R+18)*Math.sin(angle);html+=`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="9" fill="rgba(127,119,221,0.55)" font-family="Inter,sans-serif" font-weight="600">${h===0?'0':h}</text>`;}}
  [...activities].sort((a,b)=>timeToMin(a.start)-timeToMin(b.start)).forEach(act=>{
    let s=timeToMin(act.start),e=timeToMin(act.end);if(e<=s)e+=1440;
    const sA=(s/1440)*2*Math.PI-Math.PI/2,eA=(e/1440)*2*Math.PI-Math.PI/2,large=(e-s)>720?1:0;
    const arcR=R-7,innerR=rInner+8;
    const x1=cx+arcR*Math.cos(sA),y1=cy+arcR*Math.sin(sA),x2=cx+arcR*Math.cos(eA),y2=cy+arcR*Math.sin(eA);
    const xi1=cx+innerR*Math.cos(eA),yi1=cy+innerR*Math.sin(eA),xi2=cx+innerR*Math.cos(sA),yi2=cy+innerR*Math.sin(sA);
    const isSkipped=isSkippedAct(act.id),isExpired=isWindowExpired(act)&&!act.done&&!isSkipped;
    const segColor=act.done?'#1ec882':isSkipped?'#e24b4b':isExpired?'#c03030':act.color;
    const opacity=act.done?0.82:isSkipped?0.70:isExpired?0.55:0.88;
    const strokeColor=act.done?'rgba(10,180,100,0.6)':isSkipped?'rgba(200,40,40,0.5)':'rgba(7,7,26,0.4)';
    html+=`<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${arcR},${arcR} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${xi1.toFixed(2)},${yi1.toFixed(2)} A${innerR},${innerR} 0 ${large},0 ${xi2.toFixed(2)},${yi2.toFixed(2)} Z" fill="${segColor}" opacity="${opacity}" stroke="${strokeColor}" stroke-width="0.8"/>`;
    if(act.done){const midA=(sA+eA)/2+(large?Math.PI:0),midR=(arcR+innerR)/2,mx=cx+midR*Math.cos(midA),my=cy+midR*Math.sin(midA);html+=`<text x="${mx.toFixed(2)}" y="${my.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="8" fill="rgba(0,0,0,0.7)" opacity="0.95" font-weight="bold">✓</text>`;}
    if(isSkipped){const midA=(sA+eA)/2+(large?Math.PI:0),midR=(arcR+innerR)/2,mx=cx+midR*Math.cos(midA),my=cy+midR*Math.sin(midA);html+=`<text x="${mx.toFixed(2)}" y="${my.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="8" fill="rgba(0,0,0,0.65)" opacity="0.9" font-weight="bold">✕</text>`;}
  });
  html+=`<circle cx="${cx}" cy="${cy}" r="${rInner}" fill="rgba(7,7,26,0.95)" stroke="rgba(127,119,221,0.12)" stroke-width="1.5"/>`;
  html+=`<circle cx="${cx}" cy="${cy}" r="${rInner-2}" fill="none" stroke="rgba(127,119,221,0.04)" stroke-width="10"/>`;
  const pct=calcTodayPct(),pctColor=pct===100?'#4eddb4':pct>=70?'#a59ef0':'#eeeaff';
  html+=`<text x="${cx}" y="${cy-11}" text-anchor="middle" font-size="25" font-weight="700" fill="${pctColor}" font-family="Inter,sans-serif" letter-spacing="-1">${pct}%</text>`;
  html+=`<text x="${cx}" y="${cy+7}" text-anchor="middle" font-size="8" fill="rgba(153,147,204,0.5)" font-family="Inter,sans-serif" letter-spacing="0.5" font-weight="600">DEL DÍA</text>`;
  if(activities.length>0){html+=`<text x="${cx}" y="${cy+19}" text-anchor="middle" font-size="7.5" fill="rgba(153,147,204,0.3)" font-family="Inter,sans-serif">${activities.filter(a=>a.done).length}/${activities.length}</text>`;}
  const nowA=(nowMin()/1440)*2*Math.PI-Math.PI/2,nx1=cx+(rInner+4)*Math.cos(nowA),ny1=cy+(rInner+4)*Math.sin(nowA),nx2=cx+(R+2)*Math.cos(nowA),ny2=cy+(R+2)*Math.sin(nowA);
  html+=`<line x1="${nx1.toFixed(2)}" y1="${ny1.toFixed(2)}" x2="${nx2.toFixed(2)}" y2="${ny2.toFixed(2)}" stroke="rgba(255,255,255,0.8)" stroke-width="1.5" stroke-linecap="round"/>`;
  html+=`<circle cx="${nx1.toFixed(2)}" cy="${ny1.toFixed(2)}" r="2.5" fill="white" opacity="0.9"/>`;
  svg.innerHTML=html;
}

// ══════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════
function render(){
  const list=document.getElementById('act-list');updateStats();drawClock();renderMissions();
  const shieldBanner=document.getElementById('shield-banner');
  if(hasTodayShield())shieldBanner.classList.remove('hidden');else shieldBanner.classList.add('hidden');
  if(isTodayRestDay()){list.innerHTML=`<div class="rest-day-state"><div class="rest-day-emoji">🏖️</div><div class="rest-day-title">Día libre</div><div class="rest-day-sub">Hoy es tu día de descanso.<br>La racha sigue intacta. ¡Recargá energías!</div></div>`;return;}
  const todayActs=todayActivities();
  if(!todayActs.length){list.innerHTML='<div class="empty-state"><p>📋</p><p>No hay actividades para hoy.<br>¡Agregá tu primera actividad!</p></div>';return;}
  const now=nowMin(),sorted=[...todayActs].sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));
  const pending=sorted.filter(a=>!a.done&&!isSkippedAct(a.id));
  const skippedActs=sorted.filter(a=>isSkippedAct(a.id));
  const done=sorted.filter(a=>a.done);
  let activeIdx=-1,nextIdx=-1;
  for(let i=0;i<pending.length;i++){const a=pending[i],s=timeToMin(a.start),e=timeToMin(a.end);if(now>=s&&(e<s?now<e+1440:now<e)){activeIdx=i;break;}}
  if(activeIdx===-1){for(let i=0;i<pending.length;i++){if(timeToMin(pending[i].start)>now){nextIdx=i;break;}}}
  else if(activeIdx+1<pending.length)nextIdx=activeIdx+1;
  let html='';
  pending.forEach((act,idx)=>{
    const s=timeToMin(act.start),e=timeToMin(act.end);
    const isNow=now>=s&&(e<s?now<e+1440:now<e),isNext=idx===nextIdx&&!isNow;
    const canCheck=canMark(act),expired=isWindowExpired(act),mode=getMode();
    let badge='';
    if(isNow)badge='<span class="act-badge badge-now pulse">● Ahora</span>';
    else if(expired&&mode!=='easy')badge=`<span class="act-badge badge-expired">⏰ Venció</span>`;
    else if(isNext)badge='<span class="act-badge badge-next">→ Próxima</span>';
    else if(!canCheck)badge='<span class="act-badge badge-lock">🔒</span>';
    html+=cardHTML(act,badge,isNow,isNext,canCheck,false,false,expired&&mode!=='easy');
  });
  if(skippedActs.length){html+=`<div class="group-divider">No realizadas (${skippedActs.length})</div>`;skippedActs.forEach(act=>{html+=cardHTML(act,'<span class="act-badge badge-skip">✕</span>',false,false,true,false,true,false);});}
  if(done.length){html+=`<div class="group-divider">Completadas (${done.length})</div>`;done.forEach(act=>{html+=cardHTML(act,'<span class="act-badge badge-done">✓</span>',false,false,true,true,false,false);});}
  list.innerHTML=html;
}
function cardHTML(act,badge,isNow,isNext,canCheck,isDone,isSkipped,isExpired){
  const daysLabel=formatDaysLabel(act.days);
  const daysTag=daysLabel?`<span class="act-days-tag">${daysLabel}</span>`:'';
  return`<div class="act-card ${isDone?'completed':''} ${isNow?'active-now':''} ${isNext?'next-up':''} ${!canCheck&&!isDone&&!isSkipped?'locked':''} ${isSkipped?'skipped-act':''} ${isExpired?'expired-act':''}" id="card-${act.id}" style="--act-color:${act.color}"><div class="act-dot" style="background:${isDone?'#1ec882':isSkipped?'#e24b4b':act.color};${isDone||isSkipped?'box-shadow:0 0 8px '+(isDone?'rgba(30,200,130,0.5)':'rgba(226,75,75,0.4)'):''}"></div><div class="act-body"><div class="act-name ${isSkipped?'struck':''}${isDone?' done-name':''}${isExpired?' expired-name':''}">${act.name}${badge}</div><div class="act-time">${act.start} — ${act.end}${daysTag}</div></div><div class="act-right">${!isDone&&!isSkipped?`<button class="skip-act-btn" onclick="toggleSkipAct('${act.id}')">✕</button>`:''} ${isSkipped?`<button class="skip-act-btn" onclick="toggleSkipAct('${act.id}')">↩</button>`:''} ${!isSkipped?`<button class="check-btn ${isDone?'done':''}" ${canCheck||isDone?'':'disabled'} onclick="toggleAct('${act.id}')">✓</button>`:''}<button class="icon-btn" onclick="openEdit('${act.id}')">✎</button><button class="icon-btn del" onclick="deleteAct('${act.id}')">🗑</button></div></div>`;
}
function updateStats(){
  const pct=calcTodayPct();
  document.getElementById('sb-count').textContent=getAvailableStars();
  if(isTodayRestDay()){document.getElementById('prog-pct').textContent='🏖️ Día libre';document.getElementById('prog-fill').style.width='100%';}
  else{document.getElementById('prog-pct').textContent=pct+'%';document.getElementById('prog-fill').style.width=pct+'%';}
  updateStreakUI();
}
function calcStreak(){
  const hist=getHistory();let streak=0;
  const todayActs=todayActivities();
  if(isTodayRestDay()||(todayActs.length>0&&calcTodayPct()===100)||(hasTodayShield()&&calcTodayPct()>0))streak=1;
  const today=new Date();
  for(let i=1;i<=365;i++){const d=new Date(today);d.setDate(d.getDate()-i);const key=getDateKey(d);const entry=hist.find(h=>h.key===key);
    if(entry&&entry.restDay){streak++;continue;}
    if(!entry||entry.skipped)break;const p=calcSnapPct(entry);const hadShield=localStorage.getItem(`dhv_shield_used_${key}`)===`1`;
    if(p===100||(hadShield&&p>0))streak++;else break;
  }
  return streak;
}
function updateStreakUI(){
  const streak=calcStreak();const m=getMode();applyModeTheme(m);
  const st=m==='medium'?{emoji:'⚡'}:m==='hard'?{emoji:'💀'}:{emoji:'🔥'};
  const pill=document.getElementById('streak-pill'),banner=document.getElementById('streak-banner');
  if(streak>=1){pill.classList.remove('hidden');document.getElementById('sp-count').textContent=streak;}else pill.classList.add('hidden');
  if(streak>=2){banner.classList.remove('hidden');document.getElementById('streak-val').textContent=streak;let flame=st.emoji,title='Racha activa';if(streak>=30){flame='🌟';title='¡Racha épica!';}else if(streak>=7){title='¡Racha increíble!';}document.getElementById('streak-flame').textContent=flame;document.getElementById('streak-title').textContent=title;}else banner.classList.add('hidden');
}
function calcTotalPerfect(){return getHistory().filter(h=>!h.skipped&&calcSnapPct(h)===100).length;}
window.toggleSkipAct=function(id){const act=activities.find(a=>a.id===id);if(!act)return;if(act.done){showToast('Ya completada, desmarcá primero');return;}const was=isSkippedAct(id);setSkippedAct(id,!was);render();showToast(was?'↩ Deshecho':'✕ No realizada');};
function showActCompleteNotif(id,actName){
  setTimeout(()=>{const card=document.getElementById('card-'+id);if(!card)return;const notif=document.createElement('div');notif.className='act-complete-notif';notif.innerHTML=`✅ <span>${actName} completada</span>`;card.style.position='relative';card.appendChild(notif);setTimeout(()=>notif.remove(),2300);},60);
}
window.toggleAct=function(id){
  const act=activities.find(a=>a.id===id);if(!act)return;
  if(!act.done&&!canMark(act)){showToast('🔒 No podés marcar ahora');return;}
  const wasDone=act.done;act.done=!act.done;
  if(act.done&&isSkippedAct(id))setSkippedAct(id,false);
  if(!wasDone){
    const doubleActive=localStorage.getItem('dhv_double_star_until')&&Date.now()<parseInt(localStorage.getItem('dhv_double_star_until'));
    const earned=doubleActive?2:1;addStars(earned);
    playStarSound(earned);launchFlyingStars(id);
    saveData();render();showActCompleteNotif(id,act.name);
    const pct=calcTodayPct();if(pct===100&&activities.length>0){setTimeout(()=>{launchConfetti();showToast('🏆 ¡100% del día!');},700);}
  }else{const cur=getTotalStars();if(cur>0)localStorage.setItem('dhv_total_stars',cur-1);saveData();render();}
};
function launchFlyingStars(actId){
  const card=document.getElementById('card-'+actId),statEl=document.getElementById('star-badge');if(!card||!statEl)return;
  const cardRect=card.getBoundingClientRect(),targetRect=statEl.getBoundingClientRect();
  const tx=targetRect.left+targetRect.width/2,ty=targetRect.top+targetRect.height/2;
  for(let i=0;i<3;i++){setTimeout(()=>{const star=document.createElement('div');star.className='flying-star';star.textContent='⭐';const sx=cardRect.right-50+(Math.random()-.5)*40,sy=cardRect.top+cardRect.height/2+(Math.random()-.5)*20;star.style.left=sx+'px';star.style.top=sy+'px';document.body.appendChild(star);star.animate([{transform:'translate(0,0) scale(1.4)',opacity:1},{transform:`translate(${(tx-sx)*0.5}px,${(ty-sy)*0.5-40}px) scale(1.1)`,opacity:1,offset:0.5},{transform:`translate(${tx-sx}px,${ty-sy}px) scale(0.3)`,opacity:0}],{duration:900+i*80,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});setTimeout(()=>star.remove(),1100+i*80);},i*100);}
}
window.deleteAct=function(id){openConfirm('Eliminar','¿Seguro? No se puede deshacer.',()=>{activities=activities.filter(a=>a.id!==id);saveData();render();showToast('🗑 Eliminada');},'Eliminar');};
window.toggleForm=function(){const form=document.getElementById('add-form');form.classList.toggle('open');if(form.classList.contains('open')){document.getElementById('f-name').focus();document.getElementById('add-toggle-btn').style.display='none';}else{document.getElementById('add-toggle-btn').style.display='';document.getElementById('f-overlap-err').style.display='none';}};
function hasOverlap(start,end,excludeId=null){
  const sMin=timeToMin(start),eMin=timeToMin(end);if(sMin===eMin)return false;
  for(const act of activities){if(act.id===excludeId)continue;const aS=timeToMin(act.start),aE=timeToMin(act.end);const nC=eMin<sMin,eC=aE<aS;let ov=false;if(!nC&&!eC)ov=sMin<aE&&eMin>aS;else if(nC&&!eC)ov=aS<eMin||aE>sMin;else if(!nC&&eC)ov=sMin<aE||eMin>aS;else ov=true;if(ov)return act.name;}return false;
}
window.saveActivity=function(){
  const name=document.getElementById('f-name').value.trim(),start=document.getElementById('f-start').value,end=document.getElementById('f-end').value;
  const errEl=document.getElementById('f-overlap-err');errEl.style.display='none';
  if(!name){showToast('Escribí un nombre');return;}if(!start||!end){showToast('Completá los horarios');return;}if(start===end){showToast('Inicio y fin no pueden ser iguales');return;}
  const conflict=hasOverlap(start,end);if(conflict){errEl.textContent=`Choca con "${conflict}".`;errEl.style.display='block';return;}
  const days=newActDays.length?[...newActDays]:[...ALL_DAYS];
  activities.push({id:'a'+Date.now(),name,start,end,color:selectedColor,done:false,days});
  saveData();document.getElementById('f-name').value='';
  newActDays=[...ALL_DAYS];buildDayPicker('f-days',newActDays,null);
  document.getElementById('add-form').classList.remove('open');document.getElementById('add-toggle-btn').style.display='';render();showToast('✓ Actividad agregada');
};
window.openEdit=function(id){editingId=id;const act=activities.find(a=>a.id===id);if(!act)return;document.getElementById('e-name').value=act.name;document.getElementById('e-start').value=act.start;document.getElementById('e-end').value=act.end;editColor=act.color;editActDays=act.days?[...act.days]:[...ALL_DAYS];buildEditColorPicker(act.color);buildDayPicker('e-days',editActDays,null);document.getElementById('e-overlap-err').style.display='none';document.getElementById('edit-modal').style.display='flex';};
window.closeEdit=function(){document.getElementById('edit-modal').style.display='none';editingId=null;};
window.saveEdit=function(){
  const name=document.getElementById('e-name').value.trim(),start=document.getElementById('e-start').value,end=document.getElementById('e-end').value;
  const errEl=document.getElementById('e-overlap-err');errEl.style.display='none';
  if(!name){showToast('Escribí un nombre');return;}if(!start||!end){showToast('Completá los horarios');return;}
  const act=activities.find(a=>a.id===editingId);if(!act)return;
  if(start===end&&start!==act.start){showToast('Inicio y fin no pueden ser iguales');return;}
  const conflict=hasOverlap(start,end,editingId);if(conflict){errEl.textContent=`Choca con "${conflict}".`;errEl.style.display='block';return;}
  act.name=name;act.start=start;act.end=end;act.color=editColor;act.days=editActDays.length?[...editActDays]:[...ALL_DAYS];saveData();closeEdit();render();showToast('✓ Guardado');
};
function buildColorPicker(){const row=document.getElementById('color-row');COLORS.forEach(c=>{const sw=document.createElement('div');sw.className='color-swatch'+(c===selectedColor?' selected':'');sw.style.background=c;sw.onclick=()=>{selectedColor=c;document.querySelectorAll('#color-row .color-swatch').forEach(s=>s.classList.remove('selected'));sw.classList.add('selected');};row.appendChild(sw);});}
function buildEditColorPicker(current){const row=document.getElementById('edit-color-row');row.innerHTML='';COLORS.forEach(c=>{const sw=document.createElement('div');sw.className='color-swatch'+(c===current?' selected':'');sw.style.background=c;sw.onclick=()=>{editColor=c;document.querySelectorAll('#edit-color-row .color-swatch').forEach(s=>s.classList.remove('selected'));sw.classList.add('selected');};row.appendChild(sw);});}

// ══════════════════════════════════════════════════════════
// TIENDA
// ══════════════════════════════════════════════════════════
const STORE_ITEMS=[{id:'streak_recover',icon:'⚡',name:'Recuperador de racha',desc:'Restaura tu racha aunque hayas fallado ayer.',cost:50,max:3},{id:'day_shield',icon:'🛡️',name:'Escudo para hoy',desc:'Protege tu racha hoy aunque no llegues al 100%.',cost:30,max:3},{id:'next_shield',icon:'🔮',name:'Escudo para mañana',desc:'Activa un escudo para mañana.',cost:30,max:3},{id:'double_star',icon:'🌟',name:'Doble estrella (24h)',desc:'Ganás 2 estrellas por actividad durante 24 horas.',cost:80,max:1}];
function renderStore(){
  const avail=getAvailableStars();document.getElementById('store-stars').textContent=avail;const inv=getInventory();
  document.getElementById('store-grid').innerHTML=STORE_ITEMS.map(item=>{const qty=inv[item.id]||0,canBuy=avail>=item.cost&&qty<item.max;const qtyBadge=qty>0?`<div class="store-item-qty">En mochila: ${qty}/${item.max}</div>`:'';return`<div class="store-item ${qty>0?'owned':''}"><div class="store-item-icon">${item.icon}</div><div class="store-item-name">${item.name}</div><div class="store-item-desc">${item.desc}</div>${qtyBadge}<button class="store-buy-btn" ${canBuy?'':'disabled'} onclick="buyItem('${item.id}')">⭐ ${item.cost}</button></div>`;}).join('');
  renderBackpack();
}
function renderBackpack(){
  const inv=getInventory();const ds=localStorage.getItem('dhv_double_star_until');const doubleActive=ds&&Date.now()<parseInt(ds);
  const el=document.getElementById('backpack-grid');if(!el)return;
  el.innerHTML=STORE_ITEMS.map(item=>{const qty=inv[item.id]||0;let actionHtml='';
    if(qty<=0){actionHtml=`<span class="bp-empty-label">Sin stock</span>`;}
    else if(item.id==='day_shield'&&hasTodayShield()){actionHtml=`<span class="bp-active-badge">🛡️ Activo hoy</span>`;}
    else if(item.id==='next_shield'&&hasTomorrowShield()){actionHtml=`<span class="bp-active-badge">🔮 Activo mañana</span>`;}
    else if(item.id==='double_star'&&doubleActive){actionHtml=`<span class="bp-active-badge">🌟 Activo (24h)</span>`;}
    else{actionHtml=`<button class="bp-use-btn" onclick="useItem('${item.id}')">Usar</button>`;}
    return`<div class="bp-slot ${qty>0?'bp-has-item':'bp-empty-slot'}">${qty>0?`<div class="bp-qty-badge">x${qty}</div>`:''}<div class="bp-slot-icon">${item.icon}</div><div class="bp-slot-name">${item.name}</div><div class="bp-slot-desc">${item.desc}</div>${actionHtml}</div>`;
  }).join('');
}
window.buyItem=function(itemId){const item=STORE_ITEMS.find(i=>i.id===itemId);if(!item)return;const avail=getAvailableStars();if(avail<item.cost){showToast('No tenés suficientes ⭐');return;}const inv=getInventory();if((inv[itemId]||0)>=item.max){showToast('Ya tenés el máximo');return;}openConfirm('Confirmar compra',`¿Comprar "${item.name}" por ${item.cost} ⭐?`,()=>{addSpentStars(item.cost);inv[itemId]=(inv[itemId]||0)+1;saveInventory(inv);const d=new Date();addPurchaseHistory({id:itemId,cost:item.cost,date:`${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`});showToast('✅ Comprado — revisá tu mochila 🎒');renderStore();document.getElementById('sb-count').textContent=getAvailableStars();},'Comprar');};
window.useItem=function(itemId){const item=STORE_ITEMS.find(i=>i.id===itemId);if(!item)return;const inv=getInventory();if(!inv[itemId]||inv[itemId]<=0){showToast('No tenés este item');return;}
  if(itemId==='streak_recover'){openConfirm('Usar Recuperador','Restaura tu racha contando ayer como completado.',()=>{const hist=getHistory();const d=new Date();d.setDate(d.getDate()-1);const yk=getDateKey(d);const entry=hist.find(h=>h.key===yk);if(entry){entry.done=entry.total;entry.recovered=true;localStorage.setItem('dhv_history',JSON.stringify(hist));}else{saveHistoryDay({key:yk,total:1,done:1,skipped:false,recovered:true,acts:[]});}localStorage.setItem(`dhv_shield_used_${yk}`,'1');inv[itemId]--;saveInventory(inv);showToast('⚡ Racha recuperada');renderStore();render();},'Usar');}
  else if(itemId==='day_shield'){openConfirm('Escudo hoy','Tu racha queda protegida hoy.',()=>{activateTodayShield();localStorage.setItem(`dhv_shield_used_${todayKey}`,'1');inv[itemId]--;saveInventory(inv);showToast('🛡️ Escudo activado');renderStore();render();},'Activar');}
  else if(itemId==='next_shield'){openConfirm('Escudo mañana','Tu racha de mañana queda protegida.',()=>{activateTomorrowShield();const d=new Date();d.setDate(d.getDate()+1);localStorage.setItem(`dhv_shield_used_${getDateKey(d)}`,'1');inv[itemId]--;saveInventory(inv);showToast('🔮 Escudo para mañana');renderStore();},'Activar');}
  else if(itemId==='double_star'){openConfirm('Doble estrella','Ganás 2 estrellas por actividad durante 24h.',()=>{localStorage.setItem('dhv_double_star_until',Date.now()+86400000);inv[itemId]--;saveInventory(inv);showToast('🌟 ¡Doble estrella!');renderStore();},'Activar');}
};

// ══════════════════════════════════════════════════════════
// DÍA LIBRE
// ══════════════════════════════════════════════════════════
window.openRestDayModal=function(){const cur=getRestDay();document.getElementById('rest-day-modal').style.display='flex';renderRestDayModal(cur);};
window.closeRestDayModal=function(){document.getElementById('rest-day-modal').style.display='none';};
function renderRestDayModal(selected){
  const body=document.getElementById('rest-day-body');
  const days=DAY_NAMES_FULL.map((name,i)=>`<div class="rest-day-option ${selected===i?'rest-day-selected':''}" onclick="selectRestDay(${i})"><span class="rest-day-check">${selected===i?'✓':''}</span><span>${name}</span></div>`).join('');
  body.innerHTML=`<div class="rest-day-info">🏖️ Elegí <strong>un día a la semana</strong> como día libre. Ese día contará como 100% y no romperá tu racha.</div>${days}<div class="rest-day-none ${selected===null?'rest-day-selected':''}" onclick="selectRestDay(null)"><span class="rest-day-check">${selected===null?'✓':''}</span><span>Sin día libre</span></div>`;
}
window.selectRestDay=function(day){setRestDay(day);closeRestDayModal();render();if(day!==null)showToast(`🏖️ Día libre: ${DAY_NAMES_FULL[day]}`);else showToast('Sin día libre configurado');};

// ══════════════════════════════════════════════════════════
// TABS & HISTORY
// ══════════════════════════════════════════════════════════
function formatDaysLabel(days){if(!days||days.length===7)return '';if(days.length===5&&!days.includes(0)&&!days.includes(6))return 'Lun–Vie';if(days.length===2&&days.includes(0)&&days.includes(6))return 'Fines de semana';return days.map(d=>DAY_NAMES[d]).join(' ');}
window.switchTab=function(tab){
  ['main','hist-view','profile-view','store-view','missions-view','config-view','friends-view'].forEach(id=>document.getElementById(id).style.display='none');
  const map={hoy:'main',hist:'hist-view',profile:'profile-view',store:'store-view',missions:'missions-view',config:'config-view',friends:'friends-view'};
  document.getElementById(map[tab]||'main').style.display='block';
  const titles={hoy:'Hoy',hist:'Historial',profile:'Perfil & Logros',store:'Tienda',missions:'Misiones',config:'⚙️ Configuración',friends:'👥 Amigos & Desafíos'};
  document.getElementById('top-bar-title').textContent=titles[tab]||'Hoy';
  ['hoy','hist','profile','store','missions','config','friends'].forEach(t=>document.getElementById('dnav-'+t)?.classList.toggle('active',t===tab));
  if(tab==='hist')renderHistory();if(tab==='profile')renderProfile();if(tab==='store')renderStore();if(tab==='missions')renderMissionsPage();if(tab==='config')renderConfigView();if(tab==='friends')renderFriendsView();
};
function getDayData(key){const hist=getHistory();if(key===todayKey&&activities.length>0){return{key:todayKey,total:activities.length,done:activities.filter(a=>a.done).length,skipped:false,acts:activities.map(a=>({id:a.id,name:a.name,color:a.color,done:a.done,manualSkip:isSkippedAct(a.id)})),isToday:true};}return hist.find(h=>h.key===key)||null;}
window.changeMonth=function(delta){calViewMonth+=delta;if(calViewMonth>11){calViewMonth=0;calViewYear++;}if(calViewMonth<0){calViewMonth=11;calViewYear--;}renderCalendar();};
function renderCalendar(){
  const meses=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  document.getElementById('cal-month-title').textContent=`${meses[calViewMonth]} ${calViewYear}`;
  const dias=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'],todayStr=getTodayKey();
  document.getElementById('cal-weekdays').innerHTML=dias.map(d=>`<div class="cal-weekday">${d}</div>`).join('');
  const firstDay=new Date(calViewYear,calViewMonth,1),lastDay=new Date(calViewYear,calViewMonth+1,0),startDow=firstDay.getDay(),totalDays=lastDay.getDate();
  let cells='';for(let i=0;i<startDow;i++)cells+=`<div class="cal-day cal-empty"></div>`;
  for(let d=1;d<=totalDays;d++){const key=`${calViewYear}-${String(calViewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const isFuture=key>todayStr,isToday=key===todayStr;const isRestFuture=isKeyRestDay(key);let cls='cal-day';if(isToday)cls+=' today-cell';if(isFuture){cells+=`<div class="${cls} pct-future"><div class="cal-day-num">${d}</div>${isRestFuture?'<div class="cal-rest-icon">🏖</div>':''}</div>`;continue;}const data=getDayData(key);const isRest=data?data.restDay:isKeyRestDay(key);const pct=data?calcSnapPct(data):null;if(isRest)cls+=' pct-full cal-rest-day';else if(pct===null)cls+=' pct-0';else if(pct<31)cls+=' pct-low';else if(pct<70)cls+=' pct-mid';else if(pct<100)cls+=' pct-high';else cls+=' pct-full';cells+=`<div class="${cls}" onmouseenter="showCalTooltip(event,'${key}')" onmouseleave="hideCalTooltip()"><div class="cal-day-num">${d}</div>${isRest?'<div class="cal-rest-icon">🏖</div>':data&&pct!==null&&pct>0?'<div class="cal-dot"></div>':''}</div>`;}
  document.getElementById('cal-days').innerHTML=cells;
}
window.showCalTooltip=function(e,key){const tt=document.getElementById('cal-tooltip');const data=getDayData(key);const[y,m,d]=key.split('-').map(Number);const date=new Date(y,m-1,d);const dias=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'],meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];tt.querySelector('.tt-date').textContent=`${dias[date.getDay()]} ${d} ${meses[m-1]} ${y}`;const isRest=data?data.restDay:isKeyRestDay(key);if(isRest){tt.querySelector('.tt-pct').textContent='🏖️ Día libre';tt.querySelector('.tt-acts').innerHTML='';}else if(!data){tt.querySelector('.tt-pct').textContent='Sin actividades';tt.querySelector('.tt-acts').innerHTML='';}else if(data.skipped){tt.querySelector('.tt-pct').textContent='Día saltado';tt.querySelector('.tt-acts').innerHTML='';}else{const pct=calcSnapPct(data);tt.querySelector('.tt-pct').textContent=(pct!==null?pct:'0')+'% completado';if(data.acts)tt.querySelector('.tt-acts').innerHTML=data.acts.slice(0,5).map(a=>`<div class="tt-act-row"><div class="tt-dot" style="background:${a.color}"></div><span style="${a.manualSkip?'text-decoration:line-through;opacity:0.5':''}${a.done?'color:#4eddb4':''}">${a.name}</span></div>`).join('')+(data.acts.length>5?`<div style="font-size:0.6rem;color:var(--text3)">+${data.acts.length-5} más</div>`:'');}tt.style.opacity='1';tt.style.left=Math.min(e.clientX+14,window.innerWidth-200)+'px';tt.style.top=Math.min(e.clientY+14,window.innerHeight-160)+'px';};
window.hideCalTooltip=function(){document.getElementById('cal-tooltip').style.opacity='0';};
function getDurationMin(act){const s=timeToMin(act.start),e=timeToMin(act.end);return e>s?e-s:e+1440-s;}
function buildTimeStats(){
  const hist=getHistory();const statsMap={};
  activities.forEach(act=>{statsMap[act.name]={name:act.name,color:act.color,totalMin:0,daysCount:0};});
  hist.forEach(day=>{if(!day.acts||day.restDay||day.skipped)return;day.acts.forEach(a=>{if(!a.done)return;const liveAct=activities.find(x=>x.name===a.name||x.id===a.id);const durMin=liveAct?getDurationMin(liveAct):60;if(!statsMap[a.name])statsMap[a.name]={name:a.name,color:a.color||'#7F77DD',totalMin:0,daysCount:0};statsMap[a.name].totalMin+=durMin;statsMap[a.name].daysCount+=1;});});
  activities.filter(a=>a.done).forEach(a=>{const dur=getDurationMin(a);if(!statsMap[a.name])statsMap[a.name]={name:a.name,color:a.color,totalMin:0,daysCount:0};statsMap[a.name].totalMin+=dur;statsMap[a.name].daysCount+=1;});
  return Object.values(statsMap).filter(s=>s.totalMin>0).sort((a,b)=>b.totalMin-a.totalMin);
}
function fmtTime(min){if(min<60)return`${Math.round(min)}min`;const h=Math.floor(min/60),m=Math.round(min%60);return m>0?`${h}h ${m}min`:`${h}h`;}
let selectedBarAct=null;
function renderTimeAnalysis(){
  const container=document.getElementById('time-analysis');if(!container)return;
  const stats=buildTimeStats();const hist=getHistory();const totalDaysTracked=Math.max(hist.length,1);
  if(!stats.length){container.innerHTML='<div class="empty-state"><p>📊</p><p>Completá actividades para ver tu análisis de tiempo.</p></div>';return;}
  const maxMin=stats[0].totalMin;
  function getProjection(s){const avgPerDay=s.totalMin/Math.max(s.daysCount,1);const daysPerWeek=s.daysCount>0?Math.min(s.daysCount/Math.max(totalDaysTracked/7,1),7):1;const perWeek=avgPerDay*daysPerWeek;const perMonth=perWeek*4.33;const perYear=perWeek*52;return{avgPerDay,daysPerWeek,perWeek,perMonth,perYear};}
  const barsHTML=stats.map((s,i)=>{const pct=Math.max((s.totalMin/maxMin)*100,3);return`<div class="ta-bar-row" onclick="selectTimeBar(${i})" id="tabar-${i}"><div class="ta-bar-label"><span class="ta-dot" style="background:${s.color}"></span><span class="ta-name">${s.name}</span><span class="ta-total">${fmtTime(s.totalMin)}</span></div><div class="ta-bar-track"><div class="ta-bar-fill" style="background:${s.color};width:0%" data-target="${pct.toFixed(1)}"></div></div><div class="ta-projection hidden" id="taproj-${i}"></div></div>`;}).join('');
  container.innerHTML=`<div class="ta-wrap"><div class="ta-hint">Tocá una barra para ver la proyección 👆</div><div class="ta-bars" id="ta-bars">${barsHTML}</div></div>`;
  container._stats=stats;container._getProjection=getProjection;
  requestAnimationFrame(()=>{document.querySelectorAll('.ta-bar-fill').forEach((bar,i)=>{const target=bar.dataset.target;setTimeout(()=>{bar.style.transition=`width 0.7s cubic-bezier(.4,0,.2,1)`;bar.style.width=target+'%';},i*90+80);});});
}
window.selectTimeBar=function(idx){
  const container=document.getElementById('time-analysis');if(!container||!container._stats)return;
  const stats=container._stats;const getProjection=container._getProjection;
  if(selectedBarAct===idx){selectedBarAct=null;document.querySelectorAll('.ta-bar-row').forEach(r=>r.classList.remove('ta-bar-active'));document.querySelectorAll('.ta-projection').forEach(p=>{p.classList.add('hidden');p.innerHTML='';});return;}
  selectedBarAct=idx;document.querySelectorAll('.ta-bar-row').forEach((r,i)=>r.classList.toggle('ta-bar-active',i===idx));document.querySelectorAll('.ta-projection').forEach((p,i)=>{if(i!==idx){p.classList.add('hidden');p.innerHTML='';}});
  const s=stats[idx];const proj=getProjection(s);const projEl=document.getElementById(`taproj-${idx}`);if(!projEl)return;
  projEl.innerHTML=`<div class="ta-proj-grid"><div class="ta-proj-item"><div class="ta-proj-val">${fmtTime(proj.perWeek)}</div><div class="ta-proj-lbl">por semana</div></div><div class="ta-proj-item"><div class="ta-proj-val">${fmtTime(proj.perMonth)}</div><div class="ta-proj-lbl">por mes</div></div><div class="ta-proj-item"><div class="ta-proj-val">${fmtTime(proj.perYear)}</div><div class="ta-proj-lbl">por año</div></div></div><div class="ta-proj-avg">Promedio: ${fmtTime(proj.avgPerDay)}/día · ~${proj.daysPerWeek.toFixed(1)} días/sem</div>`;
  projEl.classList.remove('hidden');projEl.style.opacity='0';projEl.style.transform='translateY(-6px)';requestAnimationFrame(()=>{projEl.style.transition='opacity 0.3s ease, transform 0.3s ease';projEl.style.opacity='1';projEl.style.transform='translateY(0)';});
};
function renderHistory(){
  const hist=getHistory();const todayEntry=activities.length?getDayData(todayKey):null;const allEntries=todayEntry?[todayEntry,...hist.filter(h=>h.key!==todayKey)]:hist;
  document.getElementById('hist-subtitle').textContent=`${allEntries.length} días · ${allEntries.filter(d=>calcSnapPct(d)===100).length} perfectos`;
  renderCalendar();renderMiniChart();selectedBarAct=null;renderTimeAnalysis();
}
function renderMiniChart(){
  const hist=getHistory();const days=[];for(let i=13;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const k=getDateKey(d);if(k===todayKey&&activities.length>0){days.push(getDayData(todayKey));continue;}days.push(hist.find(h=>h.key===k)||{key:k,total:0,done:0,skipped:false,empty:true});}
  const weekdays=['D','L','M','M','J','V','S'];
  document.getElementById('mini-chart').innerHTML=days.map(day=>{const[y,m,d]=day.key.split('-').map(Number);const wd=weekdays[new Date(y,m-1,d).getDay()];const pct=day.empty?null:calcSnapPct(day);const dispPct=pct===null?0:pct<0?10:pct;const barClass=day.skipped?'skipped-bar':pct===100?'full':pct===0||pct===null?'zero':'';const isToday=day.key===todayKey;return`<div class="mini-bar-wrap"><div class="mini-bar-bg"><div class="mini-bar ${barClass}" style="height:${day.empty?0:dispPct}%"></div></div><div class="mini-day" style="color:${isToday?'var(--purple-light)':'var(--text3)'};">${wd}</div></div>`;}).join('');
}

// ══════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2700);}
function launchConfetti(){const canvas=document.getElementById('confetti-canvas');const ctx=canvas.getContext('2d');canvas.width=window.innerWidth;canvas.height=window.innerHeight;const pieces=Array.from({length:80},()=>({x:Math.random()*canvas.width,y:-10,vx:(Math.random()-.5)*6,vy:Math.random()*4+2,color:COLORS[Math.floor(Math.random()*COLORS.length)],w:Math.random()*10+4,h:Math.random()*7+3,rot:Math.random()*360,rv:(Math.random()-.5)*12}));let f=0;function anim(){ctx.clearRect(0,0,canvas.width,canvas.height);pieces.forEach(p=>{ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot*Math.PI/180);ctx.fillStyle=p.color;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore();p.x+=p.vx;p.y+=p.vy;p.rot+=p.rv;p.vy+=0.09;});f++;if(f<140)requestAnimationFrame(anim);else ctx.clearRect(0,0,canvas.width,canvas.height);}anim();}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
function initApp(){
  loadData();updateDate();buildColorPicker();applyModeTheme(getMode());
  newActDays=[...ALL_DAYS];buildDayPicker('f-days',newActDays,null);
  render();initParticles();
  tutPage=0;if(!localStorage.getItem('dhv_tutorial_seen')){document.getElementById('tutorial').style.display='flex';renderTutPage();}
  document.getElementById('f-name').addEventListener('keydown',e=>{if(e.key==='Enter')saveActivity();});
  document.getElementById('e-name').addEventListener('keydown',e=>{if(e.key==='Enter')saveEdit();});
  document.getElementById('edit-modal').addEventListener('click',e=>{if(e.target===document.getElementById('edit-modal'))closeEdit();});
  document.getElementById('confirm-overlay').addEventListener('click',e=>{if(e.target===document.getElementById('confirm-overlay'))closeConfirm();});
  document.getElementById('mode-modal').addEventListener('click',e=>{if(e.target===document.getElementById('mode-modal'))closeModeSelector();});
  document.getElementById('rest-day-modal').addEventListener('click',e=>{if(e.target===document.getElementById('rest-day-modal'))closeRestDayModal();});
  setInterval(()=>{checkExpiredActivities();render();},60000);
  // Check URL params for shortcuts
  const params=new URLSearchParams(window.location.search);
  const tab=params.get('tab');if(tab)switchTab(tab);
  hideLoadingScreen();
}

function hideLoadingScreen(){
  const el=document.getElementById('loading-screen');
  if(!el)return;
  el.classList.add('hide');
  setTimeout(()=>el.remove(),550);
}

// ── ARRANQUE CON FIREBASE AUTH ──
registerSW();

onAuthChange(async (user) => {
  currentUser = user;
  renderDrawerUser(user); // primer render rápido (sin username todavía)
  await setupSocialFeatures();
  renderDrawerUser(user); // segundo render ya con username si existe

  if (user) {
    // Usuario logueado
    hideAuthScreen();
    try {
      const result = await mergeWithCloud(user.uid);
      loadData();
      render();
      if (result === 'pulled') showToast('☁️ Progreso restaurado');
    } catch(e) { console.warn('merge error', e); }
    initApp();
  } else {
    // No logueado: mostrar pantalla de auth solo si es la primera vez
    const skipped = localStorage.getItem('dhv_auth_skipped');
    if (!skipped) {
      showAuthScreen();
    } else {
      initApp();
    }
  }
});

// ══════════════════════════════════════════════════════════
// CONFIG VIEW
// ══════════════════════════════════════════════════════════
function renderConfigView() {
  const container = document.getElementById('config-view');
  if (!container) return;

  // ── Cuenta ──
  let accountHTML;
  if (currentUser) {
    const avatarHtml = currentUser.photoURL
      ? `<img src="${currentUser.photoURL}" alt="avatar"/>`
      : `<span>${currentUser.displayName ? currentUser.displayName[0].toUpperCase() : 'U'}</span>`;
    const cfgName = (myProfile && myProfile.username) ? '@'+myProfile.username : (currentUser.displayName || 'Usuario');
    const cfgSub = (myProfile && myProfile.username) ? (currentUser.displayName||currentUser.email||'') : (currentUser.email||'');
    accountHTML = `
      <div class="config-user-card">
        <div class="config-user-avatar">${avatarHtml}</div>
        <div class="config-user-info">
          <div class="config-user-name">${cfgName}</div>
          <div class="config-user-email">${cfgSub}</div>
          <div class="config-badge-cloud">☁️ Sincronizado con Google</div>
        </div>
      </div>
      <div class="config-row">
        <div class="config-row-icon">☁️</div>
        <div class="config-row-text">
          <div class="config-row-title">Sincronizar ahora</div>
          <div class="config-row-sub">Subir tu progreso actual a la nube</div>
        </div>
        <div class="config-row-action">
          <button class="config-btn secondary" onclick="manualSync()">Sincronizar</button>
        </div>
      </div>
      <div class="config-row">
        <div class="config-row-icon">🚪</div>
        <div class="config-row-text">
          <div class="config-row-title">Cerrar sesión</div>
          <div class="config-row-sub">Tu progreso queda guardado en la nube</div>
        </div>
        <div class="config-row-action">
          <button class="config-btn danger" onclick="handleLogout()">Salir</button>
        </div>
      </div>`;
  } else {
    accountHTML = `
      <div class="config-user-card">
        <div class="config-user-avatar">👤</div>
        <div class="config-user-info">
          <div class="config-user-name">Sin cuenta</div>
          <div class="config-user-email">Solo en este dispositivo</div>
          <div class="config-badge-local">📱 Local</div>
        </div>
      </div>
      <div class="config-row">
        <div class="config-row-icon">🔑</div>
        <div class="config-row-text">
          <div class="config-row-title">Iniciar sesión con Google</div>
          <div class="config-row-sub">Guardá tu progreso en la nube y accedé desde cualquier dispositivo</div>
        </div>
        <div class="config-row-action">
          <button class="config-btn" onclick="loginFromConfig()">Entrar</button>
        </div>
      </div>`;
  }

  // ── Notificaciones ──
  const notifGranted = 'Notification' in window && Notification.permission === 'granted';
  const notifDenied = 'Notification' in window && Notification.permission === 'denied';
  let notifHTML;
  if (!('Notification' in window)) {
    notifHTML = `
      <div class="config-row">
        <div class="config-row-icon">🔔</div>
        <div class="config-row-text">
          <div class="config-row-title">Notificaciones</div>
          <div class="config-row-sub">Tu navegador no soporta notificaciones</div>
        </div>
      </div>`;
  } else if (notifDenied) {
    notifHTML = `
      <div class="config-row">
        <div class="config-row-icon">🔕</div>
        <div class="config-row-text">
          <div class="config-row-title">Notificaciones bloqueadas</div>
          <div class="config-row-sub">Activalas desde la configuración de tu navegador (ícono 🔒 en la barra de dirección)</div>
        </div>
      </div>`;
  } else if (notifGranted) {
    notifHTML = `
      <div class="config-row">
        <div class="config-row-icon">🔔</div>
        <div class="config-row-text">
          <div class="config-row-title">Notificaciones activas</div>
          <div class="config-row-sub">Te avisamos a las 20:00 si no terminaste el día</div>
        </div>
        <div class="config-row-action">
          <span class="config-btn success">✓ Activas</span>
        </div>
      </div>`;
  } else {
    notifHTML = `
      <div class="config-row">
        <div class="config-row-icon">🔔</div>
        <div class="config-row-text">
          <div class="config-row-title">Activar notificaciones</div>
          <div class="config-row-sub">Te avisamos a las 20:00 si no terminaste el día</div>
        </div>
        <div class="config-row-action">
          <button class="config-btn" onclick="enableNotifsFromConfig()">Activar</button>
        </div>
      </div>`;
  }

  // ── PWA ──
  const isPWA = window.matchMedia('(display-mode: standalone)').matches;
  const pwaHTML = `
    <div class="config-row">
      <div class="config-row-icon">📱</div>
      <div class="config-row-text">
        <div class="config-row-title">Instalar app</div>
        <div class="config-row-sub">${isPWA ? 'Ya está instalada en tu dispositivo' : 'Instalá DesafioHV en tu pantalla de inicio'}</div>
      </div>
      <div class="config-row-action">
        ${isPWA
          ? `<span class="config-btn success">✓ Instalada</span>`
          : deferredInstallPrompt
            ? `<button class="config-btn" onclick="installPWAFromConfig()">Instalar</button>`
            : `<span style="font-size:0.72rem;color:var(--text3)">Usá el menú del navegador</span>`
        }
      </div>
    </div>`;

  container.innerHTML = `
    <div class="config-section">
      <div class="config-section-title">Cuenta</div>
      ${accountHTML}
    </div>
    <div class="config-section">
      <div class="config-section-title">Notificaciones</div>
      ${notifHTML}
    </div>
    <div class="config-section">
      <div class="config-section-title">Aplicación</div>
      ${pwaHTML}
      <div class="config-row">
        <div class="config-row-icon">🎮</div>
        <div class="config-row-text">
          <div class="config-row-title">Modo de juego</div>
          <div class="config-row-sub">Fácil · Media · Difícil</div>
        </div>
        <div class="config-row-action">
          <button class="config-btn secondary" onclick="openModeSelector()">Cambiar</button>
        </div>
      </div>
      <div class="config-row">
        <div class="config-row-icon">🏖️</div>
        <div class="config-row-text">
          <div class="config-row-title">Día libre semanal</div>
          <div class="config-row-sub">${getRestDay() !== null ? 'Configurado: ' + DAY_NAMES_FULL[getRestDay()] : 'Sin día libre'}</div>
        </div>
        <div class="config-row-action">
          <button class="config-btn secondary" onclick="openRestDayModal()">Cambiar</button>
        </div>
      </div>
      <div class="config-row">
        <div class="config-row-icon">❓</div>
        <div class="config-row-text">
          <div class="config-row-title">Ver tutorial</div>
          <div class="config-row-sub">Repasá cómo funciona la app</div>
        </div>
        <div class="config-row-action">
          <button class="config-btn secondary" onclick="tutPage=0;document.getElementById('tutorial').style.display='flex';document.getElementById('tutorial').style.opacity='1';renderTutPage()">Ver</button>
        </div>
      </div>
    </div>`;
}

window.loginFromConfig = async function() {
  let user;
  try {
    user = await loginWithGoogle();
  } catch(e) {
    console.error('[login error]', e);
    showToast('❌ Error al iniciar sesión');
    return;
  }
  showToast('✅ Bienvenido, ' + user.displayName.split(' ')[0] + '!');
  localStorage.removeItem('dhv_auth_skipped');
  try {
    const result = await mergeWithCloud(user.uid);
    if (result === 'pulled') { loadData(); render(); showToast('☁️ Progreso restaurado desde la nube'); }
    else showSyncIndicator();
  } catch(e) {
    console.error('[sync error]', e);
    showToast('⚠️ Sesión iniciada, pero hubo un problema al sincronizar');
  }
  renderConfigView();
  renderDrawerUser(currentUser);
};

window.enableNotifsFromConfig = async function() {
  const granted = await requestNotifPermission();
  if (granted) {
    showToast('🔔 Notificaciones activadas');
    navigator.serviceWorker.ready.then(reg => scheduleNotifications(reg));
  } else {
    showToast('⚠️ Permiso denegado en el navegador');
  }
  renderConfigView();
};

window.installPWAFromConfig = async function() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  if (outcome === 'accepted') showToast('🎉 ¡Instalando DesafioHV!');
  renderConfigView();
};

// ══════════════════════════════════════════════════════════
// AMIGOS & DESAFÍOS
// ══════════════════════════════════════════════════════════
let myProfile = null;          // { username, friendCode, friends, totalStars }
let friendsListCache = [];
let challengesCache = [];
let unsubFriendRequests = null;
let unsubChallenges = null;
let challengeUnsubs = {};      // challengeId -> unsub function (para listeners individuales si hace falta)
let friendRequestsCache = [];
let cmSelectedFriendUid = null;
let cmSelectedType = null;
let cmSelectedDuration = 7;
let afActiveTab = 'username';

// ── Métricas en vivo para desafíos ──
function getChallengeMetricSnapshot() {
  return {
    streak: calcStreak(),
    starsGained: getTotalStars(),       // usamos total acumulado; el delta se calcula contra el snapshot inicial
    actsCompleted: getHistory().reduce((s,h)=> s + (h.done||0), 0) + activities.filter(a=>a.done).length,
    perfectDays: calcTotalPerfect(),
  };
}

// Cuando arranca un desafío 'active' por primera vez para mí, necesito mi snapshot base.
// Lo guardamos localmente por challengeId para calcular el delta sin tocar las reglas de Firestore.
function getOrSetBaseline(challengeId, type) {
  const key = `dhv_chal_base_${challengeId}`;
  let raw = localStorage.getItem(key);
  if (raw) return JSON.parse(raw);
  const snap = getChallengeMetricSnapshot();
  localStorage.setItem(key, JSON.stringify(snap));
  return snap;
}

function computeMyChallengeValue(challenge) {
  const type = challenge.type;
  const baseline = getOrSetBaseline(challenge.id, type);
  const current = getChallengeMetricSnapshot();
  if (type === 'streak') return current.streak; // racha es absoluta, no delta
  return Math.max(0, current[CHALLENGE_TYPES[type].metricKey] - baseline[CHALLENGE_TYPES[type].metricKey]);
}

async function pushMyChallengeProgress(challenge) {
  if (!currentUser) return;
  const isFromSide = challenge.fromUid === currentUser.uid;
  const myVal = computeMyChallengeValue(challenge);
  const currentVal = isFromSide ? challenge.fromProgress : challenge.toProgress;
  if (myVal === currentVal) return;
  try { await updateChallengeProgress(challenge.id, isFromSide, myVal); } catch(e) { console.warn('[challenge progress]', e); }
}

// Revisa desafíos activos y empuja mi progreso + detecta vencimiento
async function tickChallenges() {
  if (!currentUser || !challengesCache.length) return;
  const now = Date.now();
  for (const c of challengesCache) {
    if (c.status !== 'active') continue;
    await pushMyChallengeProgress(c);
    if (c.endsAtMs && now >= c.endsAtMs) {
      const winnerUid = c.fromProgress === c.toProgress ? null
        : (c.fromProgress > c.toProgress ? c.fromUid : c.toUid);
      try { await finishChallenge(c.id, winnerUid); } catch(e) {}
    }
  }
}

// ── Username setup ──
let usernameCheckTimer = null;
window.checkUsernameAvailability = function(val) {
  clearTimeout(usernameCheckTimer);
  const statusEl = document.getElementById('username-status');
  if (!statusEl) return;
  const err = validateUsername(val);
  if (!val) { statusEl.textContent = ''; return; }
  if (err) { statusEl.textContent = '⚠️ ' + err; statusEl.className = 'username-status err'; return; }
  statusEl.textContent = 'Verificando...'; statusEl.className = 'username-status checking';
  usernameCheckTimer = setTimeout(async () => {
    try {
      const available = await isUsernameAvailable(val);
      if (!document.getElementById('username-status')) return;
      if (available) { statusEl.textContent = '✓ Disponible'; statusEl.className = 'username-status ok'; }
      else { statusEl.textContent = '✕ Ya está en uso'; statusEl.className = 'username-status err'; }
    } catch(e) { statusEl.textContent = ''; }
  }, 450);
};

window.submitUsername = async function() {
  const input = document.getElementById('username-input');
  const val = input.value.trim();
  const err = validateUsername(val);
  if (err) { showToast('⚠️ ' + err); return; }
  if (!currentUser) { showToast('Iniciá sesión primero'); return; }
  try {
    const result = await claimUsername(currentUser.uid, val);
    showToast(`🎉 ¡Listo, @${result.username}!`);
    await loadMyProfile();
    await reinitSocialAfterUsername();
    renderFriendsView();
    renderProfile(); // el nombre de perfil ahora muestra el username
  } catch(e) {
    showToast('❌ ' + (e.message || 'Error al crear el nombre de usuario'));
  }
};

async function loadMyProfile() {
  if (!currentUser) { myProfile = null; return; }
  try { myProfile = await getMyProfile(currentUser.uid); } catch(e) { console.warn(e); myProfile = null; }
}

// ── Copiar código de amigo ──
window.copyFriendCode = function() {
  if (!myProfile || !myProfile.friendCode) return;
  navigator.clipboard.writeText(myProfile.friendCode).then(() => showToast('📋 Código copiado'));
};

// ── Modal agregar amigo ──
window.openAddFriendModal = function() {
  document.getElementById('add-friend-modal').style.display = 'flex';
  afActiveTab = 'username';
  renderAddFriendModal();
};
window.closeAddFriendModal = function() {
  document.getElementById('add-friend-modal').style.display = 'none';
};
window.setAfTab = function(tab) { afActiveTab = tab; renderAddFriendModal(); };

function renderAddFriendModal() {
  const body = document.getElementById('add-friend-modal-body');
  const tabs = `<div class="af-tabs">
    <div class="af-tab ${afActiveTab==='username'?'active':''}" onclick="setAfTab('username')">Por nombre</div>
    <div class="af-tab ${afActiveTab==='code'?'active':''}" onclick="setAfTab('code')">Por código</div>
  </div>`;
  if (afActiveTab === 'username') {
    body.innerHTML = tabs + `
      <div class="field"><label>Nombre de usuario</label><input type="text" id="af-username-input" placeholder="ej: juanperez" maxlength="20"/></div>
      <button class="btn-save" style="width:100%" onclick="doSearchByUsername()">Buscar</button>
      <div id="af-result"></div>`;
  } else {
    body.innerHTML = tabs + `
      <div class="field"><label>Código de amigo</label><input type="text" id="af-code-input" placeholder="ABC-1234" maxlength="8" style="text-transform:uppercase"/></div>
      <button class="btn-save" style="width:100%" onclick="doSearchByCode()">Buscar</button>
      <div id="af-result"></div>`;
  }
}

window.doSearchByUsername = async function() {
  const val = document.getElementById('af-username-input').value.trim();
  if (!val) return;
  const resultEl = document.getElementById('af-result');
  resultEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text3);font-size:0.78rem">Buscando...</div>';
  try {
    const user = await searchUserByUsername(val);
    renderAfResult(user, resultEl);
  } catch(e) { resultEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--danger);font-size:0.78rem">Error al buscar</div>'; }
};
window.doSearchByCode = async function() {
  const val = document.getElementById('af-code-input').value.trim();
  if (!val) return;
  const resultEl = document.getElementById('af-result');
  resultEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text3);font-size:0.78rem">Buscando...</div>';
  try {
    const user = await findUserByFriendCode(val);
    renderAfResult(user, resultEl);
  } catch(e) { resultEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--danger);font-size:0.78rem">Error al buscar</div>'; }
};
function renderAfResult(user, resultEl) {
  if (!user) { resultEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text3);font-size:0.78rem">No se encontró ese usuario</div>'; return; }
  if (currentUser && user.uid === currentUser.uid) { resultEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text3);font-size:0.78rem">Ese sos vos 😄</div>'; return; }
  const alreadyFriend = myProfile && myProfile.friends && myProfile.friends.includes(user.uid);
  resultEl.innerHTML = `<div class="af-search-result">
    <div class="friend-avatar">${(user.username||'U')[0].toUpperCase()}</div>
    <div class="friend-info"><div class="friend-name">@${user.username}</div><div class="friend-stars">⭐ ${user.totalStars}</div></div>
    ${alreadyFriend ? '<span style="font-size:0.7rem;color:var(--text3)">Ya son amigos</span>' : `<button class="af-send-btn" onclick="doSendFriendRequest('${user.uid}','${user.username}')">Agregar</button>`}
  </div>`;
}
window.doSendFriendRequest = async function(targetUid, targetUsername) {
  if (!currentUser || !myProfile) return;
  try {
    await sendFriendRequest(currentUser.uid, myProfile.username, targetUid);
    showToast(`✅ Solicitud enviada a @${targetUsername}`);
    closeAddFriendModal();
  } catch(e) { showToast('❌ Error al enviar solicitud'); }
};

// ── Solicitudes de amistad ──
window.doAcceptFriendRequest = async function(fromUid, fromUsername) {
  if (!currentUser || !myProfile) return;
  try {
    await acceptFriendRequest(currentUser.uid, fromUid, fromUsername, myProfile.username);
    showToast(`🤝 Ahora sos amigo de @${fromUsername}`);
    await loadMyProfile(); await refreshFriendsList(); renderFriendsView();
  } catch(e) { showToast('❌ Error al aceptar'); }
};
window.doRejectFriendRequest = async function(fromUid) {
  if (!currentUser) return;
  try { await rejectFriendRequest(currentUser.uid, fromUid); renderFriendsView(); } catch(e) {}
};
window.doRemoveFriend = function(friendUid, friendUsername) {
  openConfirm('Eliminar amigo', `¿Quitar a @${friendUsername} de tus amigos?`, async () => {
    try {
      await removeFriend(currentUser.uid, friendUid);
      showToast('Amigo eliminado');
      await loadMyProfile(); await refreshFriendsList(); renderFriendsView();
    } catch(e) { showToast('❌ Error'); }
  }, 'Eliminar');
};

async function refreshFriendsList() {
  if (!currentUser) { friendsListCache = []; return; }
  try { friendsListCache = await getFriendsList(currentUser.uid); } catch(e) { friendsListCache = []; }
}

// ── Crear desafío ──
window.openChallengeModal = function(preselectFriendUid) {
  cmSelectedFriendUid = preselectFriendUid || null;
  cmSelectedType = null;
  cmSelectedDuration = 7;
  document.getElementById('challenge-modal').style.display = 'flex';
  renderChallengeModal();
};
window.closeChallengeModal = function() { document.getElementById('challenge-modal').style.display = 'none'; };
window.cmSelectFriend = function(uid) { cmSelectedFriendUid = uid; renderChallengeModal(); };
window.cmSelectType = function(type) { cmSelectedType = type; renderChallengeModal(); };
window.cmSelectDuration = function(d) { cmSelectedDuration = d; renderChallengeModal(); };

function renderChallengeModal() {
  const body = document.getElementById('challenge-modal-body');
  if (!friendsListCache.length) {
    body.innerHTML = `<div class="empty-friends">Agregá amigos primero para poder desafiarlos 👥</div>`;
    return;
  }
  const friendsHTML = friendsListCache.map(f => `
    <div class="cm-friend-option ${cmSelectedFriendUid===f.uid?'selected':''}" onclick="cmSelectFriend('${f.uid}')">
      <div class="friend-avatar">${(f.username||'U')[0].toUpperCase()}</div>
      <div class="friend-info"><div class="friend-name">@${f.username}</div></div>
    </div>`).join('');
  const typesHTML = Object.entries(CHALLENGE_TYPES).map(([key, t]) => `
    <div class="cm-type-option ${cmSelectedType===key?'selected':''}" onclick="cmSelectType('${key}')">
      <div class="cm-type-icon">${t.icon}</div><div class="cm-type-label">${t.label}</div>
    </div>`).join('');
  const durations = [3, 7, 14, 30];
  const durationHTML = durations.map(d => `
    <div class="cm-duration-opt ${cmSelectedDuration===d?'selected':''}" onclick="cmSelectDuration(${d})">${d}d</div>`).join('');

  body.innerHTML = `
    <div class="field"><label>Elegí un amigo</label></div>
    <div class="cm-friend-select">${friendsHTML}</div>
    <div class="field"><label>Tipo de desafío</label></div>
    <div class="cm-type-grid">${typesHTML}</div>
    <div class="field"><label>Duración</label></div>
    <div class="cm-duration-row">${durationHTML}</div>
    <div class="form-actions">
      <button class="btn-cancel" onclick="closeChallengeModal()">Cancelar</button>
      <button class="btn-save" onclick="submitChallenge()">Enviar desafío</button>
    </div>`;
}

window.submitChallenge = async function() {
  if (!cmSelectedFriendUid) { showToast('Elegí un amigo'); return; }
  if (!cmSelectedType) { showToast('Elegí un tipo de desafío'); return; }
  const friend = friendsListCache.find(f => f.uid === cmSelectedFriendUid);
  if (!friend || !currentUser || !myProfile) return;
  try {
    await createChallenge(currentUser.uid, myProfile.username, friend.uid, friend.username, cmSelectedType, cmSelectedDuration);
    showToast(`⚔️ Desafío enviado a @${friend.username}`);
    closeChallengeModal();
  } catch(e) { showToast('❌ Error al crear el desafío'); }
};

// ── Aceptar / rechazar / borrar desafíos ──
window.doAcceptChallenge = async function(challengeId, durationDays) {
  try {
    await acceptChallenge(challengeId, durationDays);
    showToast('⚔️ ¡Desafío aceptado! Que gane el mejor');
  } catch(e) { showToast('❌ Error'); }
};
window.doDeclineChallenge = async function(challengeId) {
  try { await declineChallenge(challengeId); showToast('Desafío rechazado'); } catch(e) {}
};
window.doDeleteChallenge = function(challengeId) {
  openConfirm('Eliminar desafío', '¿Seguro que querés eliminarlo?', async () => {
    try { await deleteChallenge(challengeId); showToast('🗑 Eliminado'); } catch(e) {}
  }, 'Eliminar');
};

// ── Render principal de la vista Amigos & Desafíos ──
let fvActiveSubtab = 'challenges'; // 'challenges' | 'friends'
window.setFvSubtab = function(tab) { fvActiveSubtab = tab; renderFriendsView(); };

function renderFriendsView() {
  const container = document.getElementById('friends-view');
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = `<div class="no-username-card">
      <div class="no-username-icon">🔒</div>
      <div class="no-username-title">Iniciá sesión para usar Amigos & Desafíos</div>
      <div class="no-username-sub">Necesitás una cuenta de Google para agregar amigos y crear desafíos.</div>
      <button class="config-btn" onclick="switchTab('config')">Ir a Configuración</button>
    </div>`;
    return;
  }

  if (!myProfile || !myProfile.username) {
    container.innerHTML = `<div class="no-username-card">
      <div class="no-username-icon">🪪</div>
      <div class="no-username-title">Elegí tu nombre de usuario</div>
      <div class="no-username-sub">Es único y tus amigos lo usarán para encontrarte. También vas a tener un código de invitación.</div>
      <div class="username-input-row">
        <input type="text" id="username-input" placeholder="ej: juanperez" maxlength="20" oninput="checkUsernameAvailability(this.value)"/>
        <button class="config-btn" onclick="submitUsername()">Crear</button>
      </div>
      <div class="username-status" id="username-status"></div>
    </div>`;
    return;
  }

  // ── Identidad (siempre visible arriba) ──
  const idRow = `<div class="fv-id-row">
    <div class="fv-id-avatar">${myProfile.username[0].toUpperCase()}</div>
    <div class="fv-id-text">
      <div class="fv-id-username">@${myProfile.username}</div>
      <div class="fv-id-code">Código: ${myProfile.friendCode}</div>
    </div>
    <button class="fv-id-copy" onclick="copyFriendCode()">📋 Copiar</button>
  </div>`;

  // ── Sub-tabs ──
  const pendingIncoming = challengesCache.filter(c => c.status === 'pending' && c.toUid === currentUser.uid).length;
  const reqBadge = friendRequestsCache.length > 0 ? `<span class="fv-subtab-badge">${friendRequestsCache.length}</span>` : '';
  const chalBadge = pendingIncoming > 0 ? `<span class="fv-subtab-badge">${pendingIncoming}</span>` : '';
  const subtabs = `<div class="fv-subtabs">
    <div class="fv-subtab ${fvActiveSubtab==='challenges'?'active':''}" onclick="setFvSubtab('challenges')">⚔️ Desafíos${chalBadge}</div>
    <div class="fv-subtab ${fvActiveSubtab==='friends'?'active':''}" onclick="setFvSubtab('friends')">👥 Amigos${reqBadge}</div>
  </div>`;

  let panelHTML = '';
  if (fvActiveSubtab === 'challenges') {
    panelHTML = renderChallengesPanel();
  } else {
    panelHTML = renderFriendsPanel();
  }

  container.innerHTML = `
    <div class="fv-sticky-top">${idRow}${subtabs}</div>
    <div class="fv-panel">${panelHTML}</div>
  `;
}

function renderChallengeCard(c) {
  const t = CHALLENGE_TYPES[c.type] || { label: c.type, icon: '⚔️' };
  const isFromSide = c.fromUid === currentUser.uid;
  const theirName = isFromSide ? c.toUsername : c.fromUsername;
  const myVal = isFromSide ? (c.fromProgress||0) : (c.toProgress||0);
  const theirVal = isFromSide ? (c.toProgress||0) : (c.fromProgress||0);
  const total = myVal + theirVal || 1;
  const myPct = (myVal/total)*100, theirPct = (theirVal/total)*100;
  const isIncoming = c.status === 'pending' && c.toUid === currentUser.uid;
  const isOutgoingPending = c.status === 'pending' && c.fromUid === currentUser.uid;
  const statusLabels = {pending:'Pendiente',active:'En curso',finished:'Finalizado',declined:'Rechazado'};

  let metaHTML = '';
  if (c.status === 'active' && c.endsAtMs) {
    const daysLeft = Math.max(0, Math.ceil((c.endsAtMs - Date.now()) / 86400000));
    metaHTML = `<div class="fc-meta">${daysLeft} día${daysLeft!==1?'s':''} restante${daysLeft!==1?'s':''} de ${c.durationDays}</div>`;
  } else if (isOutgoingPending) {
    metaHTML = `<div class="fc-meta">⏳ Esperando respuesta de @${theirName}</div>`;
  } else if (isIncoming) {
    metaHTML = `<div class="fc-meta">Propuesta: ${c.durationDays} días</div>`;
  }

  let actionsHTML = '';
  if (isIncoming) {
    actionsHTML = `<div class="fc-actions">
      <button class="fc-accept" onclick="doAcceptChallenge('${c.id}',${c.durationDays})">Aceptar</button>
      <button class="fc-decline" onclick="doDeclineChallenge('${c.id}')">Rechazar</button>
    </div>`;
  }

  let resultHTML = '';
  if (c.status === 'finished') {
    if (!c.winnerUid) resultHTML = `<div class="fc-result lose">🤝 Empate</div>`;
    else if (c.winnerUid === currentUser.uid) resultHTML = `<div class="fc-result win">🏆 ¡Ganaste!</div>`;
    else resultHTML = `<div class="fc-result lose">😔 Ganó @${theirName}</div>`;
  } else if (c.status === 'declined') {
    resultHTML = `<div class="fc-result lose">Desafío rechazado</div>`;
  }

  const canDelete = c.status === 'finished' || c.status === 'declined' || isOutgoingPending;
  const showBar = c.status === 'active';

  return `<div class="fc-card ${c.status}">
    ${canDelete ? `<button class="fc-card-del" onclick="doDeleteChallenge('${c.id}')">🗑</button>` : ''}
    <div class="fc-card-head">
      <span class="fc-card-icon">${t.icon}</span>
      <span class="fc-card-title">${t.label}</span>
      <span class="fc-card-badge ${c.status}">${statusLabels[c.status]||c.status}</span>
    </div>
    <div class="fc-card-body">
      <div class="fc-vs">
        <div class="fc-side"><div class="fc-side-name">Vos</div><div class="fc-side-val">${myVal}</div></div>
        <div class="fc-vs-mid">VS</div>
        <div class="fc-side"><div class="fc-side-name">@${theirName}</div><div class="fc-side-val">${theirVal}</div></div>
      </div>
      ${showBar ? `<div class="fc-bar"><div class="fc-bar-mine" style="width:${myPct}%"></div><div class="fc-bar-theirs" style="width:${theirPct}%"></div></div>` : ''}
      ${metaHTML}
      ${actionsHTML}
      ${resultHTML}
    </div>
  </div>`;
}

function renderChallengesPanel() {
  const pending = challengesCache.filter(c => c.status === 'pending');
  const active = challengesCache.filter(c => c.status === 'active');
  const finished = challengesCache.filter(c => c.status === 'finished' || c.status === 'declined');

  const actionRow = `<div class="fv-action-row">
    <button class="fv-action-btn" onclick="openChallengeModal()">⚔️ Nuevo desafío</button>
  </div>`;

  if (!pending.length && !active.length && !finished.length) {
    return actionRow + `<div class="fv-empty"><span class="fv-empty-icon">⚔️</span>Todavía no tenés desafíos.<br>Elegí un amigo y desafialo a una batalla.</div>`;
  }

  let html = actionRow;
  if (pending.length) html += `<div class="fv-section-label">Pendientes <span class="fv-count-pill">${pending.length}</span></div>` + pending.map(renderChallengeCard).join('');
  if (active.length) html += `<div class="fv-section-label">En curso <span class="fv-count-pill">${active.length}</span></div>` + active.map(renderChallengeCard).join('');
  if (finished.length) html += `<div class="fv-section-label">Historial</div>` + finished.slice(0,10).map(renderChallengeCard).join('');
  return html;
}

function renderFriendsPanel() {
  let html = '';

  if (friendRequestsCache.length) {
    html += `<div class="fv-requests-card">
      <div class="fv-requests-title">🔔 Solicitudes de amistad</div>
      ${friendRequestsCache.map(r => `<div class="fv-request-row">
        <div class="fv-request-avatar">${(r.fromUsername||'U')[0].toUpperCase()}</div>
        <div class="fv-request-name">@${r.fromUsername}</div>
        <div class="fv-request-btns">
          <button class="fv-req-accept" onclick="doAcceptFriendRequest('${r.fromUid}','${r.fromUsername}')">Aceptar</button>
          <button class="fv-req-reject" onclick="doRejectFriendRequest('${r.fromUid}')">Rechazar</button>
        </div>
      </div>`).join('')}
    </div>`;
  }

  html += `<div class="fv-action-row">
    <button class="fv-action-btn outline" onclick="openAddFriendModal()">➕ Agregar amigo</button>
  </div>`;

  html += `<div class="fv-section-label">Tus amigos <span class="fv-count-pill">${friendsListCache.length}</span></div>`;
  if (!friendsListCache.length) {
    html += `<div class="fv-empty"><span class="fv-empty-icon">👥</span>Todavía no agregaste amigos.<br>Buscalos por nombre de usuario o código.</div>`;
  } else {
    html += friendsListCache.map(f => `<div class="fv-friend-card">
      <div class="fv-friend-avatar">${(f.username||'U')[0].toUpperCase()}</div>
      <div class="fv-friend-info"><div class="fv-friend-name">@${f.username}</div><div class="fv-friend-stars">⭐ ${f.totalStars}</div></div>
      <div class="fv-friend-btns">
        <button class="fv-friend-challenge" onclick="openChallengeModal('${f.uid}')">⚔️ Desafiar</button>
        <button class="fv-friend-remove" onclick="doRemoveFriend('${f.uid}','${f.username}')">✕</button>
      </div>
    </div>`).join('');
  }
  return html;
}

// ── Setup de listeners cuando hay sesión ──
async function setupSocialFeatures() {
  if (!currentUser) {
    if (unsubFriendRequests) { unsubFriendRequests(); unsubFriendRequests = null; }
    if (unsubChallenges) { unsubChallenges(); unsubChallenges = null; }
    myProfile = null; friendsListCache = []; challengesCache = []; friendRequestsCache = [];
    return;
  }
  await loadMyProfile();

  // Las solicitudes de amistad llegan a users/{uid}/friendRequests independientemente
  // de si ya elegiste username o no — siempre escuchamos en cuanto hay sesión.
  if (unsubFriendRequests) unsubFriendRequests();
  unsubFriendRequests = listenFriendRequests(currentUser.uid, async (reqs) => {
    // Las marcadas autoAccept son confirmaciones silenciosas: el otro ya me aceptó,
    // yo solo necesito sumarlo a mi lista de amigos y borrar el aviso (sin mostrar UI).
    const autoOnes = reqs.filter(r => r.autoAccept);
    const visibleOnes = reqs.filter(r => !r.autoAccept);
    for (const r of autoOnes) {
      try {
        await addFriendToMyList(currentUser.uid, r.fromUid);
        await rejectFriendRequest(currentUser.uid, r.fromUid); // limpia el aviso una vez procesado
        await refreshFriendsList();
        showToast(`🤝 Ahora sos amigo de @${r.fromUsername}`);
      } catch(e) { console.warn('[autoAccept]', e); }
    }
    friendRequestsCache = visibleOnes;
    if (document.getElementById('friends-view') && document.getElementById('friends-view').style.display !== 'none') renderFriendsView();
  });

  if (myProfile && myProfile.username) {
    await refreshFriendsList();
    if (unsubChallenges) unsubChallenges();
    unsubChallenges = listenMyChallenges(currentUser.uid, (chals) => {
      challengesCache = chals;
      tickChallenges();
      if (document.getElementById('friends-view') && document.getElementById('friends-view').style.display !== 'none') renderFriendsView();
    });
  }
}

// Tras crear el username por primera vez, hay que (re)activar listeners de amigos/desafíos
async function reinitSocialAfterUsername() {
  await refreshFriendsList();
  if (unsubChallenges) unsubChallenges();
  unsubChallenges = listenMyChallenges(currentUser.uid, (chals) => {
    challengesCache = chals;
    tickChallenges();
    if (document.getElementById('friends-view') && document.getElementById('friends-view').style.display !== 'none') renderFriendsView();
  });
}
