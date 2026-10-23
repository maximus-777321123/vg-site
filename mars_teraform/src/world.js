import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import {
    fbm, smoothstep, clamp, terrainHeight, state,
    WORLD_RADIUS, MAP_SIZE, WATER_BASE, WATER_MAX
} from './core.js';

/* ========================= СКАЙ ========================= */
export const skyUniforms = {
    topColor: { value: new THREE.Color(0x24100c) },
    midColor: { value: new THREE.Color(0x6b3220) },
    botColor: { value: new THREE.Color(0xb36a3c) },
    sunDirection: { value: new THREE.Vector3(1, 0.5, 1).normalize() }
};
export let skyMesh = null;

export function initSky(scene) {
    const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, uniforms: skyUniforms,
        vertexShader: `
            varying vec3 vWorld;
            void main() {
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vWorld = wp.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 topColor, midColor, botColor;
            uniform vec3 sunDirection;
            varying vec3 vWorld;
            void main() {
                vec3 dir = normalize(vWorld);
                float h = dir.y;
                vec3 col = h > 0.0
                    ? mix(midColor, topColor, pow(h, 0.55))
                    : mix(midColor, botColor, pow(-h, 0.7));
                float sunDot = dot(dir, sunDirection);
                float sunDisk = smoothstep(0.998, 0.9995, sunDot);
                col = mix(col, vec3(1.0, 0.95, 0.8), sunDisk);
                float glow = pow(max(sunDot, 0.0), 64.0) * 0.5;
                col += vec3(1.0, 0.6, 0.3) * glow;
                gl_FragColor = vec4(col, 1.0);
            }`
    });
    skyMesh = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 20), mat);
    scene.add(skyMesh);
}

/* ========================= ТЕРРЕЙН ========================= */
let terrainGeo = null, tPos = null, baseColors = null, tColors = null;

const C_MARS_LOW = new THREE.Color(0x4a2114);
const C_MARS_MID = new THREE.Color(0x9a4b2a);
const C_MARS_HIGH = new THREE.Color(0xc07448);
const C_EARTH_LOW = new THREE.Color(0x2d5a2a);
const C_EARTH_MID = new THREE.Color(0x4a7a3a);
const C_EARTH_HIGH = new THREE.Color(0x6a5a3a);

function createNoiseTexture() {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        const val = Math.random() * 255;
        data[i*4] = val; data[i*4+1] = val; data[i*4+2] = val; data[i*4+3] = 255;
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(150, 150);
    tex.needsUpdate = true;
    return tex;
}

export function initTerrain(scene) {
    const T_SEG = 320;
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, T_SEG, T_SEG);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const base = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const y = terrainHeight(x, z);
        pos.setY(i, y);

        const n = fbm(x * 0.05 + 11, z * 0.05 + 7);
        const hf = clamp((y + 6) / 16, 0, 1);
        tmp.copy(C_MARS_LOW).lerp(C_MARS_MID, clamp(n * 1.4, 0, 1));
        tmp.lerp(C_MARS_HIGH, hf * 0.55);
        if (n < 0.32) tmp.lerp(C_MARS_LOW, (0.32 - n) * 1.6);

        cols[i*3] = base[i*3] = tmp.r;
        cols[i*3+1] = base[i*3+1] = tmp.g;
        cols[i*3+2] = base[i*3+2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();

    const noiseTex = createNoiseTexture();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 1.0, metalness: 0.02,
        bumpMap: noiseTex, bumpScale: 0.4
    }));
    mesh.receiveShadow = true;
    scene.add(mesh);

    terrainGeo = geo; tPos = pos;
    baseColors = base; tColors = geo.attributes.color;
}

/* ========================= ВОДА ========================= */
export const waterUniforms = {
    time: { value: 0 },
    waterColor: { value: new THREE.Color(0x1e5a8a) },
    opacity: { value: 0.72 }
};
export let waterMesh = null;

export function initWater(scene) {
    const geo = new THREE.PlaneGeometry(5000, 5000, 100, 100);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
        transparent: true, uniforms: waterUniforms,
        vertexShader: `
            uniform float time;
            varying float vWave;
            void main() {
                vec3 p = position;
                float w = sin(p.x * 0.06 + time * 1.1) * 0.5
                        + sin(p.z * 0.08 + time * 1.4) * 0.4
                        + sin((p.x + p.z) * 0.035 + time * 0.9) * 0.55;
                p.y += w;
                vWave = w;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 waterColor;
            uniform float opacity;
            varying float vWave;
            void main() {
                vec3 col = waterColor + vec3(0.12, 0.18, 0.1) * vWave;
                gl_FragColor = vec4(col, opacity);
            }`
    });
    waterMesh = new THREE.Mesh(geo, mat);
    waterMesh.position.y = WATER_BASE;
    waterMesh.renderOrder = 1;
    scene.add(waterMesh);
}

/* ========================= РАСТИТЕЛЬНОСТЬ ========================= */
const MAX_TREES = 2000;
let treeMesh = null;
const treeCandidates = [];

function makeTreeGeo() {
    const parts = [];
    function paint(g, hex) {
        const c = new THREE.Color(hex);
        const n = g.attributes.position.count;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i*3]=c.r; arr[i*3+1]=c.g; arr[i*3+2]=c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    const trunk = new THREE.CylinderGeometry(0.28, 0.4, 2, 5);
    trunk.translate(0, 1, 0); paint(trunk, 0x4a2a18); parts.push(trunk);
    const c1 = new THREE.ConeGeometry(1.7, 3.2, 6); c1.translate(0, 3.4, 0); paint(c1, 0x2d6b3a); parts.push(c1);
    const c2 = new THREE.ConeGeometry(1.25, 2.6, 6); c2.translate(0, 5.1, 0); paint(c2, 0x356b3a); parts.push(c2);
    const c3 = new THREE.ConeGeometry(0.85, 2.1, 6); c3.translate(0, 6.5, 0); paint(c3, 0x3a7a3f); parts.push(c3);
    return BGU.mergeGeometries(parts);
}

export function initVegetation(scene) {
    const geo = makeTreeGeo();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    treeMesh = new THREE.InstancedMesh(geo, mat, MAX_TREES);
    treeMesh.count = 0;
    treeMesh.castShadow = true;
    treeMesh.receiveShadow = true;
    scene.add(treeMesh);

    for (let i = 0; i < 8000; i++) {
        const x = (Math.random() - 0.5) * (WORLD_RADIUS * 2 - 20);
        const z = (Math.random() - 0.5) * (WORLD_RADIUS * 2 - 20);
        treeCandidates.push({ x, z, h: terrainHeight(x, z), rand: Math.random() });
    }
}

export function updateVegetation() {
    if (!treeMesh) return;
    const waterY = waterMesh.position.y;
    const vegLevel = Math.min(state.terra.temp * 1.15, state.terra.water * 1.3) / 100;
    if (vegLevel < 0.02) { treeMesh.count = 0; return; }

    let count = 0;
    const dummy = new THREE.Object3D();
    for (const c of treeCandidates) {
        if (count >= MAX_TREES) break;
        if (c.h < waterY + 1.5) continue;
        if (c.h > 12) continue;
        if (c.rand > vegLevel) continue;

        dummy.position.set(c.x, c.h, c.z);
        dummy.scale.setScalar(0.75 + c.rand * 0.7);
        dummy.rotation.y = c.rand * 157.3;
        dummy.updateMatrix();
        treeMesh.setMatrixAt(count++, dummy.matrix);
    }
    treeMesh.count = count;
    treeMesh.instanceMatrix.needsUpdate = true;
}

/* ========================= ОБЛАКА ========================= */
const clouds = [];
function makeCloudTex() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
}

export function initClouds(scene) {
    const tex = makeCloudTex();
    for (let i = 0; i < 40; i++) {
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
        const sp = new THREE.Sprite(mat);
        const a = Math.random() * Math.PI * 2;
        const r = 200 + Math.random() * 600;
        sp.position.set(Math.cos(a) * r, 90 + Math.random() * 70, Math.sin(a) * r);
        const s = 120 + Math.random() * 180;
        sp.scale.set(s, s * 0.55, 1);
        scene.add(sp);
        clouds.push({ sprite: sp, drift: 1.2 + Math.random() * 1.6, baseA: a, baseR: r });
    }
}

/* ========================= ПЫЛЬ ========================= */
const DUST_COUNT = 1200;
const dustGeo = new THREE.BufferGeometry();
let dustPoints = null;
export function initDust(scene) {
    const arr = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
        arr[i*3] = (Math.random() - 0.5) * 800;
        arr[i*3+1] = Math.random() * 60;
        arr[i*3+2] = (Math.random() - 0.5) * 800;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ color: 0xd9a074, size: 0.6, transparent: true, opacity: 0.35, depthWrite: false, sizeAttenuation: true });
    dustPoints = new THREE.Points(dustGeo, mat);
    scene.add(dustPoints);
}

export function updateDust(dt, time, center) {
    if (!dustPoints) return;
    dustPoints.position.set(0, 0, 0);
    const arr = dustGeo.attributes.position.array;
    for (let i = 0; i < DUST_COUNT; i++) {
        arr[i*3+1] += dt * (1.5 + (i % 5) * 0.4);
        if (arr[i*3+1] > 60) arr[i*3+1] = 0;
        arr[i*3] += Math.sin(time * 0.5 + i) * dt * 0.6;
        
        const dx = arr[i*3] - center.x;
        const dz = arr[i*3+2] - center.z;
        if (dx*dx + dz*dz > 400*400) {
            arr[i*3] = center.x + (Math.random() - 0.5) * 600;
            arr[i*3+2] = center.z + (Math.random() - 0.5) * 600;
            arr[i*3+1] = Math.random() * 40;
        }
    }
    dustGeo.attributes.position.needsUpdate = true;
    
    if (state.weather.storm) {
        dustPoints.material.color.setHex(0x552211);
        dustPoints.material.size = 1.8;
        dustPoints.material.opacity = 0.8;
    } else {
        dustPoints.material.color.setHex(0xd9a074);
        dustPoints.material.size = 0.6;
        dustPoints.material.opacity = 0.35;
    }
}

/* ========================= ВСПЫШКИ ========================= */
const bursts = [];
const burstGeo = new THREE.SphereGeometry(0.22, 6, 5);
import { refs } from './core.js';

export function spawnBurst(pos, color, count) {
    const group = new THREE.Group();
    const parts = [];
    for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(burstGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
        m.position.copy(pos); m.position.y += 1.2;
        const v = new THREE.Vector3((Math.random()-0.5)*10, Math.random()*8+2, (Math.random()-0.5)*10);
        group.add(m);
        parts.push({ mesh: m, vel: v });
    }
    refs.scene.add(group);
    bursts.push({ group, parts, life: 1.0 });
}

export function updateBursts(dt) {
    for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.life -= dt * 1.3;
        if (b.life <= 0) {
            refs.scene.remove(b.group);
            b.group.traverse(o => { if (o.isMesh) o.material.dispose(); });
            bursts.splice(i, 1); continue;
        }
        for (const p of b.parts) {
            p.vel.y -= 18 * dt;
            p.mesh.position.addScaledVector(p.vel, dt);
            p.mesh.material.opacity = b.life;
            p.mesh.scale.setScalar(b.life * 1.3 + 0.1);
        }
    }
}

/* ========================= ДЫМ ========================= */
const SMOKE_MAX = 500;
const smokeGeo = new THREE.BufferGeometry();
const smokePosArr = new Float32Array(SMOKE_MAX * 3);
const smokeColArr = new Float32Array(SMOKE_MAX * 3);
const smokeAlphaArr = new Float32Array(SMOKE_MAX);
const smokeSizeArr = new Float32Array(SMOKE_MAX);
for (let i = 0; i < SMOKE_MAX; i++) smokePosArr[i*3+1] = -1000;
smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePosArr, 3));
smokeGeo.setAttribute('pcolor', new THREE.BufferAttribute(smokeColArr, 3));
smokeGeo.setAttribute('alpha', new THREE.BufferAttribute(smokeAlphaArr, 1));
smokeGeo.setAttribute('psize', new THREE.BufferAttribute(smokeSizeArr, 1));

const smokeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `
        attribute vec3 pcolor;
        attribute float alpha;
        attribute float psize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
            vColor = pcolor;
            vAlpha = alpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = psize * (300.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
        }`,
    fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            float a = smoothstep(0.5, 0.05, d) * vAlpha;
            gl_FragColor = vec4(vColor, a);
        }`
});
let smokePoints = null;
const smokeParticles = [];
let smokeCursor = 0;

export function initSmoke(scene) {
    smokePoints = new THREE.Points(smokeGeo, smokeMat);
    smokePoints.frustumCulled = false;
    scene.add(smokePoints);
}

export function emitParticle(pos, color, size, velY, life) {
    const idx = smokeCursor;
    smokeCursor = (smokeCursor + 1) % SMOKE_MAX;
    smokeParticles[idx] = {
        pos: pos.clone(), color: new THREE.Color(color),
        size, velY, life, maxLife: life,
        drift: new THREE.Vector3((Math.random()-0.5)*0.6, 0, (Math.random()-0.5)*0.6)
    };
}

export function updateSmoke(dt) {
    const posAttr = smokeGeo.attributes.position;
    const colAttr = smokeGeo.attributes.pcolor;
    const alphaAttr = smokeGeo.attributes.alpha;
    const sizeAttr = smokeGeo.attributes.psize;

    for (let i = 0; i < SMOKE_MAX; i++) {
        const p = smokeParticles[i];
        if (!p || p.life <= 0) {
            alphaAttr.array[i] = 0; posAttr.array[i*3+1] = -1000; continue;
        }
        p.life -= dt;
        p.pos.y += p.velY * dt;
        p.pos.x += p.drift.x * dt;
        p.pos.z += p.drift.z * dt;
        p.size += dt * 2.5;
        p.velY *= 0.995;

        posAttr.array[i*3]   = p.pos.x;
        posAttr.array[i*3+1] = p.pos.y;
        posAttr.array[i*3+2] = p.pos.z;
        colAttr.array[i*3]   = p.color.r;
        colAttr.array[i*3+1] = p.color.g;
        colAttr.array[i*3+2] = p.color.b;
        alphaAttr.array[i] = Math.max(0, p.life / p.maxLife) * 0.55;
        sizeAttr.array[i] = p.size;
    }
    posAttr.needsUpdate = colAttr.needsUpdate = alphaAttr.needsUpdate = sizeAttr.needsUpdate = true;
}

/* ========================= ТЕРРАФОРМИРОВАНИЕ ========================= */
const SKY_MARS  = { top: new THREE.Color(0x24100c), mid: new THREE.Color(0x6b3220), bot: new THREE.Color(0xb36a3c) };
const SKY_EARTH = { top: new THREE.Color(0x1e4a8a), mid: new THREE.Color(0x6ca8e0), bot: new THREE.Color(0xb8ddf5) };
const FOG_MARS  = new THREE.Color(0x6b3a24);
const FOG_EARTH = new THREE.Color(0xa8d8f0);
const SUN_MARS  = new THREE.Color(0xffd9b0);
const SUN_EARTH = new THREE.Color(0xffffff);
const HEMI_MARS = new THREE.Color(0xffb27a);
const HEMI_EARTH= new THREE.Color(0xc8e8ff);

let lastColorUpdate = 0, lastVegUpdate = 0, lastT = -1;

export function applyTerraforming(time) {
    if (state.mode !== 'game') return;

    const t = (state.terra.temp + state.terra.atmo + state.terra.water) / 300;
    const fog = refs.scene.fog.color;

    skyUniforms.topColor.value.copy(SKY_MARS.top).lerp(SKY_EARTH.top, t);
    skyUniforms.midColor.value.copy(SKY_MARS.mid).lerp(SKY_EARTH.mid, t);
    skyUniforms.botColor.value.copy(SKY_MARS.bot).lerp(SKY_EARTH.bot, t);

    fog.copy(FOG_MARS).lerp(FOG_EARTH, t);
    refs.sun.color.copy(SUN_MARS).lerp(SUN_EARTH, t);
    refs.hemi.color.copy(HEMI_MARS).lerp(HEMI_EARTH, t);

    waterMesh.position.y = WATER_BASE + (WATER_MAX - WATER_BASE) * (state.terra.water / 100);
    waterUniforms.opacity.value = 0.5 + 0.3 * (state.terra.water / 100);
    waterUniforms.waterColor.value.setHex(0x1e5a8a).lerp(new THREE.Color(0x2d8ac0), state.terra.water / 100);

    if (state.weather.storm) {
        skyUniforms.topColor.value.lerp(new THREE.Color(0x110500), 0.6);
        skyUniforms.midColor.value.lerp(new THREE.Color(0x3a1508), 0.6);
        skyUniforms.botColor.value.lerp(new THREE.Color(0x5a2a10), 0.6);
        fog.lerp(new THREE.Color(0x3a1508), 0.6);
    }

    const cloudAlpha = Math.max(0, (state.terra.atmo - 15) / 85);
    for (const c of clouds) {
        c.sprite.material.opacity = cloudAlpha * 0.55;
        const a = c.baseA + time * 0.005 * c.drift;
        c.sprite.position.x = Math.cos(a) * c.baseR;
        c.sprite.position.z = Math.sin(a) * c.baseR;
    }

    if (time - lastColorUpdate > 0.8 && Math.abs(t - lastT) > 0.005 && terrainGeo) {
        lastColorUpdate = time; lastT = t;
        const green = Math.min(state.terra.temp, state.terra.water * 1.3) / 100;
        if (green > 0.01) {
            for (let i = 0; i < tPos.count; i++) {
                const y = tPos.getY(i);
                const bR = baseColors[i*3], bG = baseColors[i*3+1], bB = baseColors[i*3+2];
                const tgt = y > 8 ? C_EARTH_HIGH : (y > 1 ? C_EARTH_MID : C_EARTH_LOW);
                const m = clamp(green * 0.92, 0, 1);
                tColors.array[i*3]   = bR + (tgt.r - bR) * m;
                tColors.array[i*3+1] = bG + (tgt.g - bG) * m;
                tColors.array[i*3+2] = bB + (tgt.b - bB) * m;
            }
            tColors.needsUpdate = true;
        }
    }

    if (time - lastVegUpdate > 0.5) {
        lastVegUpdate = time;
        updateVegetation();
    }
}
