(() => {
  if (window.__paaudioHooked) return;
  window.__paaudioHooked = true;
  let video = null, ctx = null, src = null, analyser = null, gain = null;
  let eqNodes = [], hooked = false, spec = null, wave = null;

  function init(){
    if (hooked) return;
    const v = document.querySelector('video');
    if (!v) return;
    video = v;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      src = ctx.createMediaElementSource(video);
      eqNodes = [50,80,125,200,315,500,800,1250,2000,3150,5000,8000,12500].map(f=>{
        const bq = ctx.createBiquadFilter();
        bq.type = 'peaking'; bq.frequency.value = f; bq.Q.value = 1.1; bq.gain.value = 0;
        return bq;
      });
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;
      gain = ctx.createGain(); gain.gain.value = 1;
      let node = src;
      eqNodes.forEach(bq => { node.connect(bq); node = bq; });
      node.connect(gain);
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      spec = new Uint8Array(analyser.frequencyBinCount);
      wave = new Uint8Array(analyser.fftSize);
      hooked = true;
    } catch(e) { console.warn('[PAAUDIO] init failed', e); }
  }

  function pump(){
    requestAnimationFrame(pump);
    if (!hooked) return;
    const playing = video && !video.paused && video.readyState >= 2;
    if (playing) {
      analyser.getByteFrequencyData(spec);
      analyser.getByteTimeDomainData(wave);
    }
    window.postMessage({
      __paaudio: true, type: 'audio',
      spec: playing ? spec : null,
      wave: playing ? wave : null,
      time: video ? video.currentTime : 0,
      dur: video ? (video.duration || 0) : 0,
      paused: video ? video.paused : true
    }, '*');
  }

  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || !e.data.__paaudio) return;
    if (e.data.type !== 'cmd') return;
    const { action, value } = e.data;
    if (action === 'play') {
      if (video) video.play();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    }
    else if (action === 'pause') { if (video) video.pause(); }
    else if (action === 'toggle') {
      if (!video) return;
      if (video.paused) { video.play(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
      else video.pause();
    }
    else if (action === 'next') { const b = document.querySelector('.next-button'); if (b) b.click(); }
    else if (action === 'prev') { const b = document.querySelector('.previous-button'); if (b) b.click(); }
    else if (action === 'seek') { if (video) video.currentTime = value; }
    else if (action === 'volume') { if (video) video.volume = Math.max(0, Math.min(1, value)); }
    else if (action === 'eq' && eqNodes.length) {
      const arr = value || [];
      for (let i = 0; i < 13; i++) eqNodes[i].gain.value = arr[i] || 0;
    }
  });

  document.addEventListener('click', () => {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }, true);

  setInterval(init, 1500);
  init();
  pump();
})();