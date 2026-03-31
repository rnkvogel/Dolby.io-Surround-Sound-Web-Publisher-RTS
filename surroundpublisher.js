(function () {
  'use strict';

  const LAYOUTS = {
    '5.1': {
      inputs: [
        { key: 'input_1', label: 'Input 1', role: 'Front Left', slot: 0, gain: 1 },
        { key: 'input_2', label: 'Input 2', role: 'Front Right', slot: 1, gain: 1 },
        { key: 'input_3', label: 'Input 3', role: 'Front Center', slot: 2, gain: 1 },
        { key: 'input_4', label: 'Input 4', role: 'Rear Left', slot: 4, gain: 1 },
        { key: 'input_5', label: 'Input 5', role: 'Rear Right', slot: 5, gain: 1 },
        { key: 'input_6', label: 'Input 6', role: 'LFE', slot: 3, gain: 1 },
      ],
      busChannels: 6,
      sdp: {
        rtpmap: 'multiopus/48000/6',
        fmtp: 'channel_mapping=0,4,1,2,3,5;coupled_streams=2;minptime=10;num_streams=4;useinbandfec=1'
      }
    },
    '7.1': {
      inputs: [
        { key: 'input_1', label: 'Input 1', role: 'Front Left', slot: 0, gain: 1 },
        { key: 'input_2', label: 'Input 2', role: 'Front Right', slot: 1, gain: 1 },
        { key: 'input_3', label: 'Input 3', role: 'Front Center', slot: 2, gain: 1 },
        { key: 'input_4', label: 'Input 4', role: 'Rear Left', slot: 4, gain: 1 },
        { key: 'input_5', label: 'Input 5', role: 'Rear Right', slot: 5, gain: 1 },
        { key: 'input_6', label: 'Input 6', role: 'LFE', slot: 3, gain: 1 },
        { key: 'input_7', label: 'Input 7', role: 'Left Middle', slot: 4, gain: .5 },
        { key: 'input_8', label: 'Input 8', role: 'Right Middle', slot: 5, gain: .5 },
      ],
      busChannels: 8,
      sdp: {
        rtpmap: 'multiopus/48000/8',
        fmtp: 'channel_mapping=0,6,1,2,3,4,5,7;coupled_streams=3;minptime=10;num_streams=5;useinbandfec=1'
      }
    }
  };

  const APP = {
    audioContext: null,
    merger: null,
    destination: null,
    monitorGain: null,
    channelEntries: new Map(),
    publisher: null,
    busStream: null,
    streamName: '',
    token: '',
    isPublishing: false,
    patchInstalled: false,
    currentLayout: '5.1',
    currentLayoutConfig: LAYOUTS['5.1'],
    lastMungedSdp: '',
    logs: [],
    spatial: { x: 0, y: 0, dragging: false },
  };

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

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
    if (!value) return { streamId: '', streamAccountId: '', streamName: '' };
    const parts = value.split('/').map((part) => part.trim()).filter(Boolean);
    return {
      streamId: parts.length >= 2 ? `${parts[0]}/${parts.slice(1).join('/')}` : value,
      streamAccountId: parts[0] || '',
      streamName: parts.slice(1).join('/') || '',
    };
  }

    //cstom audio player function
    function getViewerUrl(streamId) {
    const currentUrl = new URL(window.location.href);
    let pathname = currentUrl.pathname;
    if (pathname.endsWith('/')) pathname += 'viewer.html';
    else pathname = pathname.replace(/\/[^/]*$/, '/viewer.html');
    const url = new URL(currentUrl.origin + pathname);
    url.searchParams.set('streamId', streamId);
    return url.toString();
  }
  

    // Millicast viewer URL builder - assumes viewer.html
    /*
    function getViewerUrl(streamId) {
        return `https://viewer.millicast.com/?streamId=${encodeURIComponent(streamId)}`;
    }
   */

  function resetAudioGraph() {
    APP.audioContext = null;
    APP.merger = null;
    APP.destination = null;
    APP.monitorGain = null;
  }

  function ensureAudio() {
    if (APP.audioContext) return;
    APP.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    APP.merger = APP.audioContext.createChannelMerger(APP.currentLayoutConfig.busChannels);
    APP.destination = APP.audioContext.createMediaStreamDestination();
    try { APP.destination.channelCount = APP.currentLayoutConfig.busChannels; } catch (_) {}
    try { APP.destination.channelCountMode = 'explicit'; } catch (_) {}
    try { APP.destination.channelInterpretation = 'speakers'; } catch (_) {}
    try { APP.merger.channelCountMode = 'explicit'; } catch (_) {}
    try { APP.merger.channelInterpretation = 'speakers'; } catch (_) {}
    APP.monitorGain = APP.audioContext.createGain();
    APP.monitorGain.gain.value = 1;
    APP.merger.connect(APP.destination);

    log('Audio graph created', {
      layout: APP.currentLayout,
      destinationChannelCount: APP.destination.channelCount,
      destinationCountMode: APP.destination.channelCountMode,
      destinationInterpretation: APP.destination.channelInterpretation,
      mergerInputs: APP.merger.numberOfInputs,
      mergerOutputs: APP.merger.numberOfOutputs,
      sampleRate: APP.audioContext.sampleRate,
    });
  }

  function createChannelCard(channel) {
    return `
      <div class="channel-card" id="card-${channel.key}">
        <div class="channel-head">
          <div>
            <div class="channel-title">${channel.label}</div>
            <div class="channel-role">${channel.role} • Bus slot ${channel.slot}</div>
          </div>
          <label class="top-toggle">
            <input id="enabled-${channel.key}" type="checkbox" checked />
            On
          </label>
        </div>
        <div class="daw-strip">
          <div class="meter-vertical"><div class="meter-fill-vertical" id="meterVertical-${channel.key}"></div></div>
          <div class="fader-stack">
            <input class="gain-vertical" id="gain-${channel.key}" type="range" min="0" max="2" step="0.05" value="${channel.gain}" />
            <input class="gain-readout" id="gainNumber-${channel.key}" type="number" min="0" max="2" step="0.05" value="${channel.gain}" />
          </div>
          <div class="strip-meta">
            <div><span>State</span><strong id="state-${channel.key}">Idle</strong></div>
            <div><span>Level</span><strong id="level-${channel.key}">0%</strong></div>
            <div><span>Gain</span><strong id="gainRead-${channel.key}">${channel.gain.toFixed(2)}</strong></div>
          </div>
        </div>
        <div class="strip-actions">
          <button class="secondary" id="mute-${channel.key}">Mute</button>
        </div>
        <div class="strip-io">
          <div>
            <label for="device-${channel.key}">Audio input</label>
            <select id="device-${channel.key}"></select>
          </div>
          <div>
            <label for="filter-${channel.key}">Voice mapping / filter</label>
            <select id="filter-${channel.key}">
              <option value="none" selected>No filter</option>
              <option value="lfe">LFE low-pass</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  function renderMap() {
    const grid = document.getElementById('mapGrid');
    grid.style.gridTemplateColumns = `repeat(${APP.currentLayoutConfig.inputs.length}, minmax(0,1fr))`;
    grid.innerHTML = APP.currentLayoutConfig.inputs.map(ch => `<div class="map-pill">${ch.label} → ${ch.role}</div>`).join('');
    setText('mappingNote', `${APP.currentLayoutConfig.sdp.rtpmap} ${APP.currentLayoutConfig.sdp.fmtp}`);
    setText('layoutState', APP.currentLayout);
    setText('busState', `${APP.currentLayoutConfig.inputs.length} mono → 1 multichannel`);
    setText('activeInputCount', `0 / ${APP.currentLayoutConfig.inputs.length}`);
  }

  function renderChannels() {
    const grid = document.getElementById('channelGrid');
    grid.style.gridTemplateColumns = `repeat(${APP.currentLayoutConfig.inputs.length}, minmax(220px,220px))`;
    grid.style.minWidth = `${APP.currentLayoutConfig.inputs.length * 232}px`;
    grid.innerHTML = APP.currentLayoutConfig.inputs.map(createChannelCard).join('');
  }

  async function enumerateAudioInputs() {
    try {
      const temp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      temp.getTracks().forEach((track) => track.stop());
    } catch (_) {}
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    log('Enumerated audio inputs', inputs.map(d => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId })));
    APP.currentLayoutConfig.inputs.forEach((channel) => {
      const select = document.getElementById(`device-${channel.key}`);
      if (!select) return;
      const current = select.value || '';
      select.innerHTML = '<option value="">Default audio input</option>';
      inputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;
        select.appendChild(option);
      });
      if ([...select.options].some((opt) => opt.value === current)) select.value = current;
    });
  }

  function getSpatialGainForChannel(channel) {
    const amount = Number(document.getElementById('spatialAmountInput')?.value || 1);
    const floor = Number(document.getElementById('spatialFloorInput')?.value || 0);
    const power = Number(document.getElementById('spatialPowerInput')?.value || 1.6);
    const speakerX = typeof channel.spatialX === 'number' ? channel.spatialX : 0;
    const speakerY = typeof channel.spatialY === 'number' ? channel.spatialY : 0;
    const dx = APP.spatial.x - speakerX;
    const dy = APP.spatial.y - speakerY;
    const dist = Math.min(2, Math.sqrt(dx * dx + dy * dy));
    const normalized = Math.min(1, dist / 2);
    const attenuated = 1 - Math.pow(normalized, power);
    return floor + (1 - floor) * ((1 - amount) + amount * attenuated);
  }

  function applyEffectiveGain(key) {
    const entry = APP.channelEntries.get(key);
    const channel = APP.currentLayoutConfig.inputs.find((item) => item.key === key);
    const base = Number(document.getElementById(`gain-${key}`)?.value || channel?.gain || 1);
    const spatial = channel ? getSpatialGainForChannel(channel) : 1;
    const finalGain = entry && entry.muted ? 0 : (base * spatial);
    setText(`gainRead-${key}`, finalGain.toFixed(2));
    if (entry?.gainNode) entry.gainNode.gain.value = finalGain;
    const legend = document.getElementById(`spatialGain-${key}`);
    if (legend) legend.textContent = `${spatial.toFixed(2)}x spatial`;
    return { base, spatial, finalGain };
  }

  function applyChannelGain(key, value) {
    const next = Number(value || 1);
    const range = document.getElementById(`gain-${key}`);
    const number = document.getElementById(`gainNumber-${key}`);
    if (range) range.value = String(next);
    if (number) number.value = String(next);
    applyEffectiveGain(key);
  }

  function startMeterLoop(key, analyser) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const update = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs((data[i] - 128) / 128));
      const pctValue = Math.max(3, Math.min(100, Math.round(peak * 220)));
      const pct = `${pctValue}%`;
      const meter = document.getElementById(`meterVertical-${key}`);
      if (meter) meter.style.height = pct;
      setText(`level-${key}`, pct);
      const entry = APP.channelEntries.get(key);
      if (entry) entry.raf = requestAnimationFrame(update);
    };
    update();
  }

  function bindChannelControls(channel) {
    document.getElementById(`gain-${channel.key}`)?.addEventListener('input', (e) => applyChannelGain(channel.key, e.target.value));
    document.getElementById(`gainNumber-${channel.key}`)?.addEventListener('input', (e) => applyChannelGain(channel.key, e.target.value));
    document.getElementById(`mute-${channel.key}`)?.addEventListener('click', () => {
      const entry = APP.channelEntries.get(channel.key);
      if (!entry) return;
      entry.muted = !entry.muted;
      if (entry.track) entry.track.enabled = !entry.muted;
      applyEffectiveGain(channel.key);
      document.getElementById(`mute-${channel.key}`).textContent = entry.muted ? 'Unmute' : 'Mute';
      setText(`state-${channel.key}`, entry.muted ? 'Muted' : 'Live');
      log('Input mute toggled', { key: channel.key, muted: entry.muted });
    });
  }

  function createFilterNode(channelKey) {
    const mode = document.getElementById(`filter-${channelKey}`)?.value || 'none';
    if (mode !== 'lfe') return null;
    const biquad = APP.audioContext.createBiquadFilter();
    biquad.type = 'lowpass';
    biquad.frequency.value = 120;
    biquad.Q.value = 0.707;
    return biquad;
  }

  async function buildBusStream() {
    ensureAudio();
    await APP.audioContext.resume();

    const cleanupOn = String(document.getElementById('cleanupToggle')?.value) === 'true';
    const monitorOn = String(document.getElementById('monitorToggle')?.value) === 'true';
    APP.monitorGain.gain.value = Number(document.getElementById('masterGainInput')?.value || 1);

    let activeCount = 0;

    for (const channel of APP.currentLayoutConfig.inputs) {
      if (!document.getElementById(`enabled-${channel.key}`)?.checked) {
        setText(`state-${channel.key}`, 'Disabled');
        continue;
      }

      const deviceId = (document.getElementById(`device-${channel.key}`)?.value || '').trim();
      const constraints = {
        audio: {
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
          latency: { ideal: 0.02 },
          echoCancellation: cleanupOn,
          noiseSuppression: cleanupOn,
          autoGainControl: cleanupOn,
        },
        video: false,
      };
      if (deviceId) constraints.audio.deviceId = { exact: deviceId };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = mediaStream.getAudioTracks()[0];
      track.contentHint = 'music';

      log('Input track acquired', {
        layout: APP.currentLayout,
        key: channel.key,
        slot: channel.slot,
        settings: track.getSettings ? track.getSettings() : null,
      });

      const source = APP.audioContext.createMediaStreamSource(mediaStream);
      const analyser = APP.audioContext.createAnalyser();
      const gainNode = APP.audioContext.createGain();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      gainNode.gain.value = Number(document.getElementById(`gain-${channel.key}`)?.value || channel.gain);

      source.connect(analyser);
      analyser.connect(gainNode);

      const filterNode = createFilterNode(channel.key);
      if (filterNode) {
        gainNode.connect(filterNode);
        filterNode.connect(APP.merger, 0, channel.slot);
        if (monitorOn) filterNode.connect(APP.monitorGain);
      } else {
        gainNode.connect(APP.merger, 0, channel.slot);
        if (monitorOn) gainNode.connect(APP.monitorGain);
      }

      const entry = { key: channel.key, mediaStream, track, source, analyser, gainNode, filterNode, muted: false, raf: null };
      APP.channelEntries.set(channel.key, entry);
      startMeterLoop(channel.key, analyser);
      applyEffectiveGain(channel.key);
      setText(`state-${channel.key}`, 'Live');
      activeCount += 1;
    }

    if (monitorOn) APP.monitorGain.connect(APP.audioContext.destination);

    setText('activeInputCount', `${activeCount} / ${APP.currentLayoutConfig.inputs.length}`);
    APP.busStream = APP.destination.stream;

    const busTracks = APP.busStream.getAudioTracks();
    log('Bus stream created', {
      layout: APP.currentLayout,
      trackCount: busTracks.length,
      destinationChannelCount: APP.destination.channelCount,
      busTrackSettings: busTracks.map(t => t.getSettings ? t.getSettings() : null),
    });

    return APP.busStream;
  }

  function mungeOfferToMultiOpus(sdp) {
    if (!sdp) return sdp;
    const payloadMatch = sdp.match(/^a=rtpmap:(\d+) opus\/48000\/2$/mi);
    if (!payloadMatch) {
      log('Munging skipped - opus payload not found');
      return sdp;
    }
    const pt = payloadMatch[1];
    let next = sdp.replace(new RegExp(`^a=rtpmap:${pt} opus/48000/2$`, 'mi'), `a=rtpmap:${pt} ${APP.currentLayoutConfig.sdp.rtpmap}`);
    const fmtpRegex = new RegExp(`^a=fmtp:${pt} .*?$`, 'mi');
    const multiopusFmtp = `a=fmtp:${pt} ${APP.currentLayoutConfig.sdp.fmtp}`;
    if (fmtpRegex.test(next)) next = next.replace(fmtpRegex, multiopusFmtp);
    else next = next.replace(new RegExp(`^a=rtpmap:${pt} ${APP.currentLayoutConfig.sdp.rtpmap.replace('/', '\/')}$`, 'mi'), `a=rtpmap:${pt} ${APP.currentLayoutConfig.sdp.rtpmap}\r\n${multiopusFmtp}`);
    APP.lastMungedSdp = next;
    setValue('sdpPreview', next);
    log('Local SDP munged', { layout: APP.currentLayout, payloadType: pt, rtpmap: APP.currentLayoutConfig.sdp.rtpmap, fmtp: APP.currentLayoutConfig.sdp.fmtp });
    return next;
  }

  function installMultiOpusMunging() {
    if (APP.patchInstalled) return;
    const NativePC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!NativePC) throw new Error('RTCPeerConnection not available');

    class PatchedRTCPeerConnection extends NativePC {
      constructor(...args) {
        super(...args);
        log('Patched RTCPeerConnection created', args[0] || {});
      }
      async createOffer(options) {
        const offer = await super.createOffer(options);
        log('createOffer original SDP snippet', offer.sdp ? offer.sdp.slice(0, 1200) : '');
        return offer;
      }
      async setLocalDescription(description) {
        if (description && description.type === 'offer' && description.sdp) {
          const munged = mungeOfferToMultiOpus(description.sdp);
          log('setLocalDescription using munged SDP snippet', munged.slice(0, 1400));
          return super.setLocalDescription({ type: description.type, sdp: munged });
        }
        return super.setLocalDescription(description);
      }
      async setRemoteDescription(description) {
        if (description && description.sdp) log('setRemoteDescription SDP snippet', description.sdp.slice(0, 1400));
        return super.setRemoteDescription(description);
      }
    }

    window.RTCPeerConnection = PatchedRTCPeerConnection;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = PatchedRTCPeerConnection;
    APP.patchInstalled = true;
    log('RTCPeerConnection patch installed');
  }

  async function createPublisher(streamName, token) {
    return new millicast.Publish(streamName, () => millicast.Director.getPublisher({ token, streamName }));
  }

  async function logSenderState() {
    try {
      const pc = APP.publisher?.getRTCPeerConnection?.();
      if (!pc) return;
      const senders = pc.getSenders ? pc.getSenders() : [];
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (!audioSender) { log('No audio sender found on PC'); return; }
      log('Audio sender state', {
        layout: APP.currentLayout,
        trackSettings: audioSender.track?.getSettings ? audioSender.track.getSettings() : null,
        parameters: audioSender.getParameters ? audioSender.getParameters() : null,
      });
    } catch (error) {
      log('Audio sender state read failed', String(error));
    }
  }

  async function startPublish() {
    if (APP.isPublishing) return;
    const parsed = parseStreamId(document.getElementById('streamIdInput')?.value || '');
    const token = (document.getElementById('tokenInput')?.value || '').trim();
    if (!parsed.streamAccountId || !parsed.streamName || !token) {
      setText('statusLine', 'Stream ID and publishing token are required.');
      return;
    }

    APP.streamName = parsed.streamName;
    APP.token = token;
    installMultiOpusMunging();

    setText('statusLine', `Building ${APP.currentLayout} surround bus and preparing MultiOpus SDP...`);
    setText('publishState', 'Connecting');
    document.getElementById('startBtn').disabled = true;

    try {
      const busStream = await buildBusStream();
      APP.publisher = await createPublisher(APP.streamName, APP.token);
      await APP.publisher.connect({ mediaStream: busStream });

      const sender = APP.publisher.getRTCPeerConnection?.().getSenders?.().find((candidate) => candidate.track?.kind === 'audio');
      if (sender?.getParameters && sender?.setParameters) {
        try {
          const params = sender.getParameters() || {};
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          params.encodings[0].maxBitrate = APP.currentLayout === '7.1' ? 512000 : 384000;
          params.encodings[0].priority = 'high';
          await sender.setParameters(params);
          log('Audio sender parameters applied', params);
        } catch (error) {
          log('setParameters failed', String(error));
        }
      }

      await logSenderState();

      APP.isPublishing = true;
      document.getElementById('stopBtn').disabled = false;
      setText('publishState', 'Publishing');
      setText('statusLine', `Single multichannel ${APP.currentLayout} publish started with offer munging.`);
      setText('viewerUrlState', 'Ready');
    } catch (error) {
      console.error(error);
      log('Start publish failed', error?.stack || String(error));
      setText('publishState', 'Error');
      setText('statusLine', `Start error: ${error?.message || error}`);
      await stopPublish();
      document.getElementById('startBtn').disabled = false;
    }
  }

  async function stopPublish() {
    for (const [key, entry] of [...APP.channelEntries.entries()]) {
      if (entry.raf) cancelAnimationFrame(entry.raf);
      try { entry.source?.disconnect?.(); } catch (_) {}
      try { entry.analyser?.disconnect?.(); } catch (_) {}
      try { entry.gainNode?.disconnect?.(); } catch (_) {}
      try { entry.filterNode?.disconnect?.(); } catch (_) {}
      entry.mediaStream?.getTracks?.().forEach((track) => track.stop());
      APP.channelEntries.delete(key);
      setText(`state-${key}`, 'Stopped');
      const meter = document.getElementById(`meterVertical-${key}`);
      if (meter) meter.style.height = '3%';
      setText(`level-${key}`, '0%');
      setText(`gainRead-${key}`, '1.00');
      const muteBtn = document.getElementById(`mute-${key}`);
      if (muteBtn) muteBtn.textContent = 'Mute';
    }

    try { APP.monitorGain?.disconnect?.(); } catch (_) {}
    try { await APP.publisher?.stop?.(); } catch (_) {}
    try { await APP.publisher?.disconnect?.(); } catch (_) {}

    APP.publisher = null;
    APP.busStream = null;
    APP.isPublishing = false;
    resetAudioGraph();

    setText('publishState', 'Stopped');
    setText('activeInputCount', `0 / ${APP.currentLayoutConfig.inputs.length}`);
    setText('statusLine', 'Publisher stopped');
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    log('Publisher stopped');
  }

  async function copyViewerLink() {
    const parsed = parseStreamId(document.getElementById('streamIdInput')?.value || '');
    if (!parsed.streamId) {
      setText('statusLine', 'Enter a stream ID first.');
      return;
    }
    const viewerUrl = getViewerUrl(parsed.streamId);
    await navigator.clipboard.writeText(viewerUrl);
    setText('viewerUrlState', 'Copied');
    setText('statusLine', 'Viewer link copied');
  }

  async function copyLogs() {
    await navigator.clipboard.writeText(APP.logs.join('\n\n'));
    setText('statusLine', 'Logs copied');
  }

  function bindGlobalUi() {
    document.getElementById('refreshDevicesBtn')?.addEventListener('click', async () => {
      await enumerateAudioInputs();
      setText('statusLine', 'Audio devices refreshed');
    });
    document.getElementById('resumeAudioBtn')?.addEventListener('click', async () => {
      ensureAudio();
      await APP.audioContext.resume();
      log('Audio context resumed', { state: APP.audioContext.state });
      setText('statusLine', 'Audio context resumed');
    });
    document.getElementById('startBtn')?.addEventListener('click', startPublish);
    document.getElementById('stopBtn')?.addEventListener('click', stopPublish);
    document.getElementById('copyViewerBtn')?.addEventListener('click', copyViewerLink);
    document.getElementById('copyLogsBtn')?.addEventListener('click', copyLogs);
    document.getElementById('masterGainInput')?.addEventListener('input', (event) => {
      ensureAudio();
      APP.monitorGain.gain.value = Number(event.target.value || 1);
      log('Master monitor gain updated', APP.monitorGain.gain.value);
    });
    ['spatialAmountInput','spatialFloorInput','spatialPowerInput'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => updateSpatialGain());
    });
    document.getElementById('layoutSelect')?.addEventListener('change', async (event) => {
      if (APP.isPublishing) {
        event.target.value = APP.currentLayout;
        setText('statusLine', 'Stop publishing before changing layout.');
        return;
      }
      APP.currentLayout = event.target.value;
      APP.currentLayoutConfig = LAYOUTS[APP.currentLayout];
      renderMap();
      renderChannels();
      renderSpatialLegend();
      APP.currentLayoutConfig.inputs.forEach(bindChannelControls);
      updateSpatialGain();
      await enumerateAudioInputs();
      setText('statusLine', `Layout changed to ${APP.currentLayout}`);
      log('Layout changed', APP.currentLayout);
    });
    navigator.mediaDevices?.addEventListener?.('devicechange', () => {
      enumerateAudioInputs().catch((error) => log('Device refresh failed', String(error)));
    });
    window.addEventListener('beforeunload', () => { stopPublish().catch(() => {}); });
  }

  function initializePage() {
    APP.currentLayout = document.getElementById('layoutSelect')?.value || '5.1';
    APP.currentLayoutConfig = LAYOUTS[APP.currentLayout];
    renderMap();
    renderChannels();
    renderSpatialLegend();
    bindGlobalUi();
    initSpatialPuck();
    APP.currentLayoutConfig.inputs.forEach(bindChannelControls);
    enumerateAudioInputs().catch((error) => {
      log('Initial device enumerate failed', String(error));
      setText('statusLine', `Device list warning: ${error?.message || error}`);
    });

    const params = new URL(window.location.href).searchParams;
    const streamId = params.get('streamId') || '';
    const token = params.get('token') || params.get('publishToken') || '';
    const layout = params.get('layout') || '';
    if (streamId) document.getElementById('streamIdInput').value = streamId;
    if (token) document.getElementById('tokenInput').value = token;
    if (layout && LAYOUTS[layout]) {
      document.getElementById('layoutSelect').value = layout;
      APP.currentLayout = layout;
      APP.currentLayoutConfig = LAYOUTS[layout];
      renderMap();
      renderChannels();
      renderSpatialLegend();
      APP.currentLayoutConfig.inputs.forEach(bindChannelControls);
      updateSpatialGain();
      enumerateAudioInputs().catch(() => {});
    }

    log('Configurable DAW build loaded', { layout: APP.currentLayout });
  }

  function getSpeakerPosition(channel) {
    const positions51 = {
      'Front Left': { x: -0.85, y: -0.55 },
      'Front Right': { x: 0.85, y: -0.55 },
      'Front Center': { x: 0, y: -0.78 },
      'Rear Left': { x: -0.85, y: 0.62 },
      'Rear Right': { x: 0.85, y: 0.62 },
      'LFE': { x: 0, y: 0.82 },
      'Left Middle': { x: -0.55, y: 0.12 },
      'Right Middle': { x: 0.55, y: 0.12 },
    };
    return positions51[channel.role] || { x: 0, y: 0 };
  }

  function renderSpatialLegend() {
    const legend = document.getElementById('spatialLegend');
    if (!legend) return;
    legend.style.gridTemplateColumns = `repeat(${Math.min(APP.currentLayoutConfig.inputs.length, 4)}, minmax(0,1fr))`;
    legend.innerHTML = APP.currentLayoutConfig.inputs.map((channel) => {
      const pos = getSpeakerPosition(channel);
      channel.spatialX = pos.x;
      channel.spatialY = pos.y;
      return `<div class="map-pill"><strong>${channel.label}</strong><br>${channel.role}<br><span id="spatialGain-${channel.key}" class="tiny">1.00x spatial</span></div>`;
    }).join('');
  }

  function updateSpatialGain() {
    APP.currentLayoutConfig.inputs.forEach((channel) => applyEffectiveGain(channel.key));
    setText('spatialXState', APP.spatial.x.toFixed(2));
    setText('spatialYState', APP.spatial.y.toFixed(2));
    const mode = Math.abs(APP.spatial.x) < 0.02 && Math.abs(APP.spatial.y) < 0.02 ? 'Centered' : 'Offset';
    setText('spatialModeState', mode);
  }

  function initSpatialPuck() {
    const canvas = document.getElementById('spatialCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const setFromPointer = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      APP.spatial.x = Math.max(-1, Math.min(1, (x - 0.5) * 2));
      APP.spatial.y = Math.max(-1, Math.min(1, (y - 0.5) * 2));
      updateSpatialGain();
      draw();
    };

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.strokeStyle = 'rgba(139,155,200,.22)';
      ctx.lineWidth = 1;
      for (let ring = 1; ring <= 3; ring++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, (w * 0.38 * ring) / 3, (h * 0.34 * ring) / 3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx, h * 0.08);
      ctx.lineTo(cx, h * 0.92);
      ctx.moveTo(w * 0.08, cy);
      ctx.lineTo(w * 0.92, cy);
      ctx.stroke();
      ctx.restore();

      APP.currentLayoutConfig.inputs.forEach((channel) => {
        const pos = getSpeakerPosition(channel);
        channel.spatialX = pos.x;
        channel.spatialY = pos.y;
        const sx = cx + pos.x * (w * 0.38);
        const sy = cy + pos.y * (h * 0.34);
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(123,141,255,.9)';
        ctx.fill();
        ctx.fillStyle = '#edf2ff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(channel.label.replace('Input ', 'In '), sx, sy - 16);
      });

      const px = cx + APP.spatial.x * (w * 0.38);
      const py = cy + APP.spatial.y * (h * 0.34);
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.fillStyle = '#57f0c7';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.stroke();
    };

    canvas.addEventListener('mousedown', (event) => {
      APP.spatial.dragging = true;
      setFromPointer(event);
    });
    canvas.addEventListener('mousemove', (event) => {
      if (!APP.spatial.dragging) return;
      setFromPointer(event);
    });
    window.addEventListener('mouseup', () => { APP.spatial.dragging = false; });
    canvas.addEventListener('mouseleave', () => { APP.spatial.dragging = false; });
    canvas.addEventListener('dblclick', () => {
      APP.spatial.x = 0;
      APP.spatial.y = 0;
      updateSpatialGain();
      draw();
    });

    updateSpatialGain();
    draw();
    window.addEventListener('resize', draw);
  }

  window.SurroundPublisherMultiOpusDebugDAWConfigurable = { initializePage, stopPublish };
  window.addEventListener('load', initializePage);
})();
