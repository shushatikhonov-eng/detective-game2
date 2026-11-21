(()=>{
 const $=id=>document.getElementById(id),roomInput=$('roomCode'),shell=$('remoteShell');
 let room=new URLSearchParams(location.search).get('room')||roomInput.value,db=null,lastState=null,selectedAnswer=null;
 const bc=('BroadcastChannel'in window)?new BroadcastChannel('wallace-game-'+room):null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function status(s){$('connectionStatus').textContent=s;}
 function send(command){
  if(bc)bc.postMessage({kind:'command',command});
  if(db)db.ref('rooms/'+room+'/events/latest').set({...command,ts:Date.now()}).catch(e=>status('Ошибка отправки: '+e.message));
  else status('Нет связи с Firebase.');
 }
 function render(s){
  if(!s)return;
  const prev=lastState?.chapter;
  if(prev!==undefined&&prev!==s.chapter)selectedAnswer=null;
  if(s.answers?.[s.chapter])selectedAnswer=null;
  lastState=s;
  const chapters=GAME.chapters||[],chapter=chapters[s.chapter],started=!!s.started,finished=!!s.finished,prior=s.answers?.[s.chapter],task=chapter?.task;
  shell.classList.toggle('is-playing',started||finished);
  shell.classList.toggle('is-finished',finished);
  $('remoteChapter').textContent=finished?'Расследование завершено':started?(chapter?.title||'Текущая глава'):'Ожидание телевизора';
  $('chapterKicker').textContent=chapter?.kicker||'ТЕКУЩАЯ ГЛАВА';
  $('remoteScore').innerHTML=`${Number(s.score)||0}<br><small>БАЛЛОВ</small>`;
  const count=chapters.length||7,progress=started?Math.min(s.chapter+1,count):0;
  $('remoteProgress').textContent=`ГЛАВА ${progress} ИЗ ${count} · ${Number(s.score)||0} БАЛЛОВ`;
  $('remoteProgressBar').style.width=`${progress/count*100}%`;
  $('remoteGameStatus').textContent=finished?'Расследование завершено. Итоговая версия команды зафиксирована.':started?`Глава ${s.chapter+1} · изучите материалы, обсудите факты и зафиксируйте общий вывод.`:'Телевизор подключён. Нажмите «Начать игру», чтобы начать расследование.';
  $('remoteIntroText').textContent=started&&chapter?chapter.intro:'';
  $('startButton').classList.toggle('hidden',started||finished);
  $('connectionCard').classList.toggle('compact-connection',started||finished);
  if(started&&chapter){
   $('remoteEvidence').innerHTML=chapter.evidence.map((e,i)=>`<button class="remote-evidence" data-evidence="${esc(e.id)}"><span class="remote-evidence-number">${String(i+1).padStart(2,'0')}</span><span class="remote-evidence-copy"><small>${esc(e.type)}</small><strong>${esc(e.title)}</strong></span><span class="remote-evidence-arrow">↗</span></button>`).join('');
  }else $('remoteEvidence').innerHTML='<p class="remote-status">Материалы появятся после начала расследования.</p>';
  $('remoteEvidence').querySelectorAll('[data-evidence]').forEach(b=>b.onclick=()=>send({type:'open_evidence',id:b.dataset.evidence}));
  if(finished){$('remoteQuestion').innerHTML='<h3>Расследование завершено</h3><p class="remote-status">Итоговое решение и историческое заключение доступны на телевизоре.</p>';}
  else if(!started||!task){$('remoteQuestion').innerHTML='<p class="remote-status">Вопрос появится после начала расследования.</p>';}
  else if(prior){$('remoteQuestion').innerHTML=`<p class="remote-question-prompt">${esc(task.prompt)}</p><div class="remote-answer-list">${task.options.map((o,i)=>`<div class="remote-answer ${prior.choice===i?'selected':''} ${prior.correct&&i===task.correct?'correct-answer':''}"><b>${String.fromCharCode(65+i)}</b><span>${esc(o)}</span></div>`).join('')}</div><div class="remote-explanation"><strong>${prior.correct?'ВЕРНЫЙ ВЫВОД':'ОТВЕТ ЗАФИКСИРОВАН'}</strong><p>${esc(prior.explain||task.explain||chapter.debrief||'')}</p></div>`;}
  else {$('remoteQuestion').innerHTML=`<p class="remote-question-prompt">${esc(task.prompt)}</p><div class="remote-answer-list">${task.options.map((o,i)=>`<button class="remote-answer ${selectedAnswer===i?'selected':''}" data-choice="${i}"><b>${String.fromCharCode(65+i)}</b><span>${esc(o)}</span></button>`).join('')}</div>`;}
  $('remoteQuestion').querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{selectedAnswer=Number(b.dataset.choice);$('remoteQuestion').querySelectorAll('[data-choice]').forEach(x=>x.classList.toggle('selected',x===b));$('confirmAnswer').disabled=false;});
  $('confirmAnswer').disabled=!started||finished||!!prior||selectedAnswer===null;
  $('confirmAnswer').classList.toggle('hidden',!started||finished||!!prior);
  $('nextButton').disabled=!started||finished||!prior;
  $('nextButton').classList.toggle('hidden',!started||finished);
  $('nextButton').textContent=s.chapter===count-1?'ЗАВЕРШИТЬ РАССЛЕДОВАНИЕ →':'СЛЕДУЮЩАЯ ГЛАВА →';
  $('remoteAnswerStatus').textContent=prior?'Решение принято и синхронизировано с телевизором.':started?'Выберите один вариант. После подтверждения ответ появится на общем экране.':'Ожидание начала игры.';
  if(document.activeElement!==$('remoteNotes'))$('remoteNotes').value=s.notes||'';
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
 $('showMap').onclick=()=>send({type:'show_map'});$('showBoard').onclick=()=>send({type:'show_board'});$('closeView').onclick=()=>send({type:'close_view'});
 $('confirmAnswer').onclick=()=>{if(selectedAnswer!==null){send({type:'answer',choice:selectedAnswer});selectedAnswer=null;$('confirmAnswer').disabled=true;}};
 $('nextButton').onclick=()=>send({type:'continue'});
 $('saveNotes').onclick=()=>send({type:'notes',notes:$('remoteNotes').value});$('showSources').onclick=()=>send({type:'open_sources'});
 if(bc)bc.onmessage=e=>{if(e.data?.kind==='state')render(e.data.state);};
 connect();
})();
