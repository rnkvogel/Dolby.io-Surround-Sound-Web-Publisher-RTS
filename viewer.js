(function () {
  'use strict';

  const APP = {
    viewer: null,
    logs: [],
    audioCount: 0,
    statsTimer: null,
  };

  function el(id) { return document.getElementById(id); }

  function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
  }

  function setValue(id, value) {
    const node = el(id);
    if (node) node.value = value;
  }

  function log(message, data) {
    const stamp = new Date().toISOString();
    let line = `[${stamp}] ${message}`;
    if (typeof data !== 'undefined') {
      try {
        line += ' ' + (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
      } catch (_) {
        line += ' ' + String(data);
      }
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
    `;

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.srcObject = stream;

    audio.addEventListener('loadedmetadata', () => {
      log('audio loadedmetadata', {
        id: track.id,
        sinkId: typeof audio.sinkId === 'string' ? audio.sinkId : 'default',
      });
    });

    audio.addEventListener('play', () => log('audio play', { id: track.id }));
    audio.addEventListener('error', () => log('audio error', audio.error ? { code: audio.error.code, message: audio.error.message } : 'unknown'));

    wrap.appendChild(audio);
    el('audioList').appendChild(wrap);
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
          inboundId: inboundAudio?.id,
          codec: codec.mimeType || codec.id,
          channels: codec.channels,
          clockRate: codec.clockRate,
          sdpFmtpLine: codec.sdpFmtpLine,
          payloadType: codec.payloadType,
          bytesReceived: inboundAudio?.bytesReceived,
          packetsReceived: inboundAudio?.packetsReceived,
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
      log('track event', {
        kind: track.kind,
        id: track.id,
        readyState: track.readyState,
        muted: track.muted,
      });

      if (track.kind === 'audio') {
        const stream = new MediaStream([track]);
        addAudioCard(track, stream);
      }
    });

    APP.viewer.on('broadcastEvent', (event) => {
      log('broadcastEvent', event?.data || event);
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
      log('viewer connected');

      el('startBtn').disabled = true;
      el('stopBtn').disabled = false;

      if (APP.statsTimer) clearInterval(APP.statsTimer);
      APP.statsTimer = setInterval(pollStats, 4000);

      const pc = APP.viewer?.webRTCPeer?.peer;
      if (pc) {
        log('peer connection available', {
          signalingState: pc.signalingState,
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
        });
        if (pc.remoteDescription?.sdp) {
          log('remoteDescription SDP snippet', pc.remoteDescription.sdp.slice(0, 1800));
        }
      }
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
    log('viewer page loaded', { autoStart, streamId });
    if (autoStart && streamId) start();
  }

  window.addEventListener('load', init);
})();
