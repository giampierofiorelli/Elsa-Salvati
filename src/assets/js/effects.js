// Desktop-only effects (v4): living gradient in the opening, lotus cursor and
// dot grid on dark sections. Off on touch screens, small screens and with
// "reduce motion"; the static CSS gradient stays as the fallback.
(function () {
  'use strict';
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var wide = window.matchMedia('(min-width: 900px)').matches;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || !wide || reduce) return;

  var mouse = { x: 0.7, y: 0.3, px: -1000, py: -1000 };
  window.addEventListener('pointermove', function (e) {
    mouse.x = e.clientX / window.innerWidth;
    mouse.y = e.clientY / window.innerHeight;
    mouse.px = e.clientX; mouse.py = e.clientY;
  }, { passive: true });

  // ---------- living gradient (own WebGL shader) ----------
  function gradient(host) {
    var canvas = document.createElement('canvas');
    var gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!gl) return;
    host.appendChild(canvas);
    var vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    // Ivory to lotus peach with slow animated grain, plus a soft gold glow that
    // drifts through a flow field and leans towards the mouse.
    var fs = [
      'precision mediump float;',
      'uniform vec2 r;uniform float t;uniform vec2 m;',
      'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
      ' return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}',
      'float fbm(vec2 p){float v=0.,a=.5;for(int k=0;k<4;k++){v+=a*n(p);p*=2.02;a*=.5;}return v;}',
      'void main(){',
      ' vec2 uv=gl_FragCoord.xy/r;vec2 q=uv;q.x*=r.x/r.y;',
      ' vec3 ivory=vec3(.980,.965,.941),peach=vec3(.949,.839,.769),gold=vec3(.796,.678,.522);',
      ' vec3 col=mix(ivory,peach,smoothstep(.15,1.1,uv.x*.55+(1.-uv.y)*.15+fbm(q*1.4+t*.02)*.35));',
      ' vec2 c=vec2(mix(.78,m.x,.25)*r.x/r.y,mix(.72,1.-m.y,.25));',
      ' vec2 w=q+vec2(fbm(q*1.8+t*.05),fbm(q*1.8-t*.04))*.35;',
      ' float g=smoothstep(.75,.0,distance(w,c));',
      ' col=mix(col,col*(1.-.18*g)+gold*.18*g,g);',
      ' col+= (h(gl_FragCoord.xy+t)-.5)*.018;',
      ' gl_FragColor=vec4(col,1.);}',
    ].join('\n');
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var uR = gl.getUniformLocation(prog, 'r'), uT = gl.getUniformLocation(prog, 't'), uM = gl.getUniformLocation(prog, 'm');
    var scale = 0.5; // render at half resolution: it's a soft gradient
    function size() {
      canvas.width = Math.max(1, Math.floor(host.clientWidth * scale));
      canvas.height = Math.max(1, Math.floor(host.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    size();
    window.addEventListener('resize', size);
    var visible = true, sm = { x: mouse.x, y: mouse.y }, t0 = performance.now();
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(host);
    (function frame(now) {
      requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      sm.x += (mouse.x - sm.x) * 0.03; sm.y += (mouse.y - sm.y) * 0.03;
      gl.uniform2f(uR, canvas.width, canvas.height);
      gl.uniform1f(uT, (now - t0) / 1000);
      gl.uniform2f(uM, sm.x, sm.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    })(t0);
  }
  document.querySelectorAll('[data-gradient]').forEach(gradient);

  // ---------- lotus cursor ----------
  (function cursor() {
    var el = document.createElement('div');
    el.className = 'lotus-cursor';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<svg viewBox="0 0 100 100" fill="currentColor"><use href="/assets/img/lotus.svg#g"/></svg>';
    document.body.appendChild(el);
    document.documentElement.classList.add('has-lotus-cursor');
    var x = mouse.px, y = mouse.py, tx = x, ty = y;
    window.addEventListener('pointermove', function (e) { tx = e.clientX; ty = e.clientY; el.classList.add('on'); }, { passive: true });
    document.addEventListener('pointerleave', function () { el.classList.remove('on'); });
    document.addEventListener('pointerover', function (e) {
      var t = e.target.closest ? e.target : null;
      el.classList.toggle('active', !!(t && t.closest('a, button, [role="button"], label, summary')));
      el.classList.toggle('text', !!(t && t.closest('input, textarea, select')));
      el.classList.toggle('dark', !!(t && t.closest('.section-dark, .site-footer, .site-header.on-dark, .lang-notice')));
    });
    (function frame() {
      requestAnimationFrame(frame);
      x += (tx - x) * 0.35; y += (ty - y) * 0.35;
      el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    })();
  })();

  // ---------- dot grid on dark sections ----------
  function dots(section) {
    var canvas = document.createElement('canvas');
    canvas.className = 'dot-grid';
    canvas.setAttribute('aria-hidden', 'true');
    section.style.position = section.style.position || 'relative';
    section.insertBefore(canvas, section.firstChild);
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2), gap = 28, w, h, visible = false;
    function size() {
      w = section.clientWidth; h = section.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    window.addEventListener('resize', size);
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(section);
    (function frame() {
      requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      var rect = section.getBoundingClientRect();
      var mx = mouse.px - rect.left, my = mouse.py - rect.top;
      ctx.clearRect(0, 0, w, h);
      for (var yy = gap / 2; yy < h; yy += gap) {
        for (var xx = gap / 2; xx < w; xx += gap) {
          var d = Math.hypot(xx - mx, yy - my);
          var k = Math.max(0, 1 - d / 160);
          var s = 1.2 + k * 2.8;
          ctx.fillStyle = k > 0.02 ? 'rgba(203,173,133,' + (0.25 + k * 0.6) + ')' : 'rgba(250,246,240,0.08)';
          ctx.fillRect(xx - s / 2, yy - s / 2, s, s);
        }
      }
    })();
  }
  document.querySelectorAll('[data-dots]').forEach(dots);
})();
