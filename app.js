/* ============================================================
   春日影 · Now Playing
   TTML 逐词歌词 / 播放控制 / 视频背景
   ============================================================ */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const video = $('bgVideo');

  const listEl = $('lyricsList');
  const viewportEl = $('lyricsViewport');
  const seekEl = $('seek');
  const volEl = $('vol');

  const state = {
    lines: [],
    mode: localStorage.getItem('hh.mode') || 'zh',
    repeat: localStorage.getItem('hh.repeat') || 'all',
    dragging: false,
    previewTime: 0,
    activeIndex: -1,
    ready: false,
  };

  /* ========================= 工具 ========================= */

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function parseTime(str) {
    if (!str) return 0;
    const m = String(str).trim().match(/^(?:(\d+):)?(\d+)(?:\.(\d+))?$/);
    if (!m) return 0;
    const frac = (m[3] || '0').padEnd(3, '0').slice(0, 3);
    return (parseInt(m[1] || '0', 10) * 60) + parseInt(m[2], 10) + parseInt(frac, 10) / 1000;
  }

  /* 取任意命名空间前缀下的属性（ttm:role / amll:key / xml:lang ...） */
  function attr(el, local) {
    let out = null;
    for (const a of el.attributes) {
      const ln = a.localName || a.name;
      if (ln === local) { out = a.value; if (a.name.includes(':')) return a.value; }
    }
    return out;
  }

  /* ========================= TTML 解析 ========================= */

  function parseTTML(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('TTML 解析失败');

    const meta = {};
    doc.querySelectorAll('meta').forEach((m) => {
      const k = attr(m, 'key');
      const v = attr(m, 'value');
      if (k && !(k in meta)) meta[k] = v;
    });

    const lines = [];
    doc.querySelectorAll('p').forEach((p) => {
      const begin = parseTime(attr(p, 'begin'));
      const end = parseTime(attr(p, 'end'));
      const agent = attr(p, 'agent') || 'v1';

      const words = [];
      let zh = '', ro = '', en = '';

      const walk = (node) => {
        node.childNodes.forEach((n) => {
          if (n.nodeType === 3) {
            const txt = n.nodeValue;
            if (!txt) return;
            if (txt.trim()) words.push({ t: txt, b: begin, e: end });
            else if (words.length) words.push({ t: ' ' });
            return;
          }
          if (n.nodeType !== 1) return;

          const role = attr(n, 'role');
          if (role === 'x-translation') {
            const lang = attr(n, 'lang');
            if (lang === 'zh-Hans' || lang === 'zh') zh = n.textContent;
            else if (lang === 'en') en = n.textContent;
          } else if (role === 'x-roman') {
            ro = n.textContent;
          } else if (n.getAttribute('begin') !== null) {
            words.push({
              t: n.textContent,
              b: parseTime(attr(n, 'begin')),
              e: parseTime(attr(n, 'end')),
            });
          } else {
            walk(n);
          }
        });
      };
      walk(p);

      const textLine = words.map((w) => w.t).join('');
      if (!textLine.trim()) return;

      lines.push({
        b: begin, e: end, agent, words,
        text: textLine, zh, ro, en,
        st: -1, wordsRef: [], subEl: null, el: null,
      });
    });

    lines.sort((a, b) => a.b - b.b);
    return { meta, lines };
  }

  /* ========================= 歌词渲染 ========================= */

  function buildLyrics(lines) {
    listEl.textContent = '';
    state.lines = lines;

    lines.forEach((line, i) => {
      const el = document.createElement('div');
      el.className = 'lyric-line' + (line.agent === 'v2' ? ' bg' : '');
      el.dataset.index = i;

      const textEl = document.createElement('div');
      textEl.className = 'ly-text';

      line.wordsRef = line.words.map((w) => {
        if (w.t === ' ') {
          textEl.appendChild(document.createTextNode(' '));
          return null;
        }
        const word = document.createElement('span');
        word.className = 'word';
        const base = document.createElement('span');
        base.className = 'base';
        base.textContent = w.t;
        const ink = document.createElement('span');
        ink.className = 'ink';
        ink.textContent = w.t;
        word.appendChild(base);
        word.appendChild(ink);
        textEl.appendChild(word);
        return { ink, b: w.b, e: w.e, full: false, started: false };
      }).filter(Boolean);

      const sub = document.createElement('div');
      sub.className = 'ly-sub';
      sub.textContent = subText(line);

      el.appendChild(textEl);
      el.appendChild(sub);
      line.el = el;
      line.subEl = sub;
      listEl.appendChild(el);
    });

    $('lyricsEmpty').hidden = lines.length > 0;
    if (!lines.length) $('lyricsEmpty').textContent = '歌词数据不可用';
  }

  function subText(line) {
    if (state.mode === 'ro') return line.ro || line.zh || '';
    return line.zh || line.ro || '';
  }

  function refreshSubs() {
    state.lines.forEach((l) => { l.subEl.textContent = subText(l); });
  }

  /* ========================= 逐词渲染 ========================= */

  function setFull(w) {
    if (w.full) return;
    w.ink.style.transition = 'none';
    w.ink.style.clipPath = 'inset(0 0 0 0)';
    w.full = true;
    w.started = false;
  }

  function setNone(w) {
    if (!w.full && !w.started) return;
    w.ink.style.transition = 'none';
    w.ink.style.clipPath = 'inset(0 100% 0 0)';
    w.full = false;
    w.started = false;
  }

  function startWord(w, t) {
    if (w.started) return;
    w.ink.style.transition = 'none';
    w.ink.style.clipPath = 'inset(0 100% 0 0)';
    void w.ink.offsetWidth; /* 强制回流，让过渡从 0 开始 */
    const dur = Math.max(0.016, w.e - t);
    w.ink.style.transition = `clip-path ${dur}s linear`;
    w.ink.style.clipPath = 'inset(0 0 0 0)';
    w.started = true;
    w.full = false;
  }

  function renderWords(line, t) {
    for (const w of line.wordsRef) {
      if (t >= w.e) setFull(w);
      else if (t <= w.b) setNone(w);
      else startWord(w, t);
    }
  }

  function flushLine(line) { line.wordsRef.forEach(setFull); }
  function clearLine(line) { line.wordsRef.forEach(setNone); }

  function setLineState(line, st) {
    line.el.classList.toggle('active', st === 1);
    line.el.classList.toggle('past', st === 2);
    if (st === 2) flushLine(line);
    else if (st === 0) clearLine(line);
    line.st = st;
  }

  /* ========================= 滚动 ========================= */

  let scrollTimer = 0;

  function layoutPadding() {
    const h = viewportEl.clientHeight;
    const pad = Math.round(h * 0.5 - 46);
    listEl.style.paddingTop = `${pad}px`;
    listEl.style.paddingBottom = `${pad}px`;
  }

  function scrollToLine(i, instant) {
    const line = state.lines[i];
    if (!line) return;
    const off = line.el.offsetTop + line.el.offsetHeight / 2 - viewportEl.clientHeight / 2;
    if (instant) {
      listEl.style.transition = 'none';
      listEl.style.transform = `translate3d(0, ${-off}px, 0)`;
      void listEl.offsetHeight;
      listEl.style.transition = '';
    } else {
      listEl.style.transform = `translate3d(0, ${-off}px, 0)`;
    }
  }

  /* ========================= MV 视频同步 ========================= */

  /* MV 与音频来自同一母带，时间轴一致：用片源内嵌字幕的换行时刻校准过
     （视频 14.9s 出现 15.26s 那句、235.5s 出现 236.11s 那句，偏移恒定）。
     若换用别的片源，可在 0 附近微调这个值。 */
  const VIDEO_OFFSET = 0;

  function videoTarget() {
    return clamp(audio.currentTime + VIDEO_OFFSET, 0, Math.max(0, video.duration - 0.05));
  }

  /* 硬同步：跳转、开始播放、循环重启时用 */
  function syncVideo(reason) {
    if (!video.duration || video.seeking) return;
    video.currentTime = videoTarget();
    video.playbackRate = 1;
  }

  /* 软同步：正常播放时只在漂移时微调播放速率，避免频繁跳帧 */
  function syncVideoSmooth() {
    if (audio.paused || video.paused || video.seeking || !video.duration) return;
    const target = videoTarget();
    const drift = video.currentTime - target;
    if (Math.abs(drift) > 0.4) {
      video.currentTime = target;
      video.playbackRate = 1;
    } else if (Math.abs(drift) > 0.12) {
      video.playbackRate = 1 - clamp(drift * 0.4, -0.06, 0.06);
    } else if (video.playbackRate !== 1) {
      video.playbackRate = 1;
    }
  }

  /* ========================= 主循环 ========================= */

  let lastTick = 0;

  function tick(now) {
    requestAnimationFrame(tick);
    if (now - lastTick < 40) return;
    lastTick = now;

    const t = state.dragging ? state.previewTime : audio.currentTime;

    /* 视频跟音频走 */
    syncVideoSmooth();

    /* 进度 */
    const dur = duration();
    const ratio = dur ? clamp(t / dur, 0, 1) : 0;
    if (!state.dragging) {
      $('seekFill').style.width = `${ratio * 100}%`;
      $('seekThumb').style.left = `${ratio * 100}%`;
      $('curTime').textContent = fmtTime(t);
      seekEl.setAttribute('aria-valuenow', Math.round(ratio * 100));
    }

    if (!state.ready) return;

    /* 逐行状态 */
    let active = -1;
    for (let i = 0; i < state.lines.length; i++) {
      const line = state.lines[i];
      const st = t >= line.e ? 2 : t >= line.b ? 1 : 0;
      if (st !== line.st) setLineState(line, st);
      if (st === 1) {
        renderWords(line, t);
        active = i;
      }
    }

    if (active !== state.activeIndex) {
      state.activeIndex = active;
      if (active >= 0) {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => scrollToLine(active, false), 30);
      }
    }
  }

  function duration() {
    const d = audio.duration;
    if (isFinite(d) && d > 0) return d;
    const last = state.lines[state.lines.length - 1];
    return last ? last.e : 0;
  }

  /* ========================= 播放控制 ========================= */

  const playIcon = $('playIcon');
  const useOf = (el) => (el.tagName.toLowerCase() === 'use' ? el : el.querySelector('use'));

  function setPlaying(playing) {
    document.body.classList.toggle('paused', !playing);
    useOf(playIcon).setAttribute('href', playing ? '#i-pause' : '#i-play');
    $('playBtn').setAttribute('aria-label', playing ? '暂停' : '播放');
    /* 视频完全跟随音频：一起播、一起停 */
    if (playing) {
      syncVideo('play');
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function togglePlay() {
    if (audio.paused) audio.play().catch(() => showStart());
    else audio.pause();
  }

  function seekTo(sec) {
    const d = duration();
    audio.currentTime = clamp(sec, 0, Math.max(0, d - 0.05));
    state.lines.forEach((l) => { l.st = -1; });
    syncVideo('seek');
  }

  audio.addEventListener('play', () => { setPlaying(true); hideStart(); });
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('seeked', () => syncVideo('seeked'));
  audio.addEventListener('ended', () => {
    /* repeat !== off 时由 audio.loop 无缝接续，这里只处理不循环的情况 */
    if (state.repeat === 'off') setPlaying(false);
  });
  /* 切回标签页时可能被节流，回来补一次同步 */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncVideo('visible');
  });
  audio.addEventListener('loadedmetadata', () => {
    const d = duration();
    $('totTime').textContent = fmtTime(d);
    $('factDur').textContent = fmtTime(d);
    seekEl.setAttribute('aria-valuemax', '100');
  });
  audio.addEventListener('progress', () => {
    if (!audio.buffered.length) return;
    const d = duration();
    const end = audio.buffered.end(audio.buffered.length - 1);
    $('seekBuffer').style.width = `${d ? (end / d) * 100 : 0}%`;
  });

  $('playBtn').addEventListener('click', togglePlay);
  document.querySelector('.cover-box').addEventListener('click', togglePlay);
  document.querySelector('.pb-cover').addEventListener('click', togglePlay);
  $('prevBtn').addEventListener('click', () => seekTo(0));
  $('nextBtn').addEventListener('click', () => { seekTo(0); audio.play().catch(() => {}); });

  /* 循环模式 */
  const repeatIcon = $('repeatIcon');
  const repeatOrder = ['all', 'one', 'off'];
  const repeatLabel = { all: '列表循环', one: '单曲循环', off: '不循环' };

  function applyRepeat() {
    const btn = $('repeatBtn');
    audio.loop = state.repeat !== 'off';
    const btnUse = useOf(repeatIcon);
    btnUse.setAttribute('href', state.repeat === 'one' ? '#i-repeat-one' : '#i-repeat');
    btn.classList.toggle('on', state.repeat !== 'off');
    btn.setAttribute('aria-label', repeatLabel[state.repeat]);
    btn.title = `循环模式：${repeatLabel[state.repeat]}`;
    localStorage.setItem('hh.repeat', state.repeat);
  }
  applyRepeat();

  $('repeatBtn').addEventListener('click', () => {
    state.repeat = repeatOrder[(repeatOrder.indexOf(state.repeat) + 1) % 3];
    applyRepeat();
  });

  /* 随机播放（单曲列表，仅作状态切换） */
  const shuffleBtn = $('shuffleBtn');
  shuffleBtn.addEventListener('click', () => {
    const on = shuffleBtn.classList.toggle('on');
    shuffleBtn.setAttribute('aria-pressed', String(on));
  });

  /* 喜欢 */
  function toggleLike() {
    const liked = !$('likeBtn').classList.contains('liked');
    $('likeBtn').classList.toggle('liked', liked);
    $('likeBtn').setAttribute('aria-pressed', String(liked));
    $('likeBtn2').classList.toggle('on', liked);
    $('likeBtn2').setAttribute('aria-pressed', String(liked));
    useOf($('likeIcon')).setAttribute('href', liked ? '#i-heart-fill' : '#i-heart');
    useOf($('likeIcon2')).setAttribute('href', liked ? '#i-heart-fill' : '#i-heart');
  }
  $('likeBtn').addEventListener('click', toggleLike);
  $('likeBtn2').addEventListener('click', toggleLike);

  /* 定位歌词 */
  $('recenterBtn').addEventListener('click', () => {
    const i = state.activeIndex >= 0 ? state.activeIndex : nearestLine(audio.currentTime);
    if (i >= 0) scrollToLine(i, false);
  });

  function nearestLine(t) {
    let best = 0;
    state.lines.forEach((l, i) => { if (l.b <= t) best = i; });
    return best;
  }

  /* ========================= 进度条 ========================= */

  function bindDrag(el, getRatio, onMove, onEnd) {
    let active = false;
    const ratioOf = (ev) => {
      const r = el.getBoundingClientRect();
      return clamp((ev.clientX - r.left) / r.width, 0, 1);
    };
    const down = (ev) => {
      active = true;
      el.classList.add('dragging');
      el.setPointerCapture?.(ev.pointerId);
      const v = ratioOf(ev);
      getRatio(v);
      onMove?.(v);
      ev.preventDefault();
    };
    const move = (ev) => {
      if (!active) return;
      const v = ratioOf(ev);
      getRatio(v);
      onMove?.(v);
    };
    const up = (ev) => {
      if (!active) return;
      active = false;
      el.classList.remove('dragging');
      const v = ratioOf(ev);
      getRatio(v);
      onEnd?.(v);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  const seekFill = $('seekFill');
  const seekThumb = $('seekThumb');

  function paintSeek(ratio) {
    seekFill.style.width = `${ratio * 100}%`;
    seekThumb.style.left = `${ratio * 100}%`;
    $('curTime').textContent = fmtTime(ratio * duration());
    seekEl.setAttribute('aria-valuenow', Math.round(ratio * 100));
  }

  bindDrag(seekEl, (r) => {
    state.dragging = true;
    state.previewTime = r * duration();
    paintSeek(r);
  }, (r) => {
    state.previewTime = r * duration();
    paintSeek(r);
  }, (r) => {
    state.dragging = false;
    seekTo(r * duration());
    paintSeek(r);
  });

  /* 键盘操作进度条 */
  seekEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      seekTo(audio.currentTime + (e.key === 'ArrowLeft' ? -5 : 5));
    } else if (e.key === 'Home') { e.preventDefault(); seekTo(0); }
  });

  /* ========================= 音量 ========================= */

  const volFill = $('volFill');
  const volThumb = $('volThumb');

  let volume = parseFloat(localStorage.getItem('hh.volume'));
  if (!isFinite(volume)) volume = 0.8;
  let muted = false;

  function paintVolume() {
    const v = muted ? 0 : volume;
    volFill.style.width = `${v * 100}%`;
    volThumb.style.left = `${v * 100}%`;
    volEl.setAttribute('aria-valuenow', Math.round(v * 100));
    useOf($('volIcon')).setAttribute('href', v === 0 ? '#i-mute' : '#i-volume');
    $('muteBtn').setAttribute('aria-label', v === 0 ? '取消静音' : '静音');
  }

  function applyVolume() {
    audio.volume = clamp(muted ? 0 : volume, 0, 1);
    audio.muted = muted;
    paintVolume();
    localStorage.setItem('hh.volume', String(volume));
  }

  bindDrag(volEl, (r) => {
    volume = r;
    muted = r === 0;
    applyVolume();
  });

  $('muteBtn').addEventListener('click', () => {
    muted = !muted;
    if (!muted && volume === 0) volume = 0.6;
    applyVolume();
  });

  volEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault(); volume = clamp(volume + 0.05, 0, 1); muted = false; applyVolume();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault(); volume = clamp(volume - 0.05, 0, 1); muted = volume === 0; applyVolume();
    }
  });

  audio.volume = volume;
  paintVolume();

  /* ========================= 模糊度（背景视频 + 面板） ========================= */

  const blurBtn = $('blurBtn');
  const blurFlyout = $('blurFlyout');
  const blurRange = $('blurRange');
  const panelRange = $('panelRange');
  const BG_MAX = 24;
  const PANEL_MAX = 80;
  const PANEL_DEFAULT = 34;

  let bgBlur = parseFloat(localStorage.getItem('hh.blur'));
  if (!isFinite(bgBlur)) bgBlur = 0;
  let panelBlur = parseFloat(localStorage.getItem('hh.panelBlur'));
  if (!isFinite(panelBlur)) panelBlur = PANEL_DEFAULT;

  function paintRange(input, value, max) {
    input.value = String(value);
    input.style.setProperty('--v', `${(value / max) * 100}%`);
  }

  function applyBlur(save) {
    document.documentElement.style.setProperty('--bg-blur', `${bgBlur}px`);
    document.documentElement.style.setProperty('--panel-blur', `${panelBlur}px`);
    paintRange(blurRange, bgBlur, BG_MAX);
    paintRange(panelRange, panelBlur, PANEL_MAX);
    $('bgBlurVal').textContent = bgBlur === 0 ? '关闭' : `${bgBlur} px`;
    $('panelBlurVal').textContent = panelBlur === 0 ? '无' : `${panelBlur} px`;
    blurBtn.classList.toggle('on', bgBlur > 0 || panelBlur !== PANEL_DEFAULT);
    if (save) {
      localStorage.setItem('hh.blur', String(bgBlur));
      localStorage.setItem('hh.panelBlur', String(panelBlur));
    }
  }

  function setBgBlur(v) {
    bgBlur = clamp(Math.round(v), 0, BG_MAX);
    applyBlur(true);
  }
  function setPanelBlur(v) {
    panelBlur = clamp(Math.round(v), 0, PANEL_MAX);
    applyBlur(true);
  }

  function openBlurFlyout(open) {
    blurFlyout.hidden = !open;
    blurBtn.setAttribute('aria-expanded', String(open));
    if (open) blurRange.focus({ preventScroll: true });
  }

  blurBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openBlurFlyout(blurFlyout.hidden);
  });

  blurRange.addEventListener('input', () => setBgBlur(Number(blurRange.value)));
  panelRange.addEventListener('input', () => setPanelBlur(Number(panelRange.value)));

  $('blurReset').addEventListener('click', () => {
    bgBlur = 0;
    panelBlur = PANEL_DEFAULT;
    applyBlur(true);
  });

  document.addEventListener('pointerdown', (e) => {
    if (blurFlyout.hidden) return;
    if (e.target.closest('.blur-wrap')) return;
    openBlurFlyout(false);
  });

  applyBlur(false);

  /* ========================= 歌词点击 / 模式切换 ========================= */

  listEl.addEventListener('click', (e) => {
    const el = e.target.closest('.lyric-line');
    if (!el) return;
    const line = state.lines[Number(el.dataset.index)];
    if (!line) return;
    seekTo(line.b + 0.01);
    if (audio.paused) audio.play().catch(() => {});
  });

  const seg = $('segMode');
  function applyMode() {
    [...seg.children].forEach((b) => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    localStorage.setItem('hh.mode', state.mode);
    refreshSubs();
  }
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.mode = b.dataset.mode;
    applyMode();
  });
  applyMode();

  /* ========================= 窗口按钮 ========================= */

  $('capMin').addEventListener('click', () => {
    const on = document.body.classList.toggle('immersive');
    $('capMin').title = on ? '退出沉浸模式' : '最小化（沉浸模式）';
    requestAnimationFrame(() => {
      layoutPadding();
      if (state.activeIndex >= 0) scrollToLine(state.activeIndex, true);
    });
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  $('capMax').addEventListener('click', toggleFullscreen);
  $('fsBtn').addEventListener('click', toggleFullscreen);

  $('capClose').addEventListener('click', () => {
    audio.pause();
    $('closedScreen').hidden = false;
  });
  $('reopenBtn').addEventListener('click', () => {
    $('closedScreen').hidden = true;
    audio.play().catch(() => showStart());
  });

  /* ========================= 自动播放 ========================= */

  function showStart() {
    $('startOverlay').hidden = false;
  }
  function hideStart() {
    $('startOverlay').hidden = true;
  }

  $('startBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    audio.play().catch(() => {});
  });

  document.addEventListener('pointerdown', (e) => {
    if ($('startOverlay').hidden) return;
    if (e.target.closest('.start-card')) return;
    audio.play().catch(() => {});
  });

  /* 视频背景：静音、不自己播放，完全跟随音频时间轴 */
  video.muted = true;
  video.addEventListener('loadedmetadata', () => syncVideo('loaded'));
  if (video.readyState >= 1) syncVideo('loaded');

  /* ========================= 键盘快捷键 ========================= */

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;

    /* 模糊度快捷键：任何时候都生效。[] 背景，{} 面板 */
    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      setBgBlur(bgBlur + (e.key === ']' ? 2 : -2));
      return;
    }
    if (e.key === '{' || e.key === '}') {
      e.preventDefault();
      setPanelBlur(panelBlur + (e.key === '}' ? 4 : -4));
      return;
    }
    if (e.key === 'Escape' && !blurFlyout.hidden) {
      openBlurFlyout(false);
      return;
    }

    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.target.closest?.('[role="slider"]')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowRight' && document.activeElement !== seekEl) {
      seekTo(audio.currentTime + 5);
    } else if (e.key === 'ArrowLeft' && document.activeElement !== seekEl) {
      seekTo(audio.currentTime - 5);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); volume = clamp(volume + 0.05, 0, 1); muted = false; applyVolume();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault(); volume = clamp(volume - 0.05, 0, 1); muted = volume === 0; applyVolume();
    } else if (e.key === 'Escape' && document.body.classList.contains('immersive')) {
      document.body.classList.remove('immersive');
    } else if (e.key.toLowerCase() === 'f') {
      toggleFullscreen();
    }
  });

  /* ========================= 布局自适应 ========================= */

  const ro = new ResizeObserver(() => {
    layoutPadding();
    if (state.activeIndex >= 0) scrollToLine(state.activeIndex, true);
  });
  ro.observe(viewportEl);

  window.addEventListener('resize', () => {
    layoutPadding();
    if (state.activeIndex >= 0) scrollToLine(state.activeIndex, true);
  });

  /* ========================= 启动 ========================= */

  document.body.classList.add('paused');

  async function boot() {
    let data = null;
    try {
      const res = await fetch('Lyric/cry.ttml', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = parseTTML(await res.text());
      if (!data.lines.length) throw new Error('empty');
    } catch (err) {
      data = window.LYRICS_FALLBACK || { meta: {}, lines: [] };
    }

    buildLyrics(data.lines || []);
    layoutPadding();
    state.ready = true;

    /* 元信息兜底 */
    const meta = data.meta || {};
    if (meta.musicName) document.title = `${meta.musicName} · ${meta.artists || ''}`.trim();

    const d = duration();
    if (d) {
      $('totTime').textContent = fmtTime(d);
      $('factDur').textContent = fmtTime(d);
    }

    if (state.lines.length) {
      state.activeIndex = -1;
      scrollToLine(0, true);
    }

    requestAnimationFrame(tick);

    /* 尝试自动播放 */
    audio.play().then(() => hideStart()).catch(() => showStart());
  }

  boot();
})();
