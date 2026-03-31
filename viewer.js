(function () {
  'use strict';

  const APP = {
    viewer: null,
    logs: [],
    audioCount: 0,
    statsTimer: null,
    visualizers: [],
  };

  function el(id) { return document.getElementById(id); }
  function setText(id, text) { const n = el(id); if (n) n.textContent = text; }
  function setValue(id, value) { const n = el(id); if (n) n.value = value; }

  function log(message, data) {
    const stamp = new Date().toISOString();
    let line = `[${stamp}] ${message}`;
    if (typeof data !== 'undefined') {
      try { line += ' ' + (typeof data === 'string' ? data : JSON.stringify(data, null, 2)); }
      catch (_) { line += ' ' + String(data); }
    }
    APP.logs.push(line);
    APP.logs = APP.logs.slice(-400);
    setValue('debugLog', APP.logs.join('\n\n'));
    console.log(line);
  }

  function parseStreamId(raw) {
    const value = (raw || '').trim().replace(/^\/+|\/+$/g, '');
    if (!value) return { streamId: '', accountId: '', streamName: '' };
    const parts = value.split('/').map((part) => part.trim()).filter(Boolean);
    return {
      streamId: parts.length >= 2 ? `${parts[0]}/${parts.slice(1).join('/')}` : value,
      accountId: parts[0] || '',
      streamName: parts.slice(1).join('/') || '',
    };
  }

  function resizeCanvasToDisplaySize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width * window.devicePixelRatio));
    const height = Math.max(1, Math.floor(rect.height * window.devicePixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function makeVisualizer(stream, canvas, trackId) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;

    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    src.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const drawCtx = canvas.getContext('2d');
    let raf = 0;

    function draw() {
      resizeCanvasToDisplaySize(canvas);
      analyser.getByteFrequencyData(data);

      const w = canvas.width;
      const h = canvas.height;
      drawCtx.clearRect(0, 0, w, h);
      drawCtx.fillStyle = '#09101f';
      drawCtx.fillRect(0, 0, w, h);

      const barCount = data.length;
      const barWidth = Math.max(1, Math.floor(w / barCount));
      let x = 0;

      for (let i = 0; i < barCount; i++) {
        const v = data[i] / 255;
        const barHeight = Math.max(2, Math.floor(v * h));
        const grad = drawCtx.createLinearGradient(0, h, 0, h - barHeight);
        grad.addColorStop(0, '#57f0c7');
        grad.addColorStop(0.5, '#7b8dff');
        grad.addColorStop(1, '#ff7dde');
        drawCtx.fillStyle = grad;
        drawCtx.fillRect(x, h - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }

      raf = requestAnimationFrame(draw);
    }

    draw();
    log('Visualizer started', { trackId });

    return {
      stop() {
        if (raf) cancelAnimationFrame(raf);
        try { src.disconnect(); } catch (_) {}
        try { analyser.disconnect(); } catch (_) {}
        try { ctx.close(); } catch (_) {}
      }
    };
  }

  function addAudioCard(track, stream) {
    APP.audioCount += 1;
    setText('trackCount', String(APP.audioCount));

    const wrap = document.createElement('div');
    wrap.className = 'audio-card';
    wrap.innerHTML = `
      <h3>Audio Track ${APP.audioCount}</h3>
      <p>Kind: ${track.kind}</p>
      <div class="pill-row">
        <span class="pill">id: ${track.id}</span>
        <span class="pill">readyState: ${track.readyState}</span>
        <span class="pill">muted: ${track.muted}</span>
      </div>
      <div class="visualizer-shell">
        <canvas class="visualizer"></canvas>
      </div>
    `;

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.srcObject = stream;

    wrap.appendChild(audio);
    el('audioList').appendChild(wrap);

    const canvas = wrap.querySelector('canvas.visualizer');
    const viz = makeVisualizer(stream, canvas, track.id);
    if (viz) APP.visualizers.push(viz);
  }

  async function pollStats() {
    try {
      const pc = APP.viewer?.webRTCPeer?.peer;
      if (!pc || !pc.getStats) return;
      const report = await pc.getStats();
      let inboundAudio = null;
      let codec = null;

      report.forEach((stat) => {
        if (stat.type === 'inbound-rtp' && stat.kind === 'audio') inboundAudio = stat;
      });

      if (inboundAudio && inboundAudio.codecId && report.get(inboundAudio.codecId)) {
        codec = report.get(inboundAudio.codecId);
      }

      if (codec) {
        setText('codecState', codec.mimeType || codec.id || 'Unknown');
        log('receiver stats', {
          codec: codec.mimeType || codec.id,
          channels: codec.channels,
          sdpFmtpLine: codec.sdpFmtpLine,
          payloadType: codec.payloadType,
        });
      }
    } catch (error) {
      log('stats poll failed', String(error));
    }
  }

  async function start() {
    if (APP.viewer) return;
    const params = new URLSearchParams(window.location.search);
    const streamIdRaw = el('streamIdInput').value || params.get('streamId') || '';
    const { streamId, accountId, streamName } = parseStreamId(streamIdRaw);

    if (!streamId || !accountId || !streamName) {
      alert('Missing streamId');
      return;
    }

    el('audioList').innerHTML = '';
    APP.audioCount = 0;
    APP.visualizers.forEach(v => { try { v.stop(); } catch (_) {} });
    APP.visualizers = [];
    setText('trackCount', '0');
    setText('codecState', 'Unknown');
    setText('viewerState', 'Connecting');
    setText('streamState', streamId);
    setText('statusLine', 'Connecting...');
    log('start requested', { streamId, accountId, streamName });

    const tokenGenerator = () =>
      millicast.Director.getSubscriber({
        streamName: streamName,
        streamAccountId: accountId,
      });

    APP.viewer = new millicast.View(undefined, tokenGenerator);

    APP.viewer.on('track', (event) => {
      const track = event.track;
      log('track event', { kind: track.kind, id: track.id, readyState: track.readyState });
      if (track.kind === 'audio') {
        addAudioCard(track, new MediaStream([track]));
      }
    });

    APP.viewer.on('connectionStateChange', (state) => {
      log('connectionStateChange', state);
      setText('viewerState', String(state));
    });

    APP.viewer.on('error', (error) => {
      log('viewer error', error?.message || String(error));
      setText('viewerState', 'Error');
      setText('statusLine', `Error: ${error?.message || error}`);
    });

    try {
      await APP.viewer.connect();
      setText('viewerState', 'Connected');
      setText('statusLine', 'Connected');
      el('startBtn').disabled = true;
      el('stopBtn').disabled = false;
      if (APP.statsTimer) clearInterval(APP.statsTimer);
      APP.statsTimer = setInterval(pollStats, 4000);
    } catch (error) {
      log('connect failed', error?.stack || String(error));
      setText('viewerState', 'Error');
      setText('statusLine', `Connect failed: ${error?.message || error}`);
      APP.viewer = null;
    }
  }

  async function stop() {
    if (APP.statsTimer) {
      clearInterval(APP.statsTimer);
      APP.statsTimer = null;
    }
    APP.visualizers.forEach(v => { try { v.stop(); } catch (_) {} });
    APP.visualizers = [];
    try { await APP.viewer?.stop?.(); } catch (_) {}
    try { await APP.viewer?.disconnect?.(); } catch (_) {}
    APP.viewer = null;
    APP.audioCount = 0;
    el('audioList').innerHTML = '';
    setText('trackCount', '0');
    setText('viewerState', 'Stopped');
    setText('codecState', 'Unknown');
    setText('statusLine', 'Stopped');
    el('startBtn').disabled = false;
    el('stopBtn').disabled = true;
    log('viewer stopped');
  }

  async function copyLogs() {
    await navigator.clipboard.writeText(APP.logs.join('\n\n'));
    setText('statusLine', 'Logs copied');
  }

  function init() {
    const params = new URLSearchParams(window.location.search);
    const streamId = params.get('streamId') || '';
    if (streamId) el('streamIdInput').value = streamId;
    el('startBtn').addEventListener('click', start);
    el('stopBtn').addEventListener('click', stop);
    el('copyLogsBtn').addEventListener('click', copyLogs);
    const autoStart = (params.get('autoStart') || el('autoStartToggle').value || 'true').toLowerCase() === 'true';
    if (autoStart && streamId) start();
  }

  window.addEventListener('load', init);
})();
