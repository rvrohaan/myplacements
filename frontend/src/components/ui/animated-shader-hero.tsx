import React, { useRef, useEffect } from 'react'

// Adapted from 21st.dev "Animated Shader Hero" by @ravikatiyar162
// (https://21st.dev/@ravikatiyar162/components/animated-shader-hero).
// Changes for this repo: styled-jsx -> plain <style>, orange palette -> brand
// blue, shader cloud tint -> blue, pointer listeners cleaned up on unmount
// (StrictMode double-mounts otherwise duplicate them).

interface HeroProps {
  trustBadge?: {
    text: string
    icon?: React.ReactNode
  }
  headline: {
    line1: string
    line2: string
  }
  subtitle: string
  buttons?: {
    primary?: {
      text: string
      onClick?: () => void
    }
    secondary?: {
      text: string
      onClick?: () => void
    }
  }
  className?: string
}

const useShaderBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2')
    // No WebGL2 (old browser / disabled GPU): leave the static black backdrop.
    if (!gl) return

    let animationFrame = 0
    const abort = new AbortController()
    const { signal } = abort

    // --- Renderer ---------------------------------------------------------
    let program: WebGLProgram | null = null
    let vs: WebGLShader | null = null
    let fs: WebGLShader | null = null
    let buffer: WebGLBuffer | null = null
    let scale = Math.max(1, 0.5 * window.devicePixelRatio)

    const uniforms = {
      resolution: null as WebGLUniformLocation | null,
      time: null as WebGLUniformLocation | null,
      move: null as WebGLUniformLocation | null,
      touch: null as WebGLUniformLocation | null,
      pointerCount: null as WebGLUniformLocation | null,
      pointers: null as WebGLUniformLocation | null,
    }

    const vertexSrc = `#version 300 es
precision highp float;
in vec4 position;
void main(){gl_Position=position;}`

    const compile = (shader: WebGLShader, source: string) => {
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(shader))
      }
    }

    const setup = () => {
      vs = gl.createShader(gl.VERTEX_SHADER)!
      fs = gl.createShader(gl.FRAGMENT_SHADER)!
      compile(vs, vertexSrc)
      compile(fs, fragmentSrc)
      program = gl.createProgram()!
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program))
        program = null
        return
      }

      buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW)

      const position = gl.getAttribLocation(program, 'position')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

      uniforms.resolution = gl.getUniformLocation(program, 'resolution')
      uniforms.time = gl.getUniformLocation(program, 'time')
      uniforms.move = gl.getUniformLocation(program, 'move')
      uniforms.touch = gl.getUniformLocation(program, 'touch')
      uniforms.pointerCount = gl.getUniformLocation(program, 'pointerCount')
      uniforms.pointers = gl.getUniformLocation(program, 'pointers')
    }

    // --- Pointer state ----------------------------------------------------
    const pointers = new Map<number, number[]>()
    let lastCoords = [0, 0]
    let moves = [0, 0]
    let active = false

    const mapCoords = (x: number, y: number) => [x * scale, canvas.height - y * scale]
    const firstPointer = () => (pointers.size > 0 ? pointers.values().next().value! : lastCoords)

    canvas.addEventListener(
      'pointerdown',
      (e) => {
        active = true
        pointers.set(e.pointerId, mapCoords(e.clientX, e.clientY))
      },
      { signal },
    )
    const drop = (e: PointerEvent) => {
      if (pointers.size === 1) lastCoords = firstPointer()
      pointers.delete(e.pointerId)
      active = pointers.size > 0
    }
    canvas.addEventListener('pointerup', drop, { signal })
    canvas.addEventListener('pointerleave', drop, { signal })
    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!active) return
        lastCoords = [e.clientX, e.clientY]
        pointers.set(e.pointerId, mapCoords(e.clientX, e.clientY))
        moves = [moves[0] + e.movementX, moves[1] + e.movementY]
      },
      { signal },
    )

    // --- Sizing + render loop ---------------------------------------------
    const resize = () => {
      scale = Math.max(1, 0.5 * window.devicePixelRatio)
      canvas.width = window.innerWidth * scale
      canvas.height = window.innerHeight * scale
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    window.addEventListener('resize', resize, { signal })

    const render = (now: number) => {
      if (!program) return
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
      gl.uniform1f(uniforms.time, now * 1e-3)
      gl.uniform2f(uniforms.move, moves[0], moves[1])
      const first = firstPointer()
      gl.uniform2f(uniforms.touch, first[0], first[1])
      gl.uniform1i(uniforms.pointerCount, pointers.size)
      gl.uniform2fv(
        uniforms.pointers,
        new Float32Array(pointers.size > 0 ? Array.from(pointers.values()).flat() : [0, 0]),
      )
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      animationFrame = requestAnimationFrame(render)
    }

    setup()
    resize()
    animationFrame = requestAnimationFrame(render)

    return () => {
      abort.abort()
      cancelAnimationFrame(animationFrame)
      if (program) {
        if (vs) {
          gl.detachShader(program, vs)
          gl.deleteShader(vs)
        }
        if (fs) {
          gl.detachShader(program, fs)
          gl.deleteShader(fs)
        }
        gl.deleteProgram(program)
        program = null
      }
    }
  }, [])

  return canvasRef
}

const Hero: React.FC<HeroProps> = ({ trustBadge, headline, subtitle, buttons, className = '' }) => {
  const canvasRef = useShaderBackground()

  return (
    <div className={`relative w-full h-screen overflow-hidden bg-black ${className}`}>
      <style>{`
        @keyframes hero-fade-in-down {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes hero-fade-in-up {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .hero-fade-in-down { animation: hero-fade-in-down 0.8s ease-out forwards; }
        .hero-fade-in-up { animation: hero-fade-in-up 0.8s ease-out forwards; opacity: 0; }
        .hero-delay-200 { animation-delay: 0.2s; }
        .hero-delay-400 { animation-delay: 0.4s; }
        .hero-delay-600 { animation-delay: 0.6s; }
        .hero-delay-800 { animation-delay: 0.8s; }
      `}</style>

      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full touch-none"
        style={{ background: 'black' }}
      />

      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-white">
        {trustBadge && (
          <div className="mb-8 hero-fade-in-down">
            <div className="flex items-center gap-2 px-6 py-3 bg-blue-500/10 backdrop-blur-md border border-blue-300/30 rounded-full text-sm">
              {trustBadge.icon && <span className="text-sky-300">{trustBadge.icon}</span>}
              <span className="text-blue-100">{trustBadge.text}</span>
            </div>
          </div>
        )}

        <div className="text-center space-y-6 max-w-5xl mx-auto px-4">
          <div className="space-y-2">
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold bg-gradient-to-r from-blue-200 via-sky-300 to-cyan-200 bg-clip-text text-transparent hero-fade-in-up hero-delay-200">
              {headline.line1}
            </h1>
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold bg-gradient-to-r from-cyan-300 via-sky-400 to-blue-400 bg-clip-text text-transparent hero-fade-in-up hero-delay-400">
              {headline.line2}
            </h1>
          </div>

          <div className="max-w-3xl mx-auto hero-fade-in-up hero-delay-600">
            <p className="text-lg md:text-xl lg:text-2xl text-blue-100/90 font-light leading-relaxed">
              {subtitle}
            </p>
          </div>

          {buttons && (
            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10 hero-fade-in-up hero-delay-800">
              {buttons.primary && (
                <button
                  onClick={buttons.primary.onClick}
                  className="px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full font-semibold text-lg transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-blue-500/25"
                >
                  {buttons.primary.text}
                </button>
              )}
              {buttons.secondary && (
                <button
                  onClick={buttons.secondary.onClick}
                  className="px-8 py-4 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-300/30 hover:border-blue-300/50 text-blue-100 rounded-full font-semibold text-lg transition-all duration-300 hover:scale-105 backdrop-blur-sm"
                >
                  {buttons.secondary.text}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Fragment shader by Matthias Hurrle (@atzedent), cloud tint shifted to blue.
const fragmentSrc = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 resolution;
uniform float time;
uniform vec2 move;
uniform vec2 touch;
uniform int pointerCount;
uniform vec2 pointers;
#define FC gl_FragCoord.xy
#define T time
#define R resolution
#define MN min(R.x,R.y)
float rnd(vec2 p) {
  p=fract(p*vec2(12.9898,78.233));
  p+=dot(p,p+34.56);
  return fract(p.x*p.y);
}
float noise(in vec2 p) {
  vec2 i=floor(p), f=fract(p), u=f*f*(3.-2.*f);
  float
  a=rnd(i),
  b=rnd(i+vec2(1,0)),
  c=rnd(i+vec2(0,1)),
  d=rnd(i+1.);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p) {
  float t=.0, a=1.; mat2 m=mat2(1.,-.5,.2,1.2);
  for (int i=0; i<5; i++) {
    t+=a*noise(p);
    p*=2.*m;
    a*=.5;
  }
  return t;
}
float clouds(vec2 p) {
	float d=1., t=.0;
	for (float i=.0; i<3.; i++) {
		float a=d*fbm(i*10.+p.x*.2+.2*(1.+i)*p.y+d+i*i+p);
		t=mix(t,d,a);
		d=a;
		p*=2./(i+1.);
	}
	return t;
}
void main(void) {
	vec2 uv=(FC-.5*R)/MN,st=uv*vec2(2,1);
	vec3 col=vec3(0);
	float bg=clouds(vec2(st.x+T*.5,-st.y));
	uv*=1.-.3*(sin(T*.2)*.5+.5);
	for (float i=1.; i<12.; i++) {
		uv+=.1*cos(i*vec2(.1+.01*i, .8)+i*i+T*.5+.1*uv.x);
		vec2 p=uv;
		float d=length(p);
		col+=.00125/d*(cos(sin(i)*vec3(1,2,3))+1.)*vec3(.35,.75,1.15);
		float b=noise(i+p+bg*1.731);
		col+=.002*b/length(max(p,vec2(b*p.x*.02,p.y)));
		col=mix(col,vec3(bg*.04,bg*.10,bg*.26),d);
	}
	O=vec4(col,1);
}`

export default Hero
