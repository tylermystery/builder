// In: utils/shader.js
// Action: Create this new file.

// --- DEBUG ---
console.log('[shader.js] File execution started.');
// --- DEBUG ---

/**
 * Creates and compiles a shader.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {number} type gl.VERTEX_SHADER or gl.FRAGMENT_SHADER.
 * @param {string} source The shader source code.
 * @returns {WebGLShader} The compiled shader.
 */
function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

/**
 * A minimal helper class to create and run a WebGL shader program.
 */
export class Shader {
    /**
     * @param {WebGLRenderingContext} gl
     * @param {string} vsSource Vertex shader source.
     * @param {string} fsSource Fragment shader source.
     */
    constructor(gl, vsSource, fsSource) {
        this.gl = gl;
        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(program));
            return;
        }

        this.program = program;
        this.uniforms = {};

        // Create a simple plane (two triangles) to draw the shader on
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        this.positionAttributeLocation = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(this.positionAttributeLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(this.positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    }

    /** Tell the browser to use this shader program */
    use() {
        this.gl.useProgram(this.program);
    }

    /**
     * Gets and caches the location of a uniform variable in the shader.
     * @param {string} name
     */
    getUniformLocation(name) {
        if (!this.uniforms[name]) {
            this.uniforms[name] = this.gl.getUniformLocation(this.program, name);
        }
        return this.uniforms[name];
    }
}
