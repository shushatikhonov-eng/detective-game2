(()=>{
 const $=id=>document.getElementById(id),roomInput=$('roomCode');
 let room=new URLSearchParams(location.search).get('room')||roomInput.value,db=null,lastState=null,selectedAnswer=null;
 const bc=('BroadcastChannel'in window)?new BroadcastChannel('wallace-game-'+room):null;
 function status(s){$('connectionStatus').textContent=s;}
 function send(command){
  if(bc)bc.postMessage({kind:'command',command});
  if(db)db.ref('rooms/'+room+'/events/latest').set({...command,ts:Date.now()}).catch(e=>status('Ошибка отправки: '+e.message));
  else status('Нет связи с Firebase.');
 }
 function render(s){
  if(!s)return;
  const previousChapter=lastState?.chapter;
  if(previousChapter!==undefined&&previousChapter!==s.chapter)selectedAnswer=null;
  if(s.answers?.[s.chapter])selectedAnswer=null;
  lastState=s;
  const started=!!s.started,finished=!!s.finished,chapter=GAME.chapters[s.chapter],prior=s.answers?.[s.chapter],task=chapter?.task;
  $('remoteShell').classList.toggle('game-active',started||finished);
  $('remoteChapter').textContent=finished?'Расследование завершено':started?(chapter?.title||'Глава'):'Ожидание начала расследования';
  $('remoteProgress').textContent=`${started?Math.min(s.chapter+1,GAME.chapters.length):0} / ${GAME.chapters.length} глав · ${s.score||0} баллов`;
  $('startButton').classList.toggle('hidden',started||finished);
  $('remoteGameStatus').textContent=finished?'Дело завершено. Итог расследования показан на телевизоре.':started?`Идёт глава ${s.chapter+1} из ${GAME.chapters.length}. Управляйте материалами и отвечайте на вопросы с этого пульта.`:'Телевизор подключён. Нажмите «Начать игру», чтобы запустить расследование.';
  $('remoteNotes').value=s.notes||'';
  $('remoteEvidence').innerHTML=started&&chapter?chapter.evidence.map(e=>`<button class="remote-evidence" data-evidence="${e.id}"><small>${e.type}</small><strong>${e.title}</strong></button>`).join(''):'<p class="remote-status">Материалы появятся после начала расследования.</p>';
  $('remoteEvidence').querySelectorAll('[data-evidence]').forEach(b=>b.onclick=()=>send({type:'open_evidence',id:b.dataset.evidence}));
  if(!started||!task){$('remoteQuestion').innerHTML='<p class="remote-status">Вопросы появятся после начала расследования.</p>';}
  else if(prior){$('remoteQuestion').innerHTML=`<p class="remote-status">${task.prompt}</p><div class="remote-answer-list">${task.options.map((o,i)=>`<div class="remote-answer ${prior.choice===i?'selected':''} ${i===task.correct?'correct-answer':''}"><b>${String.fromCharCode(65+i)}.</b> ${o}</div>`).join('')}</div><p class="remote-status">${prior.correct?'Ответ верный.':'Ответ зафиксирован.'} ${prior.explain||task.explain||''}</p>`;}
  else {$('remoteQuestion').innerHTML=`<p class="remote-status">${task.prompt}</p>${task.options.map((o,i)=>`<button class="remote-answer ${selectedAnswer===i?'selected':''}" data-choice="${i}"><b>${String.fromCharCode(65+i)}.</b> ${o}</button>`).join('')}`;}
  $('remoteQuestion').querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{selectedAnswer=Number(b.dataset.choice);$('remoteQuestion').querySelectorAll('[data-choice]').forEach(x=>x.classList.toggle('selected',x===b));$('confirmAnswer').disabled=false;});
  $('confirmAnswer').disabled=!started||finished||!!prior||selectedAnswer===null;
  $('confirmAnswer').classList.toggle('hidden',!started||finished||!!prior);
  $('nextButton').disabled=!started||finished||!prior;
  $('nextButton').classList.toggle('hidden',!started||finished);
  $('nextButton').textContent=s.chapter===GAME.chapters.length-1?'ЗАВЕРШИТЬ РАССЛЕДОВАНИЕ →':'СЛЕДУЮЩАЯ ГЛАВА →';
  $('remoteAnswerStatus').textContent=prior?'Ответ принят телевизором. Можно переходить дальше.':started?'Выберите версию и подтвердите ответ.':'Ожидание начала игры.';
 }
 async function connect(){
  room=roomInput.value.trim().toUpperCase()||'WALLACE31';status('Подключение...');
  if(db){status('Уже подключено к комнате '+room+'.');return;}
  if(!window.FIREBASE_CONFIG){status('Firebase не настроен. Проверьте js/firebase-config.js.');return;}
  try{
   const appMod=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),dbMod=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js'),authMod=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
   const app=appMod.initializeApp(window.FIREBASE_CONFIG,'wallace-remote-'+room),auth=authMod.getAuth(app);await authMod.signInAnonymously(auth);
   const database=dbMod.getDatabase(app);
   db={ref:p=>{const r=dbMod.ref(database,p);return{get:()=>dbMod.get(r),set:v=>dbMod.set(r,v),on:(ev,cb)=>ev==='value'?dbMod.onValue(r,cb):null};}};
   db.ref('rooms/'+room+'/state').on('value',snap=>render(snap.val()));
   status('Подключено к комнате '+room+'.');history.replaceState({},'',location.pathname+'?room='+encodeURIComponent(room));
  }catch(e){status('Не удалось подключиться: '+e.message);}
 }
 $('connectButton').onclick=connect;
 $('startButton').onclick=()=>send({type:'start'});
 $('showMap').onclick=()=>send({type:'show_map'});
 $('showBoard').onclick=()=>send({type:'show_board'});
 $('closeView').onclick=()=>send({type:'close_view'});
 $('confirmAnswer').onclick=()=>{if(selectedAnswer!==null){send({type:'answer',choice:selectedAnswer});selectedAnswer=null;$('confirmAnswer').disabled=true;}};
 $('nextButton').onclick=()=>send({type:'continue'});
 $('saveNotes').onclick=()=>send({type:'notes',notes:$('remoteNotes').value});
 $('showSources').onclick=()=>send({type:'open_sources'});
 if(bc)bc.onmessage=e=>{if(e.data?.kind==='state')render(e.data.state);};
 connect();
})();
