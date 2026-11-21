(()=>{
 const $=id=>document.getElementById(id),roomInput=$('roomCode'),lobby=$('lobbyScreen'),gameScreen=$('gameScreenRemote');
 let room=new URLSearchParams(location.search).get('room')||roomInput.value,db=null,lastState=null,selectedAnswer=null,connected=false;
 const bc=('BroadcastChannel'in window)?new BroadcastChannel('wallace-game-'+room):null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const strip=v=>String(v??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
 function status(s){$('connectionStatus').textContent=s;}
 function send(command){
  if(bc)bc.postMessage({kind:'command',command});
  if(db)db.ref('rooms/'+room+'/events/latest').set({...command,ts:Date.now()}).catch(e=>status('Ошибка отправки: '+e.message));
  else status('Нет связи с Firebase. Нажмите «Подключиться».');
 }
 function renderSources(){
  // На пульте источники остаются компактным текстовым списком без миниатюр.
  $('remoteSources').innerHTML=(GAME.sources||[]).map((s,i)=>`<a class="remote-source remote-source-text" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="remote-source-copy"><small>ИСТОЧНИК ${String(i+1).padStart(2,'0')}</small><strong>${esc(s.name)}</strong><em>${esc(s.note||'')}</em><b>ОТКРЫТЬ ИСТОЧНИК ↗</b></span></a>`).join('');
 }

 function render(s){
  if(!s)return;
  const chapters=GAME.chapters||[],chapter=chapters[Number(s.chapter)||0],idx=Number(s.chapter)||0;
  const started=!!s.started,finished=!!s.finished,prior=s.answers?.[idx],task=chapter?.task;
  if(lastState&&lastState.chapter!==s.chapter)selectedAnswer=null;
  if(prior)selectedAnswer=null;
  lastState=s;
  lobby.hidden=started||finished;gameScreen.hidden=!(started||finished);
  $('remoteChapter').textContent=finished?'Расследование завершено':chapter?.title||'Глава расследования';
  $('chapterKicker').textContent=chapter?.kicker||`ГЛАВА ${idx+1}`;
  $('remoteScore').innerHTML=`${Number(s.score)||0}<small>БАЛЛОВ</small>`;
  const count=chapters.length||7,progress=started?Math.min(idx+1,count):0;
  $('remoteProgress').textContent=`ГЛАВА ${progress} ИЗ ${count} · ${Number(s.score)||0} БАЛЛОВ`;
  $('remoteProgressBar').style.width=`${progress/count*100}%`;
  $('remoteGameStatus').textContent=finished?'РАССЛЕДОВАНИЕ ЗАВЕРШЕНО · ИТОГОВОЕ РЕШЕНИЕ КОМАНДЫ ЗАФИКСИРОВАНО':`ЭТАП ${idx+1} ИЗ ${count} · ИЗУЧИТЕ МАТЕРИАЛЫ И ЗАФИКСИРУЙТЕ ОБЩИЙ ВЫВОД`;
  $('remoteIntroText').textContent=chapter?.intro||'';
  $('remoteSceneText').innerHTML=chapter?.scene||'';
  if(chapter){
   $('remoteEvidence').innerHTML=chapter.evidence.map((e,i)=>`<button class="remote-evidence" data-evidence="${esc(e.id)}"><span class="remote-evidence-number">${String(i+1).padStart(2,'0')}</span><span class="remote-evidence-copy"><small>${esc(e.type)}</small><strong>${esc(e.title)}</strong><em>ОТКРЫТЬ НА ТВ ↗</em></span><span class="remote-evidence-arrow">↗</span></button>`).join('');
  }else $('remoteEvidence').innerHTML='';
  $('remoteEvidence').querySelectorAll('[data-evidence]').forEach(b=>b.onclick=()=>send({type:'open_evidence',id:b.dataset.evidence}));
  if(finished){$('remoteQuestion').innerHTML='<h3>Дело завершено</h3><p class="remote-status">Итоговая версия команды зафиксирована. Юридический итог показан на телевизоре.</p>';}
  else if(prior&&task){$('remoteQuestion').innerHTML=`<p class="remote-question-prompt">${esc(task.prompt)}</p><div class="remote-answer-list">${task.options.map((o,i)=>`<div class="remote-answer ${prior.choice===i?'selected':''} ${prior.correct&&i===task.correct?'correct-answer':''}"><b>${String.fromCharCode(65+i)}</b><span>${esc(o)}</span></div>`).join('')}</div><div class="remote-explanation"><strong>ОТВЕТ КОМАНДЫ ЗАФИКСИРОВАН · ${prior.correct?'ВЕРНЫЙ ВЫВОД':'ВЕРСИЯ НЕ ПОДТВЕРЖДЕНА'}</strong><p>${esc(prior.explain||task.explain||chapter.debrief||'')}</p></div>`;}
  else if(task){$('remoteQuestion').innerHTML=`<p class="remote-question-prompt">${esc(task.prompt)}</p><div class="remote-answer-list">${task.options.map((o,i)=>`<button class="remote-answer ${selectedAnswer===i?'selected':''}" data-choice="${i}"><b>${String.fromCharCode(65+i)}</b><span>${esc(o)}</span></button>`).join('')}</div>`;}
  $('remoteQuestion').querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{selectedAnswer=Number(b.dataset.choice);$('remoteQuestion').querySelectorAll('[data-choice]').forEach(x=>x.classList.toggle('selected',x===b));$('confirmAnswer').disabled=false;});
  $('confirmAnswer').disabled=!started||finished||!!prior||selectedAnswer===null;
  $('confirmAnswer').hidden=!started||finished||!!prior;
  $('nextButton').hidden=!started||finished;
  $('nextButton').disabled=!prior;
  $('nextButton').textContent=idx===count-1?'ЗАВЕРШИТЬ РАССЛЕДОВАНИЕ →':'ПЕРЕЙТИ К СЛЕДУЮЩЕЙ ГЛАВЕ →';
  $('remoteAnswerStatus').textContent=prior?'Решение команды записано и синхронизировано с телевизором.':started?'Выберите один вариант и подтвердите коллективное решение.':'Ожидание начала расследования.';
  if(document.activeElement!==$('remoteNotes'))$('remoteNotes').value=s.notes||'';
 }
 async function connect(){
  room=roomInput.value.trim().toUpperCase()||'WALLACE31';status('Подключение к комнате '+room+'…');
  if(db){status('Уже подключено к комнате '+room+'.');return;}
  if(!window.FIREBASE_CONFIG){status('Firebase не настроен. Проверьте js/firebase-config.js.');return;}
  try{
   const appMod=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),dbMod=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js'),authMod=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
   const app=appMod.initializeApp(window.FIREBASE_CONFIG,'wallace-remote-'+room),auth=authMod.getAuth(app);await authMod.signInAnonymously(auth);
   const database=dbMod.getDatabase(app);
   db={ref:p=>{const r=dbMod.ref(database,p);return{get:()=>dbMod.get(r),set:v=>dbMod.set(r,v),on:(ev,cb)=>ev==='value'?dbMod.onValue(r,cb):null};}};
   db.ref('rooms/'+room+'/state').on('value',snap=>{connected=true;status('Подключено к комнате '+room+'.');render(snap.val());$('startButton').disabled=!!snap.val()?.started;});
   history.replaceState({},'',location.pathname+'?room='+encodeURIComponent(room));
  }catch(e){status('Не удалось подключиться: '+e.message);}
 }
 $('connectButton').onclick=connect;
 $('startButton').onclick=()=>{if(connected)send({type:'start'});else status('Сначала подключитесь к комнате.');};
 $('showMap').onclick=()=>send({type:'show_map'});$('showBoard').onclick=()=>send({type:'show_board'});$('closeView').onclick=()=>send({type:'close_view'});
 $('confirmAnswer').onclick=()=>{if(selectedAnswer!==null){send({type:'answer',choice:selectedAnswer});selectedAnswer=null;$('confirmAnswer').disabled=true;$('remoteAnswerStatus').textContent='Отправляем решение команды на общий экран…';}};
 $('nextButton').onclick=()=>send({type:'continue'});
 $('saveNotes').onclick=()=>{send({type:'notes',notes:$('remoteNotes').value});$('notesStatus').textContent='Заметки отправлены на общий экран и сохранены в состоянии комнаты.';};
 if(bc)bc.onmessage=e=>{if(e.data?.kind==='state')render(e.data.state);};
 renderSources();connect();
})();
