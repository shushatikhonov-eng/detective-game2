/* CASE 031 v11 — пульт следственной группы (iPhone).
 * Чистый ES5 для старых мобильных браузеров и телевизоров:
 * Firebase (compat SDK через <script>) → при сбое резервный MQTT → BroadcastChannel. */
(function () {
  'use strict';

  var GAME = window.GAME;

  function $(id) { return document.getElementById(id); }
  function qp(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search || '');
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  var roomInput = $('roomCode');
  var room = (qp('room') || roomInput.value || 'WALLACE31').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'WALLACE31';
  roomInput.value = room;

  var db = null, lastState = null, selectedAnswer = null;
  var startedRemote = false;
  var net = null; /* активный транспорт */
  var bc = ('BroadcastChannel' in window) ? new BroadcastChannel('case031-' + room) : null;

  var controls = $('remoteControls'), startButton = $('startButton'), connectButton = $('connectButton');

  function status(s) { $('connectionStatus').textContent = s; }

  function setConnectedUI(label) {
    connectButton.disabled = true;
    connectButton.textContent = 'ПОДКЛЮЧЕНО';
    startButton.disabled = false;
    status('Подключено к комнате ' + room + (label ? ' · ' + label : '') + '. Нажмите «Начать игру».');
  }

  /* ---------- загрузка Firebase compat SDK ---------- */
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

  /* ---------- Firebase ---------- */
  function connectFirebase(onOk, onFail) {
    var cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.databaseURL) return onFail();
    status('Подключение к Firebase…');
    var base = 'https://www.gstatic.com/firebasejs/8.10.1/';
    loadSeq([base + 'firebase-app.js', base + 'firebase-auth.js', base + 'firebase-database.js'], 0, function (err) {
      if (err || !window.firebase) return onFail();
      try {
        var app = firebase.initializeApp(cfg, 'case031-remote-' + room);
        app.auth().signInAnonymously().then(function () {
          var database = firebase.database(app);
          db = {
            set: function (path, val) { return database.ref(path).set(val); },
            on: function (path, cb2) { database.ref(path).on('value', function (s) { cb2(s.val()); }); }
          };
          db.on('rooms/' + room + '/state', function (s) {
            render(s);
            if (s && s.started) {
              $('connectionPanel').hidden = true;
              controls.hidden = false;
            }
          });
          if (history.replaceState) history.replaceState({}, '', location.pathname + '?room=' + encodeURIComponent(room));
          onOk();
        }, function (err2) { onFail(err2); });
      } catch (e2) { onFail(e2); }
    });
  }

  /* ---------- MQTT (резервный транспорт) ---------- */
  function connectMqtt(onOk, onFail) {
    if (!window.mqtt) return onFail();
    status('Firebase недоступен, пробуем резервный канал…');
    var brokers = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
    var idx = 0, tBase = 'case031/' + room + '/';
    function attempt() {
      if (idx >= brokers.length) return onFail();
      var url = brokers[idx++];
      var client;
      try {
        client = mqtt.connect(url, {
          clientId: 'case031-remote-' + room + '-' + Math.floor(Math.random() * 1000000),
          keepalive: 30, reconnectPeriod: 5000, connectTimeout: 8000
        });
      } catch (e) { return attempt(); }
      var settled = false;
      client.on('connect', function () {
        if (settled) return; settled = true;
        client.subscribe(tBase + 'state', function () {});
        net = {
          send: function (obj) { try { client.publish(tBase + 'cmd', JSON.stringify(obj), { qos: 0 }); } catch (e1) {} }
        };
        client.on('message', function (topic, payload) {
          if (topic !== tBase + 'state') return;
          try {
            var s = JSON.parse(payload.toString());
            render(s);
            if (s && s.started) {
              $('connectionPanel').hidden = true;
              controls.hidden = false;
            }
          } catch (e2) {}
        });
        onOk();
      });
      client.on('error', function () { if (!settled) { settled = true; try { client.end(true); } catch (e3) {} attempt(); } });
      setTimeout(function () { if (!settled) { settled = true; try { client.end(true); } catch (e4) {} attempt(); } }, 9500);
    }
    attempt();
  }

  /* ---------- отправка команд ---------- */
  function send(command) {
    command.ts = Date.now();
    if (bc) bc.postMessage({ kind: 'command', command: command });
    if (db) {
      try {
        db.set('rooms/' + room + '/events/latest', JSON.parse(JSON.stringify(command)));
        return true;
      } catch (e) { status('Ошибка отправки: ' + (e && e.message ? e.message : e)); return false; }
    }
    if (net && net.send) { net.send(command); return true; }
    status('Нет связи с телевизором. Проверьте подключение.');
    return false;
  }

  /* ---------- отрисовка состояния ---------- */
  function render(s) {
    lastState = s;
    if (!s) return;
    if (s.started) {
      $('connectionPanel').hidden = true;
      controls.hidden = false;
      status('Игра запущена на телевизоре.');
    }
    var chTitle = (GAME.chapters[s.chapter] && GAME.chapters[s.chapter].title) ? GAME.chapters[s.chapter].title : 'Ожидание';
    $('remoteChapter').textContent = s.finished ? 'Расследование завершено' : chTitle;
    $('remoteProgress').textContent = Math.min(s.chapter + 1, GAME.chapters.length) + ' / ' + GAME.chapters.length + ' глав · ' + (s.score || 0) + ' баллов';
    $('remoteNotes').value = s.notes || '';

    var chapter = GAME.chapters[s.chapter];
    var evHtml = '';
    if (chapter) {
      for (var i = 0; i < chapter.evidence.length; i++) {
        var e = chapter.evidence[i];
        evHtml += '<button class="remote-evidence" data-evidence="' + e.id + '"><small>' + e.type + '</small><strong>' + e.title + '</strong></button>';
      }
    } else {
      evHtml = '<p class="remote-status">Нет материалов.</p>';
    }
    $('remoteEvidence').innerHTML = evHtml;
    var evBtns = $('remoteEvidence').querySelectorAll('[data-evidence]');
    for (var j = 0; j < evBtns.length; j++) {
      (function (btn) {
        btn.onclick = function () { send({ type: 'open_evidence', id: btn.getAttribute('data-evidence') }); };
      })(evBtns[j]);
    }

    var prior = s.answers ? s.answers[s.chapter] : null;
    var task = chapter ? chapter.task : null;
    var qHtml = '';
    if (task) {
      qHtml = '<p class="remote-status">' + task.prompt + '</p>';
      for (var k = 0; k < task.options.length; k++) {
        qHtml += '<button class="remote-answer ' + (selectedAnswer === k ? 'selected' : '') + '" data-choice="' + k + '"' + (prior ? ' disabled' : '') + '><b>' + String.fromCharCode(65 + k) + '.</b> ' + task.options[k] + '</button>';
      }
      if (prior) qHtml += '<p class="remote-status">Ответ зафиксирован.</p>';
    } else {
      qHtml = '<p class="remote-status">Ожидание начала игры.</p>';
    }
    $('remoteQuestion').innerHTML = qHtml;
    var ansBtns = $('remoteQuestion').querySelectorAll('[data-choice]');
    for (var m = 0; m < ansBtns.length; m++) {
      (function (btn) {
        btn.onclick = function () {
          selectedAnswer = Number(btn.getAttribute('data-choice'));
          var all = $('remoteQuestion').querySelectorAll('[data-choice]');
          for (var n = 0; n < all.length; n++) {
            if (all[n] === btn) all[n].classList.add('selected');
            else all[n].classList.remove('selected');
          }
          $('confirmAnswer').disabled = false;
        };
      })(ansBtns[m]);
    }
    $('confirmAnswer').disabled = !!prior || selectedAnswer === null;
  }

  /* ---------- подключение ---------- */
  var connectPromise = null;
  function connect(cb) {
    if (net || db) { cb(true); return; }
    if (connectPromise) { cb(false); return; }
    room = roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'WALLACE31';
    status('Подключение…');
    connectPromise = true;
    connectFirebase(function () {
      setConnectedUI('FIREBASE');
      cb(true);
    }, function () {
      connectMqtt(function () {
        setConnectedUI('РЕЗЕРВНЫЙ КАНАЛ');
        cb(true);
      }, function () {
        status('Не удалось подключиться ни по одному каналу. Проверьте интернет и код комнаты.');
        cb(false);
      });
    });
  }

  connectButton.onclick = function () {
    connectButton.disabled = true;
    connect(function (ok) { if (!ok) connectButton.disabled = false; });
  };
  startButton.disabled = true;
  startButton.onclick = function () {
    startButton.disabled = true;
    status('Запускаем расследование…');
    connect(function (ok) {
      if (!ok) { startButton.disabled = false; return; }
      var sent = send({ type: 'start' });
      if (sent) {
        startedRemote = true;
        status('Команда отправлена. Ждём подтверждения телевизора…');
      } else {
        startButton.disabled = false;
      }
    });
  };

  $('showMap').onclick = function () { send({ type: 'show_map' }); };
  $('showBoard').onclick = function () { send({ type: 'show_board' }); };
  $('closeView').onclick = function () { send({ type: 'close_view' }); };
  $('confirmAnswer').onclick = function () {
    if (selectedAnswer !== null) {
      send({ type: 'answer', choice: selectedAnswer });
      selectedAnswer = null;
      $('confirmAnswer').disabled = true;
    }
  };
  $('nextButton').onclick = function () { send({ type: 'continue' }); };
  $('saveNotes').onclick = function () { send({ type: 'notes', notes: $('remoteNotes').value }); };

  if (bc) bc.onmessage = function (e) {
    if (e && e.data && e.data.kind === 'state') render(e.data.state);
  };

  connect(function () {});
})();
