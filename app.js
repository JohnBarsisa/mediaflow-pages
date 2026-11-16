(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const API_BASE = String(window.MEDIAFLOW_API_BASE || '').replace(/\/$/, '');
  const guestMode = Boolean(window.MEDIAFLOW_GUEST_MODE);
  const localMode = Boolean(window.MEDIAFLOW_IS_LOCAL);
  const accessModeInfo = document.getElementById('mf-access-mode-info');
  if (accessModeInfo && localMode) {
    accessModeInfo.textContent = window.location.hostname.endsWith('.ts.net')
      ? 'Personal Mode on your private Tailscale connection. Media requests are processed by your Windows PC using only an authorised desktop browser session; account cookies never reach Render.'
      : 'Local backend detected. Start start_personal_backend.bat on this PC to use your own signed-in Opera (or another supported browser). No login data goes to Render.';
  }
  // Only a private Tailscale address is remembered, never account cookies or passwords.
  const personalDialog = $('mf-personal-dialog');
  const privateAddressInput = $('mf-private-address');
  const privateAddressError = $('mf-private-address-error');
  function openPersonalDialog() {
    try { privateAddressInput.value = localStorage.getItem('mf_private_pc_url') || ''; } catch {}
    privateAddressError.textContent = '';
    if (personalDialog.showModal) personalDialog.showModal();
    else personalDialog.setAttribute('open', '');
  }
  function parsePrivatePcUrl(raw) {
    let parsed;
    try { parsed = new URL(raw.trim()); } catch { return null; }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !host.endsWith('.ts.net') || host.length <= '.ts.net'.length ||
        parsed.port || parsed.username || parsed.password || raw.length > 300) return null;
    return parsed.origin + '/personal/';
  }
  document.querySelectorAll('[data-open-personal]').forEach(button => button.addEventListener('click', openPersonalDialog));
  $('mf-personal-close').addEventListener('click', () => personalDialog.close());
  $('mf-open-private').addEventListener('click', () => {
    const url = parsePrivatePcUrl(privateAddressInput.value);
    if (!url) {
      privateAddressError.textContent = 'Enter your private https://...ts.net PC address from tailscale serve status. Public URLs cannot be used here.';
      privateAddressInput.focus();
      return;
    }
    privateAddressError.textContent = '';
    try { localStorage.setItem('mf_private_pc_url', new URL(url).origin); } catch {}
    window.location.assign(url);
  });
  // This randomly generated browser identifier is only for partitioning guest jobs.
  // It is never put in a URL or shared with other sites.
  const guestKey = 'mediaflow_guest_v1';
  let guestToken = '';
  if (guestMode && window.crypto?.getRandomValues) {
    try { guestToken = sessionStorage.getItem(guestKey) || ''; } catch {}
    if (!/^[a-f0-9]{64}$/.test(guestToken)) {
      guestToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
      try { sessionStorage.setItem(guestKey, guestToken); } catch {}
    }
  }

  const state = { inspectedUrl: null, media: null, mode: 'video', jobs: [], view: 'download', toastTimer: null, polling: false, analyzing: false, lastInteraction: Date.now(), lastPoll: 0 };
  ['click', 'input', 'submit', 'touchstart'].forEach(type =>
    document.addEventListener(type, () => { state.lastInteraction=Date.now(); }, { passive:true })
  );
  const cached = { recent: new Map(), all: new Map() };
  const themes = {wave:'Wave',aurora:'Aurora',violet:'Violet',lagoon:'Lagoon',coral:'Coral',sage:'Sage',sunset:'Sunset',graphite:'Graphite'};
  const hosts = [
    ['youtube.com','YouTube'],['youtu.be','YouTube'],['instagram.com','Instagram'],['tiktok.com','TikTok'],
    ['twitter.com','X / Twitter'],['x.com','X / Twitter'],['facebook.com','Facebook'],['fb.watch','Facebook'],
    ['soundcloud.com','SoundCloud'],['vimeo.com','Vimeo'],['dailymotion.com','Dailymotion'],['dai.ly','Dailymotion'],
    ['reddit.com','Reddit'],['redd.it','Reddit'],['v.redd.it','Reddit'],['twitch.tv','Twitch'],['bandcamp.com','Bandcamp'],
  ];
  const sampleUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
  const sourceHelp = {
    YouTube: {
      message: 'For your own uploads, use YouTube Studio → Content → Download. For other videos, use YouTube’s offline option where available, or ask the creator for the original file.',
      label: 'Open YouTube Studio ↗',
      href: 'https://studio.youtube.com/',
    },
    'X / Twitter': {
      message: 'Open the post in X and look for Download video in the video’s menu. It’s available on eligible plans when the post allows it. Otherwise, ask the creator for the file.',
      label: 'X download instructions ↗',
      href: 'https://help.x.com/en/using-x/x-videos#video-downloads-posts',
    },
    Instagram: {
      message: 'For an eligible public Reel, open it in the Instagram app and tap Share → Download. To export your own posts, use Download Your Information in Accounts Center.',
      label: 'Instagram export instructions ↗',
      href: 'https://help.instagram.com/181231772500920',
    },
  };
  const directMediaRoots = new Map([
    ['upload.wikimedia.org', '/wikipedia/commons/'],
    ['interactive-examples.mdn.mozilla.net', '/media/cc0-videos/'],
    ['developer.mozilla.org', '/shared-assets/videos/'],
  ]);
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const motion = reduceMotion ? 'auto' : 'smooth';
  function detectPlatform(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
      const host = u.hostname.toLowerCase();
      const prefix = directMediaRoots.get(host);
      if (prefix && !u.search && !u.hash && u.pathname.startsWith(prefix)
          && /\.(mp4|webm|mp3|m4a|ogg|oga|opus|wav)$/i.test(u.pathname)) return 'Direct media file';
      return hosts.find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1] || null;
    } catch { return null; }
  }
  function loadSample() {
    const target = $('media-url');
    target.value = sampleUrl;
    target.dispatchEvent(new Event('input', {bubbles: true}));
    if (state.analyzing) pendingPaste = sampleUrl;
    else $('inspect-form').requestSubmit();
  }
  $('try-sample').addEventListener('click', loadSample);
  $('try-sample-fallback').addEventListener('click', loadSample);
  function formatDuration(s) {
    if (s == null) return '';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  }
  function formatSpeed(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '';
    return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB/s` : `${(n / 1024).toFixed(0)} KB/s`;
  }
  function toast(message, ms = 5000) {
    $('toast-text').textContent = message;
    $('toast').hidden = false;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { $('toast').hidden = true; }, ms);
  }
  $('toast-close').addEventListener('click', () => { $('toast').hidden = true; });
  async function api(url, opts = {}) {
    let response;
    if (guestMode && !guestToken) throw new Error('Open MediaFlow over HTTPS to start a guest download.');
    try { response = await fetch(API_BASE + url, { ...opts, cache: 'no-store', headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(guestToken ? { 'X-MediaFlow-Guest': guestToken } : {}),
      ...(opts.headers || {})
    } }); }
    catch { throw new Error('Cannot connect to MediaFlow right now. Please try again.'); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = result.detail;
      const error = new Error(typeof detail === 'string' ? detail :
        (detail?.message || `Request failed (${response.status})`));
      error.code = detail?.code;
      throw error;
    }
    return result;
  }
  function busy(button, yes, label) {
    if (yes) {
      if (button.dataset.busy === 'true') return;
      button.dataset.before = button.innerHTML;
      button.dataset.busy = 'true';
      button.disabled = true;
      button.innerHTML = `<span class="loading-spinner" style="width:16px;height:16px;border-width:2px;border-top-color:white"></span> ${label}`;
    } else {
      if (button.dataset.busy === 'true') {
        button.innerHTML = button.dataset.before;
        delete button.dataset.before;
        delete button.dataset.busy;
      }
      button.disabled = false;
    }
  }
  // The entire interface is derived from these two attributes, not an icon-only recolour.
  function syncAppearance() {
    const mode = root.dataset.mode === 'dark' ? 'dark' : 'light';
    const palette = Object.hasOwn(themes, root.dataset.palette) ? root.dataset.palette : 'wave';
    root.dataset.mode = mode; root.dataset.palette = palette;
    $('current-palette').textContent = themes[palette];
    $('side-palette-name').textContent = themes[palette];
    document.querySelectorAll('[data-set-mode]').forEach(el => {
      const selected = el.dataset.setMode === mode;
      el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('[data-set-palette]').forEach(el => {
      const selected = el.dataset.setPalette === palette;
      el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', String(selected));
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      // Solid palette-tinted shell colours for mobile browser chrome.
      const light = {wave:'#e5e9f5',aurora:'#e3eff0',violet:'#ebe5f5',lagoon:'#e1edf4',coral:'#f2e6e9',sage:'#e6eee8',sunset:'#f2e9e3',graphite:'#e6eaf0'};
      const dark = {wave:'#1b2034',aurora:'#182b32',violet:'#242036',lagoon:'#182c39',coral:'#2e232f',sage:'#1d2b29',sunset:'#2e282c',graphite:'#222a34'};
      meta.setAttribute('content', (mode === 'light' ? light : dark)[palette]);
    }
  }
  function updateAppearance(attr, value) {
    if (attr === 'palette' && !Object.hasOwn(themes,value)) return;
    if (attr === 'mode' && !['light','dark'].includes(value)) return;
    if (root.dataset[attr] === value) return;
    const apply = () => {
      root.dataset[attr] = value;
      try { localStorage.setItem(`mediaflow_${attr}`,value); } catch {}
      syncAppearance();
    };
    // Graceful enhancement; all controls work without view transitions.
    if (!reduceMotion && document.startViewTransition) document.startViewTransition(apply);
    else apply();
  }
  syncAppearance();
  document.querySelectorAll('[data-set-mode]').forEach(btn => btn.addEventListener('click', () => updateAppearance('mode',btn.dataset.setMode)));
  document.querySelectorAll('[data-set-palette]').forEach(btn => btn.addEventListener('click', () => updateAppearance('palette',btn.dataset.setPalette)));
  function closeAppearance() { $('appearance-popover').hidden = true; $('appearance-trigger').setAttribute('aria-expanded','false'); }
  $('appearance-trigger').addEventListener('click', () => {
    const open = !$('appearance-popover').hidden;
    $('appearance-popover').hidden = open;
    $('appearance-trigger').setAttribute('aria-expanded',String(!open));
  });
  $('appearance-close').addEventListener('click', closeAppearance);
  document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.appearance-anchor')) closeAppearance(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAppearance(); });
  function setView(view) {
    state.view = view;
    $('download-view').hidden = view !== 'download'; $('activity-view').hidden = view !== 'activity';
    document.querySelectorAll('.nav-link').forEach(btn => {
      const active = btn.dataset.view === view;
      btn.classList.toggle('active',active);
      if (active) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
    });
    closeAppearance(); window.scrollTo({top:0,behavior:motion});
  }
  document.querySelectorAll('.nav-link').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  $('see-all').addEventListener('click', () => setView('activity'));
  $('new-download').addEventListener('click', () => {setView('download'); $('media-url').focus();});
  $('year').textContent = String(new Date().getFullYear());
  const mobileClipboard = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  $('paste-btn').addEventListener('click', async () => {
    const target = $('media-url');
    const hint = $('paste-help');
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard API unavailable');
      const content = await navigator.clipboard.readText();
      if (!content?.trim()) throw new Error('Clipboard is empty');
      target.value = content.trim();
      target.dispatchEvent(new Event('input', { bubbles:true }));
      if (detectPlatform(target.value)) schedulePaste();
      hint.hidden = true;
      target.focus();
    } catch {
      // In-app iOS browsers often deny clipboard.readText(). Browsers do not
      // permit scripted pasting without permission. Native long-press remains safe.
      hint.textContent = mobileClipboard
        ? 'Clipboard access is limited here. Copy your link in the social app, tap and hold the URL field, then choose Paste. You can also open MediaFlow in Safari.'
        : 'Clipboard access is blocked. Click the URL field and use Ctrl+V (or Cmd+V on Mac).';
      hint.hidden = false;
      target.focus();
    }
  });
  let pasteTimer;
  function schedulePaste() {
    clearTimeout(pasteTimer);
    // Let native paste update the value first. Typing alone never starts a request.
    pasteTimer = setTimeout(() => {
      if (detectPlatform($('media-url').value.trim())) {
        if (state.analyzing) pendingPaste = $('media-url').value.trim();
        else $('inspect-form').requestSubmit();
      }
    }, 250);
  }
  let pendingPaste = null;
  $('media-url').addEventListener('paste', schedulePaste);
  $('media-url').addEventListener('input', () => {
    if (state.analyzing) inspectionId++;
    pendingPaste = null;
    if ($('media-url').value.trim()) $('paste-help').hidden = true;
    $('mf-media-error').hidden = true;
    const name = detectPlatform($('media-url').value.trim());
    const label = $('detected-platform'); label.replaceChildren();
    const dot = document.createElement('span'); dot.className = name ? 'green-dot' : 'status-dot';
    label.append(dot, document.createTextNode(name ? `${name} link detected` : 'Ready when you are'));
    if (state.inspectedUrl && $('media-url').value.trim() !== state.inspectedUrl) resetPreview();
  });
  function resetPreview() { state.inspectedUrl = null;state.media = null;$('result-panel').hidden = true;$('mf-media-error').hidden=true;$('permission').checked = false;updateDownloadButton(); }
  $('reset-btn').addEventListener('click', () => {resetPreview();$('media-url').focus();});
  let inspectionId = 0;
  $('inspect-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    clearTimeout(pasteTimer);
    if (state.analyzing) return;
    const url = $('media-url').value.trim();
    if (url === state.inspectedUrl) return;
    if (!url || !detectPlatform(url)) {toast('Use a public HTTPS link from one of the supported platforms.');return;}
    resetPreview();const turn = ++inspectionId;
    state.analyzing = true;busy($('inspect-btn'),true,'Finding formats…');$('inspect-loading').hidden = false;
    try {
      const media = await api('/api/inspect',{method:'POST',body:JSON.stringify({url})});
      if (turn !== inspectionId || $('media-url').value.trim() !== url) return;
      state.media=media;state.inspectedUrl=url;showPreview(media);
    } catch(err) {
      if (turn !== inspectionId || $('media-url').value.trim() !== url) return;
      const message = String(err.message || 'Unable to check this link.');
      const blocked = err.code === 'cloud_unavailable'
        || /bot verification|didn’t allow MediaFlow|HTTP 403|returned no media data|requires account sign-in|this media is private|uses DRM protection|no media streams|platform may have changed or blocked/i.test(message);
      const platform = detectPlatform(url);
      const help = blocked && Object.hasOwn(sourceHelp, platform) ? sourceHelp[platform] : null;
      $('mf-media-error-title').textContent = help ? `${platform} download unavailable in MediaFlow`
        : blocked ? 'Not available for download here' : 'Couldn’t load formats';
      $('mf-media-error-message').textContent = help?.message || message;
      const original = $('mf-open-source');
      original.href = url;
      original.hidden = !blocked;
      const official = $('mf-source-help');
      official.hidden = !help;
      if (help) {
        official.href = help.href;
        official.textContent = help.label;
      } else {
        official.removeAttribute('href');
        official.textContent = '';
      }
      $('try-sample-fallback').hidden = !blocked;
      $('mf-media-error').hidden = false;
    }
    finally {
      state.analyzing=false;busy($('inspect-btn'),false);$('inspect-loading').hidden=true;
      if (pendingPaste && pendingPaste === $('media-url').value.trim()) {
        pendingPaste = null;
        $('inspect-form').requestSubmit();
      }
    }
  });
  function streamLabel(item,kind) {
    const parts=[];
    if (kind==='video') {parts.push(item.height?`${item.height}p`:'Video');if(item.fps) parts.push(`${item.fps}fps`);} else parts.push('Audio');
    parts.push((item.ext||'source').toUpperCase());
    if (item.codec && item.codec!=='none') parts.push(item.codec.split('.')[0]);
    if (item.kbps) parts.push(`~${item.kbps}kbps`);
    if (item.bytes) parts.push(`~${(item.bytes/1048576).toFixed(1)}MB`);
    if (kind==='video' && !item.has_audio) parts.push('audio merged');
    return parts.join(' · ');
  }
  function showPreview(media) {
    $('media-platform').textContent=media.platform;$('media-title').textContent=media.title;$('media-creator').textContent=media.creator;
    $('media-thumbnail').hidden=!media.thumbnail;$('thumbnail-fallback').hidden=Boolean(media.thumbnail);
    if(media.thumbnail) $('media-thumbnail').src=media.thumbnail;else $('media-thumbnail').removeAttribute('src');
    $('media-duration').hidden=media.duration == null;$('media-duration').textContent=formatDuration(media.duration);
    const qualities=$('video-quality');qualities.replaceChildren(new Option('Best available','best'));
    for(const size of media.qualities||[]) if(size>=144&&size<=8640) qualities.add(new Option(`${size}p maximum`,String(size)));
    const vf=media.formats?.video||[],af=media.formats?.audio||[];
    $('video-source').replaceChildren(new Option('Auto · Based on chosen resolution','auto'));
    for(const stream of vf) $('video-source').add(new Option(streamLabel(stream,'video'),stream.id));
    $('audio-source').replaceChildren(new Option('Auto · Best available audio','auto'));
    for(const stream of af) $('audio-source').add(new Option(streamLabel(stream,'audio'),stream.id));
    $('video-source').disabled=!vf.length;$('audio-source').disabled=!af.length;
    const direct = Boolean(media.direct_format);
    $('format-choices').hidden = direct;
    $('stream-count').textContent=direct ? `· ${media.direct_format} · ${formatSpeed(media.bytes).replace('/s', '')}`
      : `· ${vf.length} video / ${af.length} audio streams`;
    $('result-panel').hidden=false;chooseMode(media.has_video?'video':'audio');
    $('download-btn').querySelector('.button-label').textContent=direct ? `Download original ${media.direct_format}` : 'Start download';
    $('result-panel').scrollIntoView({behavior:motion,block:'start'});
  }
  function chooseMode(mode) {
    if (state.media && ((mode==='video'&&!state.media.has_video)||(mode==='audio'&&!state.media.has_audio))) return;
    state.mode=mode;
    document.querySelectorAll('.mode-option').forEach(el => {
      const selected = el.dataset.mode === mode;
      el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));
      el.disabled=Boolean(state.media&&((el.dataset.mode==='video'&&!state.media.has_video)||(el.dataset.mode==='audio'&&!state.media.has_audio)));
    });
    $('video-options').hidden=mode!=='video';$('audio-options').hidden=mode!=='audio';updateNotice();updateDownloadButton();
  }
  document.querySelectorAll('.mode-option').forEach(btn=>btn.addEventListener('click',()=>chooseMode(btn.dataset.mode)));
  function updateNotice() {
    const lossless=state.mode==='audio'&&['wav','flac'].includes($('audio-format').value);
    $('audio-bitrate').disabled=lossless;$('video-quality').disabled=$('video-source').value!=='auto';
    if(lossless) $('quality-notice').textContent='WAV and FLAC create lossless output, but cannot restore details missing from the source. Audio bitrate settings do not apply.';
    else if(state.mode==='audio') $('quality-notice').textContent='Choose a source audio track or let MediaFlow use the best available. The selected bitrate is an encoding target, not an improvement to the source quality.';
    else $('quality-notice').textContent=$('video-source').value!=='auto'
      ? 'You chose an exact source stream. MediaFlow merges audio if required, then remuxes or converts to your selected format.'
      : 'Auto picks the best available stream at or below your chosen resolution. Some conversions need extra processing time.';
  }
  ['audio-format','audio-bitrate','video-source','video-format','video-quality','audio-source'].forEach(id=>$(id).addEventListener('change',updateNotice));
  $('permission').addEventListener('change',updateDownloadButton);
  function updateDownloadButton() {
    if($('download-btn').dataset.busy==='true') return;
    $('download-btn').disabled=!state.inspectedUrl||!$('permission').checked||Boolean(state.media&&((state.mode==='video'&&!state.media.has_video)||(state.mode==='audio'&&!state.media.has_audio)));
  }
  $('download-btn').addEventListener('click',async()=>{
    if(!state.inspectedUrl||!$('permission').checked) return;
    const button=$('download-btn');busy(button,true,'Adding to queue…');
    try {
      const payload={url:state.inspectedUrl,inspect_id:state.media.inspect_id,authorized:true,mode:state.mode,video_quality:$('video-quality').value,video_format:$('video-format').value,video_source_id:$('video-source').value,audio_source_id:$('audio-source').value,audio_format:$('audio-format').value,audio_bitrate:Number($('audio-bitrate').value)};
      const job = await api('/api/jobs',{method:'POST',body:JSON.stringify(payload)});
      state.jobs = [job,...state.jobs.filter(item=>item.id!==job.id)];
      renderJobs();
      try { sessionStorage.setItem('mediaflow_has_jobs', '1'); } catch {}
      toast('Download queued! Follow its live progress below.');await refreshJobs();
      $('recent-heading').scrollIntoView({behavior:motion,block:'center'});
    } catch(err) {toast(err.message,6500);}
    finally {busy(button,false);updateDownloadButton();}
  });
  const stages={queued:'Waiting for a worker',downloading:'Downloading source',processing:'Merging / converting',done:'File is ready',error:'Download failed',canceled:'Canceled'};
  const statusNames={queued:'Queued',downloading:'Downloading',processing:'Processing',done:'Ready',error:'Failed',canceled:'Canceled'};
  function makeJobNode(job) {
    const node=document.createElement('article'); node.className='job-item';node.dataset.jobId=job.id;
    node.innerHTML=`<div class="job-icon" aria-hidden="true"></div><div class="job-information"><div class="job-title"></div><div class="job-meta"></div><div class="job-metrics"></div><div class="job-progress-block"><div class="job-progress" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><div class="job-statusline"><span class="job-stage"></span><strong class="job-percent"></strong></div></div><div class="job-error"></div><div class="job-warning" hidden></div></div><div class="job-action-holder"></div>`;
    return node;
  }
  function updateJobNode(node,job) {
    const active=['queued','downloading','processing'].includes(job.status);
    node.dataset.status=job.status;
    node.querySelector('.job-icon').textContent=job.status==='done'?'✓':job.mode==='audio'?'♫':'▶';
    node.querySelector('.job-title').textContent=job.title||'Preparing download';
    node.querySelector('.job-title').title=job.title||'';
    node.querySelector('.job-meta').textContent=`${job.site||'Media'} · ${job.requested||job.mode} · ${statusNames[job.status]||job.status}`;
    const metrics=node.querySelector('.job-metrics');
    const speed=formatSpeed(job.speed),eta=typeof job.eta==='number' && job.eta>=0 ? formatDuration(job.eta):'';
    metrics.textContent=active && (speed||eta) ? [speed?`${speed}`:'',eta?`~${eta} remaining`:''].filter(Boolean).join('  ·  ') : '';
    metrics.hidden=!metrics.textContent;
    const error=node.querySelector('.job-error');error.textContent=job.error||'';error.hidden=!job.error;
    const warning=node.querySelector('.job-warning');warning.textContent=job.warning||'';warning.hidden=!job.warning;
    const block=node.querySelector('.job-progress-block');block.hidden=!active;
    const bar=node.querySelector('.job-progress');
    const pct=Math.min(100,Math.max(0,Number(job.progress)||0));
    bar.setAttribute('aria-valuenow',String(Math.round(pct)));
    bar.querySelector('span').style.width=`${pct}%`;
    const liveStage=job.stage || stages[job.status] || job.status;
    const processingSeconds=Number(job.processing_seconds);
    const elapsed=job.status==='processing' && Number.isFinite(processingSeconds) && processingSeconds>=0
      ? ` · ${formatDuration(processingSeconds)} processing` : '';
    node.querySelector('.job-stage').textContent=liveStage+elapsed;
    node.querySelector('.job-percent').textContent=`${Math.round(pct)}%`;
    const holder=node.querySelector('.job-action-holder');
    let action=holder.firstElementChild;
    if(job.status==='done' && typeof job.download_url==='string' && /^\/api\/jobs\/[a-z0-9-]+\/file(?:\?ticket=[0-9]+\.[a-f0-9]{64})?$/.test(job.download_url)) {
      if(!action || action.tagName!=='A') {holder.replaceChildren();action=document.createElement('a');action.className='job-action';holder.append(action);}
      action.href=API_BASE + job.download_url;
      const ext=typeof job.file_extension==='string' && /^\.[a-z0-9]{1,5}$/.test(job.file_extension) ? job.file_extension.toUpperCase() : '';
      action.textContent=ext ? `Save ${ext} ↓` : 'Save file ↓';
      action.setAttribute('download','');action.referrerPolicy='no-referrer';action.setAttribute('aria-label',`Save ${job.title||'media'} ${ext}`);
    } else if(active) {
      if(!action||action.tagName!=='BUTTON') {holder.replaceChildren();action=document.createElement('button');action.type='button';action.className='job-action cancel';holder.append(action);}
      action.dataset.cancel=job.id;action.textContent='Cancel';
    } else if(localMode && job.status === 'error' && /account|sign-in|instagram|cloud server|private|login|cookies/i.test(job.error || '')) {
      if (!action || action.tagName !== 'BUTTON' || !action.hasAttribute('data-open-personal-job')) {
        holder.replaceChildren();
        action=document.createElement('button');action.type='button';action.className='job-action personal';action.setAttribute('data-open-personal-job','');holder.append(action);
      }
      action.textContent='Try Personal Mode ↗';
    } else {holder.replaceChildren();}
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-personal-job]')) openPersonalDialog();
  });
  function syncJobs(container,collection,map) {
    if(!collection.length) {
      map.clear();container.innerHTML='<div class="empty-state"><span class="empty-icon">↓</span><b>Nothing downloading yet</b><p>Paste a link to create your first download.</p></div>';
      return;
    }
    const set=new Set(collection.map(j=>j.id));
    for(const [id,element] of map) if(!set.has(id)) {element.remove();map.delete(id);}
    const nodes=[];
    for(const job of collection) {
      let el=map.get(job.id);
      if(!el) {el=makeJobNode(job);map.set(job.id,el);}
      updateJobNode(el,job);nodes.push(el);
    }
    // Insert into the correct position without recreating existing nodes: real progress easing.
    nodes.forEach((el,index)=>{if(container.children[index]!==el) container.insertBefore(el,container.children[index]||null);});
    while(container.children.length>nodes.length) container.lastElementChild.remove();
  }
  function renderJobs() {
    syncJobs($('recent-jobs'),state.jobs.slice(0,3),cached.recent);
    syncJobs($('all-jobs'),state.jobs,cached.all);
    $('activity-count').hidden=state.jobs.length===0;$('activity-count').textContent=String(state.jobs.length);
  }
  async function refreshJobs() {
    if(state.polling)return;state.polling=true;
    try {
      const current=await api('/api/jobs');
      // Render Free may restart if processing exhausts memory. Keep a visible
      // explanation for jobs lost on restart, instead of silently erasing them.
      const ids=new Set(current.map(job=>job.id));
      const lost=state.jobs.filter(job=>
        ['queued','downloading','processing'].includes(job.status) && !ids.has(job.id)
      ).map(job=>({...job,status:'error',error:'The processing server restarted and interrupted this download. Retry a compatible MP4/H.264 stream or Original format.',progress:job.progress||0}));
      const previousErrors=state.jobs.filter(job=>job.error && job.status==='error' && !ids.has(job.id));
      const byId=new Map([...current,...previousErrors,...lost].map(job=>[job.id,job]));
      state.jobs=Array.from(byId.values());
      renderJobs();
    }
    catch { /* Preserve existing job state if server is unreachable. */ }
    finally {state.polling=false;}
  }
  document.addEventListener('click',async(event)=>{
    const button=event.target.closest('[data-cancel]');if(!button)return;
    button.disabled=true;
    try {await api(`/api/jobs/${encodeURIComponent(button.dataset.cancel)}/cancel`,{method:'POST'});await refreshJobs();toast('Download canceled.');}
    catch(err) {toast(err.message);button.disabled=false;}
  });
  renderJobs();
  if (!guestMode || sessionStorageSafe('mediaflow_has_jobs')) refreshJobs();
  function sessionStorageSafe(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
  // Render Free: prevent idle browser tabs from continuously waking the server.
  // Active download jobs receive frequent progress updates; idle pages stop
  // polling after three minutes until the user interacts with MediaFlow again.
  window.setInterval(()=>{
    if(document.visibilityState!=='visible' || (guestMode && !state.jobs.length && !sessionStorageSafe('mediaflow_has_jobs'))) return;
    const active=state.jobs.some(job=>['queued','downloading','processing'].includes(job.status));
    const sinceInteraction=Date.now()-state.lastInteraction;
    if(!active && sinceInteraction>180000) return;
    const interval=active ? 2500 : 15000;
    if(Date.now()-state.lastPoll<interval) return;
    state.lastPoll=Date.now();
    refreshJobs();
  },2500);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible' && (!guestMode || state.jobs.length || sessionStorageSafe('mediaflow_has_jobs'))) {state.lastInteraction=Date.now();refreshJobs();}
  });
})();
