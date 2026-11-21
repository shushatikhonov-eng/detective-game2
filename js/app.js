/* CASE 031 v11 — TV screen application.
 * Написано на чистом ES5 для браузеров Samsung Tizen:
 * никаких стрелочных функций, template strings, ?. ??, async/await или import().
 * Управление: пульт iPhone (Firebase/MQTT/BroadcastChannel) и пульт Samsung TV
 * (стрелки, OK/Enter, Return/Back, цветные кнопки). */
(function () {
  'use strict';

  var GAME = window.GAME;
  var VERSION = '13';

  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function qp(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search || '');
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  /* ------------------- комната ------------------- */
  function randomRoom() {
    var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', out = '', i;
    for (i = 0; i < 5; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }
  var room = (qp('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || randomRoom();
  $('roomDisplay').textContent = 'ROOM: ' + room;
  var vChip = $('tvVersion'); if (vChip) vChip.textContent = 'v' + VERSION;

  /* ------------------- состояние ------------------- */
  var state = { chapter: 0, answers: {}, score: 0, started: false, notes: '', finished: false, view: null };
  var db = null, map = null, markers = null, timer = null;
  var lastEventTs = 0, selectedAnswer = null;
  var transportName = 'LOCAL MODE';
  var net = null; /* активный сетевой транспорт */
  var bc = ('BroadcastChannel' in window) ? new BroadcastChannel('case031-' + room) : null;

  /* ------------------- TV-навигация пультом ------------------- */
  var KEY_BY_NAME = {};
  var names = { 'ArrowLeft': 37, 'ArrowUp': 38, 'ArrowRight': 39, 'ArrowDown': 40, 'Enter': 13, 'Escape': 27, 'Backspace': 8 };
  for (var kn in names) KEY_BY_NAME[kn] = names[kn];

  var focusables = [], focusEl = null, preModalFocus = null;

  function visible(el) { return !!(el.offsetWidth && el.offsetHeight); }

  function collectFocusables() {
    var list = [], scope = null, els, i;
    var inModal = $('modalBackdrop').className.indexOf('open') !== -1;
    if (inModal) scope = $('modalBackdrop');
    else {
      var screens = document.querySelectorAll('.screen.active');
      if (screens.length) scope = screens[0];
    }
    if (scope) {
      els = scope.querySelectorAll('[data-tv-focus]');
      for (i = 0; i < els.length; i++) list.push(els[i]);
    }
    focusables = list;
  }

  function setFocus(el, silentScroll) {
    if (!el) return;
    if (focusEl) focusEl.classList.remove('tv-focus');
    focusEl = el;
    el.classList.add('tv-focus');
    if (!silentScroll) {
      try { el.scrollIntoView({ block: 'nearest' }); } catch (e1) { try { el.scrollIntoView(); } catch (e2) {} }
    }
  }

  function refocus(prefer) {
    collectFocusables();
    var el = prefer;
    if (!el || focusables.indexOf(el) === -1 || !visible(el)) el = focusables.length ? focusables[0] : null;
    setFocus(el);
  }

  function moveFocus(dx, dy) {
    collectFocusables();
    if (!focusables.length) return;
    if (!focusEl || focusables.indexOf(focusEl) === -1 || !visible(focusEl)) { setFocus(focusables[0]); return; }
    var r = focusEl.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var best = null, bestScore = Infinity, i, el;
    for (i = 0; i < focusables.length; i++) {
      el = focusables[i];
      if (el === focusEl || !visible(el)) continue;
      var r2 = el.getBoundingClientRect();
      var vx = (r2.left + r2.width / 2) - cx;
      var vy = (r2.top + r2.height / 2) - cy;
      if (dx !== 0 && vx * dx <= 0) continue;   /* не в том направлении по горизонтали */
      if (dy !== 0 && vy * dy <= 0) continue;   /* не в том направлении по вертикали */
      var dist = Math.sqrt(vx * vx + vy * vy);
      var skew = dx !== 0 ? Math.abs(vy) * 2.4 : Math.abs(vx) * 2.4;
      var score = dist + skew;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) setFocus(best);
  }

  function backAction() {
    if (state.view) { closeModal(); return true; }
    return false;
  }
  function nextAction() {
    if (state.started && $('continueButton') && !$('continueButton').disabled) $('continueButton').click();
  }

  function tvKeyHandler(e) {
    var tag = ((e.target && e.target.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return; /* не мешаем набору текста */
    var code = e.keyCode || (e.key && KEY_BY_NAME[e.key]) || 0;
    var handled = true;
    switch (code) {
      case 37: moveFocus(-1, 0); break;
      case 38: moveFocus(0, -1); break;
      case 39: moveFocus(1, 0); break;
      case 40: moveFocus(0, 1); break;
      case 13: if (focusEl && visible(focusEl)) focusEl.click(); break;
      case 27: case 10009: case 8: backAction(); break;
      case 403: if ($('notesButton')) $('notesButton').click(); break;       /* красная — заметки */
      case 404: nextAction(); break;                                          /* зелёная — дальше */
      case 405: if (state.started && !state.view) openView({ type: 'map' }); break; /* жёлтая — карта */
      case 406: backAction(); break;                                          /* синяя — назад */
      default: handled = false;
    }
    if (handled && e.preventDefault) e.preventDefault();
  }
  window.addEventListener('keydown', tvKeyHandler, true);
  document.addEventListener('click', function (e) {
    var t = e.target, el = null;
    while (t && t !== document) {
      if (t.getAttribute && t.getAttribute('data-tv-focus') !== null) { el = t; break; }
      t = t.parentNode;
    }
    if (el) setFocus(el);
  }, true);

  /* ------------------- общие функции экрана ------------------- */
  function setScreen(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    $(id).classList.add('active');
  }
  function toast(t) {
    var n = document.createElement('div');
    n.className = 'toast';
    n.textContent = t;
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 2200);
  }

  /* ------------------- синхронизация ------------------- */
  function publish() {
    var snap = {
      chapter: state.chapter, answers: state.answers, score: state.score,
      started: state.started, finished: state.finished, notes: state.notes,
      view: state.view, room: room, updatedAt: Date.now()
    };
    if (bc) bc.postMessage({ kind: 'state', state: snap });
    if (db) { try { db.set('rooms/' + room + '/state', snap); } catch (e0) {} }
    if (net && net.publishState) net.publishState(JSON.stringify(snap));
  }

  function setTransport(label) {
    transportName = label;
    $('connectionLabel').textContent = label;
  }

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src; s.async = true;
    var done = false;
    s.onload = function () { if (!done) { done = true; cb(null); } };
    s.onerror = function () { if (!done) { done = true; cb(new Error('load fail: ' + src)); } };
    document.head.appendChild(s);
  }
  function loadSeq(urls, i, cb) {
    if (i >= urls.length) return cb(null);
    loadScript(urls[i], function (err) { if (err) return cb(err); loadSeq(urls, i + 1, cb); });
  }

  function connectFirebase(onOk, onFail) {
    var cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.databaseURL) return onFail();
    var base = 'https://www.gstatic.com/firebasejs/8.10.1/';
    loadSeq([base + 'firebase-app.js', base + 'firebase-auth.js', base + 'firebase-database.js'], 0, function (err) {
      if (err || !window.firebase) return onFail();
      try {
        var app = firebase.initializeApp(cfg, 'case031-tv-' + room);
        app.auth().signInAnonymously().then(function () {
          var database = firebase.database(app);
          db = {
            set: function (path, val) { return database.ref(path).set(val); },
            on: function (path, cb2) { database.ref(path).on('value', function (s) { cb2(s.val()); }); }
          };
          db.on('rooms/' + room + '/events/latest', function (v) {
            if (v && v.ts > lastEventTs) { lastEventTs = v.ts; applyRemote(v); }
          });
          onOk();
        }, function (err2) { onFail(err2); });
      } catch (e2) { onFail(e2); }
    });
  }

  function connectMqtt(onOk, onFail) {
    if (!window.mqtt) return onFail();
    var brokers = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
    var idx = 0, tBase = 'case031/' + room + '/';
    function attempt() {
      if (idx >= brokers.length) return onFail();
      var url = brokers[idx++];
      var client;
      try {
        client = mqtt.connect(url, {
          clientId: 'case031-tv-' + room + '-' + Math.floor(Math.random() * 1000000),
          keepalive: 30, reconnectPeriod: 5000, connectTimeout: 8000
        });
      } catch (e) { return attempt(); }
      var settled = false;
      client.on('connect', function () {
        if (settled) return; settled = true;
        client.subscribe(tBase + 'cmd', function () {});
        net = {
          publishState: function (json) { try { client.publish(tBase + 'state', json, { retain: true, qos: 0 }); } catch (e1) {} },
          publishCmd: function (obj) { try { client.publish(tBase + 'cmd', JSON.stringify(obj), { qos: 0 }); } catch (e2) {} }
        };
        client.on('message', function (topic, payload) {
          try {
            var msg = JSON.parse(payload.toString());
            if (topic === tBase + 'cmd' && msg && msg.ts > lastEventTs) { lastEventTs = msg.ts; applyRemote(msg); }
          } catch (e3) {}
        });
        onOk();
      });
      client.on('error', function () { if (!settled) { settled = true; try { client.end(true); } catch (e4) {} attempt(); } });
      setTimeout(function () { if (!settled) { settled = true; try { client.end(true); } catch (e5) {} attempt(); } }, 9500);
    }
    attempt();
  }

  function startTransports() {
    connectFirebase(function () {
      setTransport('FIREBASE SYNC');
      publish();
    }, function () {
      connectMqtt(function () {
        setTransport('MQTT RELAY');
        publish();
      }, function () {
        setTransport('LOCAL MODE');
      });
    });
  }

  /* ------------------- модальное окно ------------------- */
  function renderModal() {
    var back = $('modalBackdrop');
    if (!state.view) {
      back.classList.remove('open');
      back.setAttribute('aria-hidden', 'true');
      $('modalContent').innerHTML = '';
      refocus(preModalFocus);
      return;
    }
    back.classList.add('open');
    back.setAttribute('aria-hidden', 'false');
    var v = state.view;
    if (v.type === 'evidence') {
      var list = GAME.chapters[state.chapter].evidence, e = null, i;
      for (i = 0; i < list.length; i++) if (list[i].id === v.id) e = list[i];
      if (!e) { state.view = null; return renderModal(); }
      $('modalContent').innerHTML =
        '<div class="dossier-topline"><span>МАТЕРИАЛ ДЕЛА № 031</span><span>' + esc(e.type) + '</span></div>' +
        '<div class="dossier-layout"><div class="dossier-copy"><h2>' + esc(e.title) + '</h2><p>' + esc(e.body) + '</p></div>' +
        '<figure class="dossier-figure"><img class="hero-img" src="' + esc(e.image) + '" alt="Нуарная иллюстрация: ' + esc(e.title) + '"></figure></div>' +
        '<div class="dossier-foot">АРХИВНОЕ ДОСЬЕ · ' + esc(e.id.toUpperCase()) + '</div>';
    } else if (v.type === 'map') {
      $('modalContent').innerHTML =
        '<div class="eyebrow">КАРТА РАССЛЕДОВАНИЯ</div><h2>Liverpool · 1931</h2>' +
        '<div id="modalMap" style="height:62vh;filter:grayscale(1) contrast(1.1)"></div>' +
        '<p>Географические точки и маршруты, рассматриваемые в материалах дела.</p>';
      setTimeout(function () {
        if (!window.L) return;
        if (!document.getElementById('modalMap')) return; /* модалку уже закрыли */
        if (!state.view || state.view.type !== 'map') return;
        var mm = L.map('modalMap', {
          zoomControl: false, scrollWheelZoom: false, doubleClickZoom: false,
          dragging: false, boxZoom: false, keyboard: false, touchZoom: false, attributionControl: false
        }).setView([53.414, -2.93], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(mm);
        var ps = GAME.locations, i;
        for (i = 0; i < ps.length; i++) {
          L.circleMarker([ps[i].lat, ps[i].lng], {
            radius: 8, color: '#ff3434', fillColor: '#ff2525', fillOpacity: 1, weight: 3
          }).addTo(mm);
        }
      }, 100);
    } else if (v.type === 'notes') {
      $('modalContent').innerHTML =
        '<div class="eyebrow">СЛЕДСТВЕННАЯ ГРУППА</div><h2>Рабочие заметки</h2><p>' + esc(state.notes || 'Заметок пока нет. Заметки ведутся с пульта iPhone.') + '</p>';
    } else if (v.type === 'sources') {
      var html = '<div class="eyebrow">ИСТОЧНИКИ ДЕЛА</div><h2>Архивные источники</h2><div class="sources-list">';
      for (var j = 0; j < GAME.sources.length; j++) {
        var s = GAME.sources[j];
        html += '<div class="source-item"><a data-tv-focus href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a><p>' + esc(s.note) + '</p></div>';
      }
      html += '</div><p class="source-note">Иллюстрации игры — авторские реконструкции; исторические факты сверяйте по этим источникам.</p>';
      $('modalContent').innerHTML = html;
    }
    refocus(null);
  }

  function openView(view) { preModalFocus = focusEl; state.view = view; renderModal(); publish(); }
  function closeModal() { state.view = null; renderModal(); publish(); }

  $('modalClose').onclick = closeModal;
  $('modalBackdrop').addEventListener('click', function (e) { if (e.target === $('modalBackdrop')) closeModal(); });
  $('notesButton').onclick = function () { openView({ type: 'notes' }); };
  $('sourcesButton').onclick = function () { openView({ type: 'sources' }); };

  /* ------------------- карта ------------------- */
  function initMap() {
    if (map || !window.L) return;
    map = L.map('map', {
      zoomControl: false, scrollWheelZoom: false, doubleClickZoom: false,
      dragging: false, boxZoom: false, keyboard: false, touchZoom: false, attributionControl: false
    }).setView([53.414, -2.93], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map);
    markers = L.layerGroup().addTo(map);
    var ids = [], i;
    for (i = 0; i < GAME.locations.length; i++) ids.push(GAME.locations[i].id);
    renderMap(ids);
  }
  function renderMap(ids) {
    if (!map) return;
    markers.clearLayers();
    var hot = {}, i;
    for (i = 0; i < (ids || []).length; i++) hot[ids[i]] = true;
    for (i = 0; i < GAME.locations.length; i++) {
      var p = GAME.locations[i];
      var isHot = !!hot[p.id];
      L.circleMarker([p.lat, p.lng], {
        radius: isHot ? 13 : 5, color: isHot ? '#ff3434' : '#777',
        fillColor: isHot ? '#ff2525' : '#777', fillOpacity: isHot ? 1 : 0.24,
        weight: isHot ? 4 : 1, opacity: isHot ? 1 : 0.35,
        className: isHot ? 'map-focus-marker' : 'map-muted-marker'
      }).addTo(markers);
    }
    if (ids && ids.length === 1) {
      for (i = 0; i < GAME.locations.length; i++) {
        if (GAME.locations[i].id === ids[0]) { map.setView([GAME.locations[i].lat, GAME.locations[i].lng], 14, { animate: false }); break; }
      }
    } else {
      map.setView([53.414, -2.93], 11, { animate: false });
    }
  }

  /* ------------------- главный рендер ------------------- */
  function render() {
    var c = GAME.chapters[state.chapter];
    $('chapterKicker').textContent = c.kicker;
    $('chapterTitle').textContent = c.title;
    $('chapterIntro').textContent = c.intro;
    $('chapterTime').textContent = c.minutes + ' MIN';
    $('progressText').textContent = (state.chapter + 1) + ' / ' + GAME.chapters.length;
    $('progressBar').style.width = (((state.chapter + 1) / GAME.chapters.length) * 100) + '%';

    var evHtml = '', i;
    for (i = 0; i < c.evidence.length; i++) {
      var e = c.evidence[i];
      evHtml += '<button class="evidence-card" data-evidence="' + i + '" data-tv-focus>' +
        '<img src="' + esc(e.image) + '" alt="">' +
        '<span class="ev-type">' + esc(e.type) + '</span>' +
        '<span class="ev-title">' + esc(e.title) + '</span></button>';
    }
    $('scenePanel').innerHTML =
      '<div class="eyebrow">МАТЕРИАЛЫ ЭПИЗОДА</div><h3>' + esc(c.title) + '</h3>' + c.scene +
      '<div class="evidence-list">' + evHtml + '</div>';
    var evBtns = $('scenePanel').querySelectorAll('[data-evidence]');
    for (i = 0; i < evBtns.length; i++) {
      (function (btn, idx) {
        btn.onclick = function () { openView({ type: 'evidence', id: GAME.chapters[state.chapter].evidence[idx].id }); };
      })(evBtns[i], i);
    }

    var prior = state.answers[state.chapter], q = c.task;
    var ansHtml = '';
    for (i = 0; i < q.options.length; i++) {
      var cls = 'answer';
      if (prior) {
        if (prior.choice === i) cls += ' selected';
        if (i === q.correct) cls += ' correct';
      }
      ansHtml += '<button class="' + cls + '" data-answer="' + i + '"' + (prior ? ' disabled' : ' data-tv-focus') + '>' +
        '<span class="letter">' + String.fromCharCode(65 + i) + '</span><span>' + esc(q.options[i]) + '</span></button>';
    }
    var fb = prior ? esc(prior.explain) : 'Обсудите материалы и выберите ответ на iPhone.';
    $('taskPanel').innerHTML =
      '<div class="eyebrow">КОНТРОЛЬНЫЙ ВОПРОС · ' + (state.chapter === 6 ? 'ФИНАЛЬНЫЙ ВЕРДИКТ' : 'ПРОВЕРЬТЕ ВЫВОД') + '</div>' +
      '<h3>' + esc(q.prompt) + '</h3><div class="answers">' + ansHtml + '</div>' +
      '<div class="feedback ' + (prior ? (prior.correct ? 'good' : 'bad') : '') + '">' + fb + '</div>' +
      '<div class="task-footer"><span class="score-mini">' +
      (prior ? (prior.correct ? '+' + (state.chapter === 6 ? 40 : 10) + ' БАЛЛОВ' : '0 БАЛЛОВ') : 'ОТВЕТ КОМАНДЫ') +
      '</span><button class="primary" id="confirmAnswer"' + (prior ? '' : ' disabled') + ' data-tv-focus>' +
      (state.chapter === 6 ? 'ЗАВЕРШИТЬ ДЕЛО' : 'ПОДТВЕРДИТЬ ОТВЕТ') + '</button></div>';

    var ansBtns = $('taskPanel').querySelectorAll('[data-answer]');
    for (i = 0; i < ansBtns.length; i++) {
      (function (btn) {
        btn.onclick = function () {
          if (state.answers[state.chapter]) return;
          selectedAnswer = Number(btn.getAttribute('data-answer'));
          var all = $('taskPanel').querySelectorAll('[data-answer]');
          for (var k = 0; k < all.length; k++) {
            if (all[k] === btn) all[k].classList.add('selected');
            else all[k].classList.remove('selected');
          }
          $('confirmAnswer').disabled = false;
        };
      })(ansBtns[i]);
    }
    var ca = $('taskPanel').querySelector('#confirmAnswer');
    if (ca) ca.onclick = confirmAnswer;

    var seen = 0, total = 0, ci;
    for (ci = 0; ci < GAME.chapters.length; ci++) {
      total += GAME.chapters[ci].evidence.length;
      if (ci <= state.chapter) seen += GAME.chapters[ci].evidence.length;
    }
    $('evidenceCount').textContent = seen + ' / ' + total + ' ДОКУМЕНТОВ';
    $('teamVersion').textContent = prior ? 'ОТВЕТ ЗАФИКСИРОВАН' : 'ФОРМИРУЕТСЯ';
    $('continueButton').disabled = !prior;
    $('continueButton').textContent = state.chapter === 6 ? 'ПОКАЗАТЬ ИТОГ →' : 'СЛЕДУЮЩАЯ ГЛАВА →';

    var dots = '';
    for (ci = 0; ci < GAME.chapters.length; ci++) {
      dots += '<span class="chapter-dot ' + (ci === state.chapter ? 'current' : (state.answers[ci] ? 'done' : '')) + '"></span>';
    }
    $('chapterDots').innerHTML = dots;
    renderMap(c.mapFocus);
    if (map) setTimeout(function () { map.invalidateSize(); }, 80);
    publish();
    refocus(focusEl);
  }

  function confirmAnswer() {
    if (selectedAnswer === null || state.answers[state.chapter]) return;
    var c = GAME.chapters[state.chapter];
    var correct = selectedAnswer === c.task.correct;
    state.answers[state.chapter] = { choice: selectedAnswer, correct: correct, explain: c.task.explain };
    if (correct) state.score += state.chapter === 6 ? 40 : 10;
    selectedAnswer = null;
    render();
    toast(correct ? 'Вывод зафиксирован.' : 'Версия не подтверждена. Изучите пояснение.');
    if (state.chapter === 6) { $('continueButton').disabled = false; refocus($('continueButton')); }
  }

  /* ------------------- финал и переходы ------------------- */
  function finishGame() {
    state.finished = true;
    state.view = null;
    renderModal();
    var solved = !!(state.answers[6] && state.answers[6].correct === true);
    setScreen('resultScreen');
    $('resultTitle').textContent = solved ? 'Дело раскрыто' : 'Дело не раскрыто';
    $('resultVerdict').textContent = solved ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
    $('resultVerdict').classList.toggle('defeat', !solved);
    $('resultPhoto').src = solved ? 'assets/images/mortimer-arrested.jpg' : 'assets/images/mortimer-triumphant.jpg';
    $('resultPhoto').alt = solved ? 'Эдвард Мортимер после ареста' : 'Торжествующий Эдвард Мортимер';
    $('resultStamp').textContent = solved ? 'АРЕСТОВАН' : 'ОСТАЛСЯ НА СВОБОДЕ';
    $('resultLead').textContent = solved
      ? 'Вы установили личность настоящего убийцы — Эдварда Мортимера. Его план разоблачён.'
      : 'Вы не установили личность настоящего убийцы. Эдвард Мортимер избежал разоблачения и вышел из этой истории победителем.';
    $('finalScore').textContent = state.score + ' / 100';
    $('resultExplanation').textContent = solved
      ? 'В авторской версии расследования команда связала мотив Мортимера, ложный звонок, знание распорядка Уоллеса и документы Джулии.'
      : 'Мортимер использовал поездку Уоллеса как прикрытие. Команда не собрала достаточно доказательств, чтобы назвать его.';
    publish();
    refocus($('restartGame'));
  }

  $('continueButton').onclick = function () {
    if (!state.answers[state.chapter]) return;
    if (state.chapter === 6) { finishGame(); return; }
    state.chapter++;
    selectedAnswer = null;
    state.view = null;
    renderModal();
    render();
    refocus(null);
  };

  function resetGame() {
    clearInterval(timer); timer = null;
    state.chapter = 0; state.answers = {}; state.score = 0;
    state.finished = false; state.started = false; state.notes = '';
    state.view = null; selectedAnswer = null;
    $('clockLabel').textContent = '00:00:00';
    renderModal();
    setScreen('introScreen');
    renderQr();
    publish();
    refocus($('startGame'));
  }
  $('restartGame').addEventListener('click', resetGame);

  function start() {
    if (state.started) return;
    state.started = true;
    setScreen('gameScreen');
    initMap();
    render();
    startTimer();
    publish();
    refocus(null);
  }
  $('startGame').onclick = start;

  function startTimer() {
    var left = GAME.duration * 60;
    clearInterval(timer);
    var tick = function () {
      $('clockLabel').textContent = pad2(Math.floor(left / 3600)) + ':' + pad2(Math.floor((left % 3600) / 60)) + ':' + pad2(left % 60);
      if (left > 0) left--;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  /* ------------------- команды пульта iPhone ------------------- */
  function applyRemote(cmd) {
    if (!cmd) return;
    switch (cmd.type) {
      case 'start': start(); break;
      case 'restart': resetGame(); break;
      case 'open_evidence': if (state.started) openView({ type: 'evidence', id: cmd.id }); break;
      case 'close_view': state.view = null; renderModal(); publish(); break;
      case 'show_map': openView({ type: 'map' }); break;
      case 'show_board': state.view = null; renderModal(); publish(); break;
      case 'open_sources': openView({ type: 'sources' }); break;
      case 'answer':
        if (state.started && !state.answers[state.chapter]) {
          selectedAnswer = Number(cmd.choice);
          confirmAnswer();
        }
        break;
      case 'continue': if (state.answers[state.chapter]) $('continueButton').click(); break;
      case 'notes': state.notes = cmd.notes || ''; publish(); break;
    }
  }
  if (bc) bc.onmessage = function (e) {
    if (e && e.data && e.data.kind === 'command') applyRemote(e.data.command);
  };

  /* ------------------- QR-подключение пульта ------------------- */
  function buildRemoteUrl() {
    var base = (location.origin && location.origin !== 'null') ? location.origin + location.pathname : location.href;
    base = base.replace(/index\.html[^#?]*$/, '').replace(/remote\.html[^#?]*$/, '');
    return base + 'remote.html?room=' + encodeURIComponent(room);
  }
  function renderQr() {
    var box = $('qrBox');
    if (!box) return;
    var url = buildRemoteUrl();
    $('pairRoom').textContent = room;
    $('pairUrl').textContent = url.replace(/^https?:\/\//, '');
    try {
      if (window.QRCode) {
        box.innerHTML = '';
        new QRCode(box, {
          text: url, width: 132, height: 132,
          colorDark: '#0a0a0a', colorLight: '#f3efe6',
          correctLevel: QRCode.CorrectLevel.M
        });
      } else {
        box.innerHTML = '<div class="qr-fallback">QR недоступен.<br>Введите код комнаты<br>на странице пульта.</div>';
      }
    } catch (e) {
      box.innerHTML = '<div class="qr-fallback">Код комнаты:<br>' + esc(room) + '</div>';
    }
  }

  /* ------------------- старт ------------------- */
  renderQr();
  startTransports();
  refocus($('startGame'));
})();
