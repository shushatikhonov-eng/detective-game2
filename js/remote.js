(()=>{
 const $=id=>document.getElementById(id),roomInput=$('roomCode');
 let room=new URLSearchParams(location.search).get('room')||roomInput.value,db=null,lastState=null,selectedAnswer=null,connectPromise=null,startedRemote=false;
 const bc=('BroadcastChannel'in window)?new BroadcastChannel('wallace-game-'+room):null;
 const controls=$('remoteControls'),startButton=$('startButton'),connectButton=$('connectButton');
 function status(s){$('connectionStatus').textContent=s;}
 function setConnectedUI(){
   connectButton.disabled=true;connectButton.textContent='ПОДКЛЮЧЕНО';
   startButton.disabled=false;status('Подключено к комнате '+room+'. Нажмите «Начать игру».');
 }
 async function send(command){
   if(bc)bc.postMessage({kind:'command',command});
   if(db){try{await db.ref('rooms/'+room+'/events/latest').set({...command,ts:Date.now()});return true;}
     catch(e){status('Ошибка отправки: '+e.message);return false;}}
   status('Нет связи с Firebase.');return false;
 }
 function render(s){
  lastState=s;if(!s)return;
  if(s.started){
    $('connectionPanel').hidden=true;
    controls.hidden=false;
    status('Игра запущена на телевизоре.');
  }
  $('remoteChapter').textContent=s.finished?'Расследование завершено':(GAME.chapters[s.chapter]?.title||'Ожидание');
  $('remoteProgress').textContent=`${Math.min(s.chapter+1,7)} / 7 глав · ${s.score||0} баллов`;
  $('remoteNotes').value=s.notes||'';
  const chapter=GAME.chapters[s.chapter];
  $('remoteEvidence').innerHTML=chapter?chapter.evidence.map(e=>`<button class="remote-evidence" data-evidence="${e.id}"><small>${e.type}</small><strong>${e.title}</strong></button>`).join(''):'<p class="remote-status">Нет материалов.</p>';
  $('remoteEvidence').querySelectorAll('[data-evidence]').forEach(b=>b.onclick=()=>send({type:'open_evidence',id:b.dataset.evidence}));
  const prior=s.answers?.[s.chapter],task=chapter?.task;
  $('remoteQuestion').innerHTML=task?`<p class="remote-status">${task.prompt}</p>${task.options.map((o,i)=>`<button class="remote-answer ${selectedAnswer===i?'selected':''}" data-choice="${i}" ${prior?'disabled':''}><b>${String.fromCharCode(65+i)}.</b> ${o}</button>`).join('')}${prior?'<p class="remote-status">Ответ зафиксирован.</p>':''}`:'<p class="remote-status">Ожидание начала игры.</p>';
  $('remoteQuestion').querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{selectedAnswer=+b.dataset.choice;$('remoteQuestion').querySelectorAll('[data-choice]').forEach(x=>x.classList.toggle('selected',x===b));$('confirmAnswer').disabled=false;});
  $('confirmAnswer').disabled=!!prior||selectedAnswer===null;
 }
 async function connect(){
   if(db)return true;
   if(connectPromise)return connectPromise;
   room=roomInput.value.trim().toUpperCase()||'WALLACE31';status('Подключение...');
   connectPromise=(async()=>{
    try{
     if(!window.FIREBASE_CONFIG)throw new Error('Firebase не настроен. Проверьте js/firebase-config.js.');
     const appMod=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
     const dbMod=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js');
     const authMod=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
     const app=appMod.initializeApp(window.FIREBASE_CONFIG,'wallace-remote-'+room);
     const auth=authMod.getAuth(app);await authMod.signInAnonymously(auth);
     const database=dbMod.getDatabase(app);
     db={ref:p=>{const r=dbMod.ref(database,p);return{get:()=>dbMod.get(r),set:v=>dbMod.set(r,v),on:(ev,cb)=>ev==='value'?dbMod.onValue(r,cb):null};}};
     db.ref('rooms/'+room+'/state').on('value',snap=>{
      const s=snap.val();
      render(s);
      if(s?.started){$('connectionPanel').hidden=true;controls.hidden=false;}
    });
     history.replaceState({},'',location.pathname+'?room='+encodeURIComponent(room));
     setConnectedUI();return true;
    }catch(e){status('Не удалось подключиться: '+e.message);db=null;return false;}
    finally{connectPromise=null;}
   })();
   return connectPromise;
 }
 connectButton.onclick=async()=>{connectButton.disabled=true;const ok=await connect();if(!ok)connectButton.disabled=false;};
 startButton.disabled=true;
 startButton.onclick=async()=>{
   startButton.disabled=true;status('Запускаем расследование...');
   const ok=await connect();
   if(!ok){startButton.disabled=false;return;}
   const sent=await send({type:'start'});
   if(sent){startedRemote=true;status('Команда отправлена. Ждём подтверждения телевизора…');}
   else startButton.disabled=false;
 };
 $('showMap').onclick=()=>send({type:'show_map'});
 $('showBoard').onclick=()=>send({type:'show_board'});
 $('closeView').onclick=()=>send({type:'close_view'});
 $('confirmAnswer').onclick=()=>{if(selectedAnswer!==null){send({type:'answer',choice:selectedAnswer});selectedAnswer=null;$('confirmAnswer').disabled=true;}};
 $('nextButton').onclick=()=>send({type:'continue'});
 $('saveNotes').onclick=()=>send({type:'notes',notes:$('remoteNotes').value});

 if(bc)bc.onmessage=e=>{if(e.data?.kind==='state')render(e.data.state);};
 connect();
})();