// Desktop-only effects (v4): living gradient in the opening and dot grid on
// dark sections. (A lotus cursor was tried and set aside for now.) Off on touch screens, small screens and with
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
      'precision highp float;',
      'uniform vec2 r;uniform float t;uniform vec2 m;',
      'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
      ' return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}',
      // A soft shape made of three drifting blobs, warped by slow noise.
      'float field(vec2 q){',
      ' vec2 w=q+vec2(n(q*1.6+t*.06),n(q*1.6-t*.05))*.22;',
      ' vec2 c1=vec2(1.25+.18*sin(t*.11),.78+.10*cos(t*.09));',
      ' vec2 c2=vec2(1.55+.14*cos(t*.07),.42+.12*sin(t*.10));',
      ' vec2 c3=mix(vec2(1.05,.30),m,.35)+vec2(.06*sin(t*.13),.05*cos(t*.12));',
      ' return .11/dot(w-c1,w-c1)+.07/dot(w-c2,w-c2)+.05/dot(w-c3,w-c3);}',
      'void main(){',
      ' vec2 uv=gl_FragCoord.xy/r;float a=r.x/r.y;vec2 q=vec2(uv.x*a,uv.y);',
      ' vec3 ivory=vec3(.980,.965,.941),peach=vec3(.957,.878,.824),sand=vec3(.910,.800,.706),light=vec3(1.,.992,.980);',
      ' vec3 col=mix(ivory,peach,smoothstep(.1,1.,uv.x*.6+(1.-uv.y)*.25));',
      ' float e=.003;float f=field(q);',
      ' vec2 g=vec2(field(q+vec2(e,0))-f,field(q+vec2(0,e))-f)/e;',
      ' float body=smoothstep(.85,1.35,f);',
      ' float rim=smoothstep(.55,1.0,f)*(1.-smoothstep(1.0,1.6,f));',
      ' vec2 nrm=normalize(g+1e-5);float lit=dot(nrm,normalize(vec2(-.6,.8)));',
      ' col=mix(col,sand,body*.55);',
      ' col=mix(col,light,rim*max(lit,0.)*.75);',
      ' col=mix(col,sand*.92,rim*max(-lit,0.)*.35);',
      ' col=mix(ivory,col,smoothstep(.0,.35,uv.y));',
      ' col+=(h(gl_FragCoord.xy+fract(t)*91.)-.5)*.035*smoothstep(.0,.35,uv.y);',
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
    var scale = 0.6; // render below full resolution: it's a soft gradient
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
      gl.uniform2f(uM, sm.x * canvas.width / canvas.height, 1 - sm.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    })(t0);
  }
  document.querySelectorAll('[data-gradient]').forEach(gradient);

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
