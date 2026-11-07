// Effects (v4): living gradient in the opening (desktop and phones) and dot
// grid on dark sections (desktop with a mouse only). Everything is off with
// "reduce motion"; the static CSS gradient stays as the fallback.
(function () {
  'use strict';
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var wide = window.matchMedia('(min-width: 900px)').matches;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  var desktop = fine && wide;

  var mouse = { x: 0.62, y: 0.45, px: -1000, py: -1000 };
  if (desktop) {
    window.addEventListener('pointermove', function (e) {
      mouse.x = e.clientX / window.innerWidth;
      mouse.y = e.clientY / window.innerHeight;
      mouse.px = e.clientX; mouse.py = e.clientY;
    }, { passive: true });
  }

  // ---------- living gradient (own WebGL shader) ----------
  // Same idea as the reference site, written from scratch: a warm cream base
  // with slow peach clouds and moving grain, plus a large soft triangle in
  // sand that a flow field bends into silky folds (light rim, soft shadow).
  // On desktop the shape leans towards the mouse; on phones it moves alone.
  function gradient(host) {
    var canvas = document.createElement('canvas');
    var gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!gl) return;
    var vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    var fs = [
      'precision highp float;',
      'uniform vec2 r;uniform float t;uniform vec2 m;uniform float mob;uniform vec3 cA,cB,cS,cF;',
      'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
      ' return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}',
      // Signed distance to an equilateral triangle of half-side s (negative inside).
      'float tri(vec2 p,float s){const float k=1.7320508;p.x=abs(p.x)-s;p.y=p.y+s/k;',
      ' if(p.x+k*p.y>0.)p=vec2(p.x-k*p.y,-k*p.x-p.y)/2.;p.x-=clamp(p.x,-2.*s,0.);return -length(p)*sign(p.y);}',
      // Flow field: a few small curl-like steps bend the shape into folds.
      'vec2 flow(vec2 p){for(int i=0;i<8;i++){float f=float(i);',
      ' p+=.15*vec2(sin(p.y*.95+t*.20+f*1.3),cos(p.x*.85-t*.17+f*2.1));}return p;}',
      'vec3 ovl(vec3 s,vec3 d){return mix(2.*s*d,1.-2.*(1.-s)*(1.-d),step(.5,d));}',
      // Distance to the bent shape, in units of its size.
      'float D(vec2 q,vec2 c,float s){vec2 p=flow((q-c)/s+vec2(0.,.05*sin(t*.2)))*s;return tri(p,s)/s;}',
      'void main(){',
      ' vec2 uv=gl_FragCoord.xy/r;float a=r.x/r.y;vec2 q=(uv-.5)*vec2(a,1.);',
      ' vec3 cream=cA,peach=cB,sand=cS;',
      ' float cl=n(q*1.1+vec2(t*.03,-t*.02))*.65+n(q*2.3-vec2(t*.035))*.35;',
      ' vec3 col=mix(cream,peach,smoothstep(.3,.8,cl)*.8);',
      ' float s=mix(.30*a,.50*a,mob);',
      ' vec2 c=mix(vec2(.08*a,.02)+(m-vec2(.5*a,.5))*.18,vec2(0.,.06),mob);',
      ' float e=.004;float d=D(q,c,s);',
      ' vec2 g=vec2(D(q+vec2(e,0.),c,s)-d,D(q+vec2(0.,e),c,s)-d);',
      ' float lit=dot(normalize(g+1e-6),normalize(vec2(-.55,.85)));',
      ' float body=smoothstep(.10,-.40,d);',
      ' col=mix(col,ovl(sand,col),body*.85);',
      ' col=mix(col,vec3(1.,.992,.98),body*.18);',
      // Embossed edge: light on the side facing the light, soft shadow on the other.
      ' float rim=exp(-d*d/.0035);float halo=exp(-d*d/.03);',
      ' col=mix(col,vec3(1.),rim*max(-lit,0.)*.75);',
      ' col=mix(col,col*vec3(.925,.905,.885),halo*max(lit,0.)*.55);',
      // Grain: moving on desktop; still on phones, where the canvas is enlarged
      // and a grain that changes every frame reads as flicker.
      ' col+=(h(gl_FragCoord.xy+fract(t*.73)*97.*(1.-mob))-.5)*mix(.045,.03,mob);',
      ' col=mix(cF,col,smoothstep(0.,.12,uv.y));',
      ' gl_FragColor=vec4(col,1.);}',
    ].join('\n');
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    host.appendChild(canvas);
    host.classList.add('gl');
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var uR = gl.getUniformLocation(prog, 'r'), uT = gl.getUniformLocation(prog, 't'),
        uM = gl.getUniformLocation(prog, 'm'), uMob = gl.getUniformLocation(prog, 'mob');
    // Render below full resolution (it's soft) and, on phones, at ~30 fps to save battery.
    var scale = desktop ? 0.6 : 0.5, minGap = desktop ? 0 : 32, last = 0;
    // Resize only when the size really changes: on iPhone, scrolling shows and
    // hides the address bar and fires "resize"; resetting the canvas each time
    // blanked it for a frame (a flash). After a resize, draw at once.
    function size() {
      var w = Math.max(1, Math.floor(host.clientWidth * scale));
      var h = Math.max(1, Math.floor(host.clientHeight * scale));
      if (w === canvas.width && h === canvas.height) return false;
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      return true;
    }
    size();
    window.addEventListener('resize', function () { if (size()) draw(performance.now()); });
    gl.uniform1f(uMob, desktop ? 0 : 1);
    // Colours from the page's palette (CSS variables), so the opening follows it.
    var uA = gl.getUniformLocation(prog, 'cA'), uB = gl.getUniformLocation(prog, 'cB'),
        uS = gl.getUniformLocation(prog, 'cS'), uF = gl.getUniformLocation(prog, 'cF');
    function hex(name, fallback) {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      var m = /^#([0-9a-f]{6})$/i.exec(v) || /^#([0-9a-f]{6})$/i.exec(fallback);
      return [0, 2, 4].map(function (i) { return parseInt(m[1].substr(i, 2), 16) / 255; });
    }
    function colours() {
      gl.uniform3fv(uA, hex('--hero-base', '#F5EEE8'));
      gl.uniform3fv(uB, hex('--hero-cloud', '#FBEBDD'));
      gl.uniform3fv(uS, hex('--hero-shape', '#F2D9C3'));
      gl.uniform3fv(uF, hex('--ivory', '#FAF6F0'));
    }
    colours();
    window.addEventListener('bl-palette', colours);
    var visible = true, sm = { x: mouse.x, y: mouse.y }, t0 = performance.now();
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(host);
    function draw(now) {
      gl.uniform2f(uR, canvas.width, canvas.height);
      gl.uniform1f(uT, (now - t0) / 1000);
      gl.uniform2f(uM, sm.x * canvas.width / canvas.height, 1 - sm.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    (function frame(now) {
      requestAnimationFrame(frame);
      if (!visible || document.hidden || now - last < minGap) return;
      last = now;
      sm.x += (mouse.x - sm.x) * 0.03; sm.y += (mouse.y - sm.y) * 0.03;
      draw(now);
    })(t0);
  }
  document.querySelectorAll('[data-gradient]').forEach(gradient);

  if (!desktop) return;

  // ---------- dot grid on dark sections ----------
  // Dot colour follows the accent colour (--gold), also when the palette changes.
  var accent = '203,173,133';
  function readAccent() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim();
    var m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) accent = [0, 2, 4].map(function (i) { return parseInt(m[1].substr(i, 2), 16); }).join(',');
  }
  readAccent();
  window.addEventListener('bl-palette', readAccent);
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
          ctx.fillStyle = k > 0.02 ? 'rgba(' + accent + ',' + (0.25 + k * 0.6) + ')' : 'rgba(250,246,240,0.08)';
          ctx.fillRect(xx - s / 2, yy - s / 2, s, s);
        }
      }
    })();
  }
  // Dot grid switched off (G, 7/11). To bring it back, set DOTS to true.
  var DOTS = false;
  if (DOTS) document.querySelectorAll('[data-dots]').forEach(dots);
})();
