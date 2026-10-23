import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import {
    UP, clamp, damp, lerpAngle, terrainHeight, state, refs,
    BUILDING_DEFS, RES_INFO, WORLD_RADIUS
} from './core.js';
import { spawnBurst, emitParticle } from './world.js';

/* ========================= ДРОН ========================= */
export const droneRoot = new THREE.Group();
const droneTilt = new THREE.Group();
export const dronePos = new THREE.Vector3(0, terrainHeight(0, 0) + 6, 0);
const droneVel = new THREE.Vector3();
let droneYaw = 0, droneAltitude = 6;
let droneModel = null;
export let droneHP = 100;

let droneDying = false;
let droneDeathTimer = 0;
let droneDeathStage = 0;

export function killDrone() {
    if (state.creative) return;
    if (droneDying) return;
    droneDying = true;
    state.droneDead = true;
}
export function isDroneDead() { return droneDying && droneDeathStage >= 3; }

export const collectRing = new THREE.Mesh(
    new THREE.RingGeometry(4.6, 5.1, 56),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })
);
collectRing.rotation.x = -Math.PI / 2;

const MOVE_SPEED = 22, ALT_MIN = 3.5, ALT_MAX = 35;

function createDroneModel() {
    const g = new THREE.Group();
    const props = [];
    const matBody = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.35, metalness: 0.75 });
    const matAccent = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.25, metalness: 0.6, emissive: 0x0d5a80, emissiveIntensity: 1 });
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7, metalness: 0.3 });
    const matGlass = new THREE.MeshPhysicalMaterial({ color: 0x05131e, roughness: 0.05, metalness: 1, clearcoat: 1 });

    const body = new THREE.Mesh(new RoundedBoxGeometry(2.2, 0.8, 3.2, 4, 0.35), matBody);
    body.castShadow = true; g.add(body);
    const top = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.35, 2.0, 3, 0.15), matAccent);
    top.position.y = 0.5; top.castShadow = true; g.add(top);

    const cam = new THREE.Group(); cam.position.set(0, -0.2, 1.6); g.add(cam);
    const cm = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 16), matBlack);
    cm.rotation.x = Math.PI / 2; cm.position.z = 0.1; cam.add(cm);
    const cb = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.5, 0.5, 3, 0.1), matBlack);
    cb.position.z = 0.3; cb.castShadow = true; cam.add(cb);
    const ln = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.2, 24), matGlass);
    ln.rotation.x = Math.PI / 2; ln.position.z = 0.55; cam.add(ln);
    const lensGlow = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), new THREE.MeshBasicMaterial({ color: 0x7fe6ff }));
    lensGlow.position.z = 0.66; cam.add(lensGlow);

    for (let i = 0; i < 4; i++) {
        const armG = new THREE.Group();
        armG.rotation.y = Math.PI / 4 + i * Math.PI / 2; g.add(armG);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 1.9), matBody);
        arm.position.set(0, 0, 1.4); arm.castShadow = true; armG.add(arm);
        const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.4, 20), matBlack);
        motor.position.set(0, 0.15, 2.3); motor.castShadow = true; armG.add(motor);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 12, 24), i % 2 === 0 ? matAccent : matBody);
        ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.34, 2.3); armG.add(ring);

        const propG = new THREE.Group(); propG.position.set(0, 0.38, 2.3); armG.add(propG);
        propG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 12), matBlack));
        const bladeGeo = new THREE.BoxGeometry(1.9, 0.02, 0.14);
        const b1 = new THREE.Mesh(bladeGeo, matBlack); b1.position.x = 0.85; b1.castShadow = true; propG.add(b1);
        const b2 = new THREE.Mesh(bladeGeo, matBlack); b2.position.x = -0.85; b2.castShadow = true; propG.add(b2);
        props.push({ mesh: propG, speed: (i % 2 === 0 ? 1 : -1) * 28 });
    }
    [-1, 1].forEach(side => {
        const skid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.4), matBlack);
        skid.position.set(side * 0.8, -0.7, 0); skid.castShadow = true; g.add(skid);
        [-1, 1].forEach(z => {
            const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), matBlack);
            strut.position.set(side * 0.8, -0.4, z * 0.8); g.add(strut);
        });
    });
    g.scale.setScalar(0.75);
    return { group: g, props, lensGlow };
}

export function initDrone(scene) {
    droneModel = createDroneModel();
    droneTilt.add(droneModel.group);
    droneRoot.add(droneTilt);
    dronePos.y = terrainHeight(0, 0) + droneAltitude;
    droneRoot.position.copy(dronePos);
    scene.add(droneRoot);
    scene.add(collectRing);
}

const camDir = new THREE.Vector3(), camRight = new THREE.Vector3(), moveVec = new THREE.Vector3();

export function updateDrone(dt, time, keys, camera) {
    if (droneDying) {
        droneDeathTimer += dt;
        if (droneDeathStage === 0 && droneDeathTimer > 0.4) {
            droneDeathStage = 1;
            spawnBurst(dronePos, 0xff4400, 10);
            droneVel.x = (Math.random() - 0.5) * 8;
            droneVel.z = (Math.random() - 0.5) * 8;
        }
        if (droneDeathStage === 1 && droneDeathTimer > 1.1) {
            droneDeathStage = 2;
            spawnBurst(dronePos, 0xff4400, 10);
        }
        if (droneDeathStage === 2) {
            droneVel.y -= 32 * dt;
            dronePos.x += droneVel.x * dt;
            dronePos.z += droneVel.z * dt;
            dronePos.y += droneVel.y * dt;
            droneRoot.rotation.z += dt * 4;
            droneRoot.rotation.x += dt * 2;
            droneRoot.position.copy(dronePos);
            droneModel.props.forEach(p => { p.mesh.rotation.y += p.speed * dt * 0.3; });
            
            const gy = terrainHeight(dronePos.x, dronePos.z);
            if (dronePos.y <= gy + 0.8) {
                dronePos.y = gy + 0.8;
                droneDeathStage = 3;
                droneRoot.position.copy(dronePos);
            }
        }
        collectRing.visible = false;
        return;
    }

    camera.getWorldDirection(camDir); camDir.y = 0;
    if (camDir.lengthSq() < 0.0001) camDir.set(0, 0, -1);
    camDir.normalize();
    camRight.crossVectors(camDir, UP).normalize();

    moveVec.set(0, 0, 0);
    if (keys['KeyW'] || keys['ArrowUp'])    moveVec.add(camDir);
    if (keys['KeyS'] || keys['ArrowDown'])  moveVec.sub(camDir);
    if (keys['KeyD'] || keys['ArrowRight']) moveVec.add(camRight);
    if (keys['KeyA'] || keys['ArrowLeft'])  moveVec.sub(camRight);
    if (moveVec.lengthSq() > 0) moveVec.normalize();

    droneVel.x = damp(droneVel.x, moveVec.x * MOVE_SPEED, 5.5, dt);
    droneVel.z = damp(droneVel.z, moveVec.z * MOVE_SPEED, 5.5, dt);
    dronePos.x += droneVel.x * dt;
    dronePos.z += droneVel.z * dt;

    const dist = Math.hypot(dronePos.x, dronePos.z);
    if (dist > WORLD_RADIUS - 4) {
        const k = (WORLD_RADIUS - 4) / dist;
        dronePos.x *= k; dronePos.z *= k; droneVel.multiplyScalar(0.4);
    }

    if (keys['Space']) droneAltitude += 14 * dt;
    if (keys['ShiftLeft'] || keys['ShiftRight']) droneAltitude -= 14 * dt;
    droneAltitude = clamp(droneAltitude, ALT_MIN, ALT_MAX);

    const gy = terrainHeight(dronePos.x, dronePos.z);
    dronePos.y = damp(dronePos.y, gy + droneAltitude, 5, dt);
    droneRoot.position.copy(dronePos);

    const sp = Math.hypot(droneVel.x, droneVel.z);
    if (sp > 1.5) {
        const ty = Math.atan2(droneVel.x, droneVel.z);
        droneYaw = lerpAngle(droneYaw, ty, 1 - Math.exp(-9 * dt));
    }
    
    droneRoot.rotation.y = droneYaw;
    droneRoot.rotation.x = 0; droneRoot.rotation.z = 0;

    const tx = -Math.min(sp / MOVE_SPEED, 1) * 0.35;
    droneTilt.rotation.x = damp(droneTilt.rotation.x, tx, 7, dt);

    droneModel.group.position.y = Math.sin(time * 3.2) * 0.08;
    droneModel.props.forEach(p => { p.mesh.rotation.y += p.speed * dt; });
    droneModel.lensGlow.scale.setScalar(1 + Math.sin(time * 4) * 0.15);

    collectRing.visible = true;
    collectRing.position.set(dronePos.x, gy + 0.1, dronePos.z);
    collectRing.material.opacity = 0.2 + Math.sin(time * 2.5) * 0.08;
}

/* ========================= РЕСУРСНЫЕ УЗЛЫ И ЯЩИКИ ========================= */
function makeNodeGeo(type) {
    const parts = [];
    const add = (geo, x, y, z, rx, ry, rz) => {
        const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx||0, ry||0, rz||0));
        geo.applyMatrix4(m); geo.translate(x, y, z); parts.push(geo);
    };
    const r = () => Math.random();
    if (type === 'iron') { for (let i = 0; i < 3; i++) { const s = 0.55 + r() * 0.65; add(new THREE.IcosahedronGeometry(s, 0), (r()-.5)*1.4, s*0.6, (r()-.5)*1.4, r()*3, r()*3, r()*3); } }
    else if (type === 'silicon') { for (let i = 0; i < 4; i++) { const s = 0.35 + r() * 0.4; add(new THREE.OctahedronGeometry(s, 0), (r()-.5)*1.4, s*1.4, (r()-.5)*1.4, r()*3, r()*3, r()*3); } }
    else if (type === 'carbon') { for (let i = 0; i < 3; i++) { const s = 0.5 + r() * 0.5; add(new THREE.DodecahedronGeometry(s, 0), (r()-.5)*1.3, s*0.7, (r()-.5)*1.3, r()*3, r()*3, r()*3); } }
    else { for (let i = 0; i < 4; i++) { const s = 0.3 + r() * 0.35; add(new THREE.ConeGeometry(s, s * 3, 5), (r()-.5)*1.3, s*1.6, (r()-.5)*1.3, (r()-.5)*0.5, r()*3, (r()-.5)*0.5); } }
    return BGU.mergeGeometries(parts);
}

const NODE_MATS = {
    iron:    new THREE.MeshStandardMaterial({ color: 0x9a5230, roughness: 0.92, metalness: 0.35, flatShading: true }),
    silicon: new THREE.MeshStandardMaterial({ color: 0xb6c6da, roughness: 0.28, metalness: 0.85, flatShading: true }),
    carbon:  new THREE.MeshStandardMaterial({ color: 0x2b2b34, roughness: 0.88, metalness: 0.25, flatShading: true }),
    ice:     new THREE.MeshStandardMaterial({ color: 0x8fd8ff, roughness: 0.12, metalness: 0.25, emissive: 0x1a6088, emissiveIntensity: 0.9, transparent: true, opacity: 0.93, flatShading: true })
};
const NODE_GEOS = { iron: makeNodeGeo('iron'), silicon: makeNodeGeo('silicon'), carbon: makeNodeGeo('carbon'), ice: makeNodeGeo('ice') };
const nodes = [];
const NODE_AMOUNT = 8, NODE_DRAIN = 8, NODE_RADIUS = 5, NODE_RESPAWN = 34;

function spawnNode(scene, type, x, z) {
    const mesh = new THREE.Mesh(NODE_GEOS[type], NODE_MATS[type]);
    const y = terrainHeight(x, z);
    mesh.position.set(x, y, z); mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    nodes.push({ mesh, type, pos: new THREE.Vector3(x, y, z), amount: NODE_AMOUNT, max: NODE_AMOUNT, alive: true, respawn: 0 });
}

export function initNodes(scene) {
    const pool = ['iron','iron','iron','iron','silicon','silicon','silicon','carbon','carbon','ice','ice','ice'];
    for (let i = 0; i < 600; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 14 + Math.pow(Math.random(), 0.7) * (WORLD_RADIUS - 20);
        spawnNode(scene, pool[Math.floor(Math.random() * pool.length)], Math.cos(a) * r, Math.sin(a) * r);
    }
}

export function updateNodes(dt) {
    const R2 = NODE_RADIUS * NODE_RADIUS;
    for (const n of nodes) {
        if (!n.alive) { n.respawn -= dt; if (n.respawn <= 0) { n.alive = true; n.amount = n.max; n.mesh.visible = true; n.mesh.scale.setScalar(1); } continue; }
        const dx = dronePos.x - n.pos.x, dz = dronePos.z - n.pos.z;
        if (dx*dx + dz*dz > R2) continue;
        const take = Math.min(n.amount, NODE_DRAIN * dt);
        if (take <= 0) continue;
        n.amount -= take; state.res[n.type] += take;
        n.mesh.scale.setScalar(0.35 + 0.65 * (n.amount / n.max));
        n.mesh.rotation.y += dt * 2.0;
        if (n.amount <= 0.001) { n.alive = false; n.mesh.visible = false; n.respawn = NODE_RESPAWN; spawnBurst(n.pos, RES_INFO[n.type].color, 10); }
    }
}

function makeCrateGeos() {
    const S = 2.4, T = 0.17, h = S/2 - T/2;
    const core = new THREE.BoxGeometry(S - T*2, S - T*2, S - T*2);
    const parts = [];
    [-h, h].forEach(y => [-h, h].forEach(z => { const g = new THREE.BoxGeometry(S, T, T); g.translate(0, y, z); parts.push(g); }));
    [-h, h].forEach(x => [-h, h].forEach(z => { const g = new THREE.BoxGeometry(T, S, T); g.translate(x, 0, z); parts.push(g); }));
    [-h, h].forEach(x => [-h, h].forEach(y => { const g = new THREE.BoxGeometry(T, T, S); g.translate(x, y, 0); parts.push(g); }));
    return { core, frame: BGU.mergeGeometries(parts) };
}

let woodTex = null;
function getWoodTex() {
    if (woodTex) return woodTex;
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#6b4423'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
        const x = Math.random()*256, y = Math.random()*256, len = Math.random()*110+30;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+len, y+(Math.random()-.5)*7);
        ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(40,20,8,0.32)' : 'rgba(160,110,70,0.22)';
        ctx.lineWidth = Math.random()*2.4+0.8; ctx.stroke();
    }
    woodTex = new THREE.CanvasTexture(cv);
    woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
    return woodTex;
}

const crateGeos = makeCrateGeos();
const crateWoodMat = new THREE.MeshStandardMaterial({ map: getWoodTex(), roughness: 0.92, metalness: 0.03, color: 0xb8b8b8 });
const crateFrameMat = new THREE.MeshStandardMaterial({ map: getWoodTex(), roughness: 0.88, metalness: 0.05, color: 0xe0e0e0 });
const crateBeaconMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
const crates = [];
const CRATE_RADIUS = 5.5;

function spawnCrate(scene, x, z) {
    const scale = 1.1;
    const g = new THREE.Group();
    const coreMesh = new THREE.Mesh(crateGeos.core, crateWoodMat);
    coreMesh.castShadow = coreMesh.receiveShadow = true; g.add(coreMesh);
    const frameMesh = new THREE.Mesh(crateGeos.frame, crateFrameMat);
    frameMesh.castShadow = true; g.add(frameMesh);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), crateBeaconMat);
    beacon.position.y = 1.4; g.add(beacon);
    const y = terrainHeight(x, z) + 1.2 * scale;
    g.position.set(x, y, z); g.rotation.y = Math.random() * Math.PI * 2; g.scale.setScalar(scale);
    scene.add(g);
    crates.push({ mesh: g, beacon, pos: new THREE.Vector3(x, y, z), alive: true, respawn: 0 });
}

export function initCrates(scene) {
    for (let i = 0; i < 100; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 25 + Math.pow(Math.random(), 0.8) * (WORLD_RADIUS - 30);
        spawnCrate(scene, Math.cos(a) * r, Math.sin(a) * r);
    }
}

export function updateCrates(dt, time) {
    for (const c of crates) {
        if (!c.alive) {
            c.respawn -= dt;
            if (c.respawn <= 0) {
                c.alive = true; c.mesh.visible = true;
                const a = Math.random() * Math.PI * 2;
                const r = 25 + Math.pow(Math.random(), 0.8) * (WORLD_RADIUS - 30);
                const x = Math.cos(a) * r, z = Math.sin(a) * r, y = terrainHeight(x, z) + 1.2;
                c.pos.set(x, y, z); c.mesh.position.copy(c.pos);
                c.mesh.rotation.y = Math.random() * Math.PI * 2;
            }
            continue;
        }
        c.beacon.scale.setScalar(1 + Math.sin(time * 4 + c.pos.x) * 0.3);
        if (droneDying) continue;
        const dx = dronePos.x - c.pos.x, dz = dronePos.z - c.pos.z;
        if (dx*dx + dz*dz > CRATE_RADIUS * CRATE_RADIUS) continue;
        c.alive = false; c.mesh.visible = false; c.respawn = 70;
        const types = ['iron', 'silicon', 'carbon', 'ice'];
        const main = types[Math.floor(Math.random() * types.length)];
        state.res[main] += 22 + Math.floor(Math.random() * 30);
        types.forEach(t => { if (t !== main) state.res[t] += 6 + Math.floor(Math.random() * 10); });
        state.res.alloys += 2;
        spawnBurst(c.pos, 0xffb347, 22);
    }
}

/* ========================= ЗДАНИЯ ========================= */
const MAT_DARK  = new THREE.MeshStandardMaterial({ color: 0x1e2330, roughness: 0.4, metalness: 0.8 });
const MAT_LIGHT = new THREE.MeshStandardMaterial({ color: 0xc0c8d8, roughness: 0.2, metalness: 0.9 });
const MAT_GLOW_CYAN   = new THREE.MeshBasicMaterial({ color: 0x5ee0ff });
const MAT_GLOW_GREEN  = new THREE.MeshBasicMaterial({ color: 0x6dffab });
const MAT_GLOW_ORANGE = new THREE.MeshBasicMaterial({ color: 0xffa53d });
const MAT_GLOW_RED    = new THREE.MeshBasicMaterial({ color: 0xff3322 });

function createBase(g, radius, height) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.2, height, 8), MAT_DARK);
    base.position.y = height / 2; base.castShadow = base.receiveShadow = true; g.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.95, 0.1, 8, 24), MAT_GLOW_CYAN);
    ring.rotation.x = Math.PI / 2; ring.position.y = height; g.add(ring);
}

export function createBuildingMesh(type) {
    const g = new THREE.Group();
    const spinners = [], emitters = [];
    let barrel = null;

    if (type === 'solar') {
        createBase(g, 3.0, 0.6);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3.5, 8), MAT_LIGHT);
        mast.position.y = 2.35; mast.castShadow = true; g.add(mast);
        const tracker = new THREE.Group(); tracker.position.y = 4.0; g.add(tracker);
        const panelMat = new THREE.MeshStandardMaterial({ color: 0x14315c, roughness: 0.1, metalness: 0.95, emissive: 0x0d3a72, emissiveIntensity: 1.2 });
        const panel = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.2, 6.0), panelMat);
        panel.rotation.x = -0.45; panel.castShadow = true; tracker.add(panel);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(9.3, 0.15, 6.3), MAT_LIGHT);
        frame.rotation.x = -0.45; frame.position.y = -0.1; tracker.add(frame);
        for (let i = -3; i <= 3; i++) {
            const line = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 6.0), MAT_LIGHT);
            line.position.set(i * 1.3, 0.11, 0); line.rotation.x = -0.45; tracker.add(line);
        }
        spinners.push({ mesh: tracker, type: 'sweep' });

    } else if (type === 'drill') {
        createBase(g, 3.2, 1.0);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.3, 4.0, 12), MAT_LIGHT);
        body.position.y = 3.0; body.castShadow = true; g.add(body);
        const collar = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.25, 10, 24), MAT_DARK);
        collar.rotation.x = Math.PI / 2; collar.position.y = 5.0; g.add(collar);
        const head = new THREE.Group(); head.position.y = 5.8; g.add(head);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 12), MAT_LIGHT);
        shaft.position.y = 0.5; head.add(shaft);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.5, 12), MAT_DARK);
        cone.position.y = 2.2; head.add(cone);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 12), MAT_GLOW_ORANGE);
        tip.position.y = 3.7; head.add(tip);
        spinners.push({ mesh: head, speed: 4.5, axis: 'y' });
        const gRing = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.12, 8, 36), MAT_GLOW_ORANGE);
        gRing.rotation.x = Math.PI / 2; gRing.position.y = 1.2; g.add(gRing);

    } else if (type === 'iceExtractor') {
        createBase(g, 3.2, 1.0);
        const dome = new THREE.Mesh(
            new THREE.SphereGeometry(2.8, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x2c5a7a, roughness: 0.1, metalness: 0.7, emissive: 0x0e3a55, emissiveIntensity: 1.0 })
        );
        dome.position.y = 1.0; dome.castShadow = true; g.add(dome);
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 5.5, 12), MAT_LIGHT);
        pipe.position.set(2.2, 3.5, 0); pipe.castShadow = true; g.add(pipe);
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), MAT_GLOW_CYAN);
        core.position.y = 2.8; g.add(core);
        spinners.push({ mesh: core, speed: 2.0, axis: 'y' });
        emitters.push({ pos: new THREE.Vector3(2.2, 6.5, 0), color: 0xaae5ff, rate: 6 });

    } else if (type === 'factory') {
        createBase(g, 4.5, 0.8);
        const hall = new THREE.Mesh(new RoundedBoxGeometry(7.5, 4.5, 6.0, 4, 0.2), MAT_LIGHT);
        hall.position.y = 3.0; hall.castShadow = true; hall.receiveShadow = true; g.add(hall);
        for (let i = -1; i <= 1; i++) {
            const w = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.15), MAT_GLOW_ORANGE);
            w.position.set(i * 2.2, 3.2, 3.1); g.add(w);
        }
        [[-2.2, -2.0], [0, -2.0], [2.2, -2.0]].forEach(([x, z]) => {
            const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 5.5, 12), MAT_DARK);
            chim.position.set(x, 6.0, z); chim.castShadow = true; g.add(chim);
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.4, 12), MAT_LIGHT);
            cap.position.set(x, 8.8, z); g.add(cap);
            emitters.push({ pos: new THREE.Vector3(x, 9.0, z), color: 0x909090, rate: 5 });
        });

    } else if (type === 'terraformer') {
        createBase(g, 5.0, 1.5);
        const mid = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 4.0, 2.5, 6), MAT_LIGHT);
        mid.position.y = 2.8; mid.castShadow = true; g.add(mid);
        const upper = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.5, 2.0, 6), MAT_LIGHT);
        upper.position.y = 5.0; upper.castShadow = true; g.add(upper);
        const coreMat = new THREE.MeshStandardMaterial({ color: 0x0e4a2a, roughness: 0.1, metalness: 0.5, emissive: 0x2bff88, emissiveIntensity: 2.5 });
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 1), coreMat);
        core.position.y = 7.0; g.add(core);
        spinners.push({ mesh: core, speed: 1.0, axis: 'y' });
        spinners.push({ mesh: core, type: 'pulse', target: coreMat });
        
        const r1 = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.2, 12, 48), MAT_GLOW_GREEN);
        r1.position.y = 7.0; r1.rotation.x = Math.PI / 2 + 0.35; g.add(r1);
        spinners.push({ mesh: r1, speed: 1.4, axis: 'z' });
        
        const beamMat = new THREE.MeshBasicMaterial({ color: 0x6dffab, transparent: true, opacity: 0.2, depthWrite: false });
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.5, 25, 16, 1, true), beamMat);
        beam.position.y = 19.0; g.add(beam);
        spinners.push({ mesh: beam, type: 'beamPulse', target: beamMat });
        emitters.push({ pos: new THREE.Vector3(0, 7.0, 0), color: 0x6dffab, rate: 16 });

    } else if (type === 'waterPump') {
        createBase(g, 3.0, 0.8);
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 5.0, 16), MAT_LIGHT);
        tank.position.y = 3.3; tank.castShadow = true; g.add(tank);
        const levelMat = new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.85 });
        const level = new THREE.Mesh(new THREE.CylinderGeometry(2.52, 2.52, 3.5, 16), levelMat);
        level.position.y = 2.8; g.add(level);
        spinners.push({ mesh: level, type: 'waterLevel', target: levelMat });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 8, 0, Math.PI*2, 0, Math.PI/2), MAT_DARK);
        dome.position.y = 5.8; dome.castShadow = true; g.add(dome);
        
        const pumpWheel = new THREE.Group();
        pumpWheel.position.set(-3.0, 3.0, 0); pumpWheel.rotation.z = Math.PI/2; g.add(pumpWheel);
        const spinGroup = new THREE.Group(); pumpWheel.add(spinGroup);
        spinGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.8, 12), MAT_DARK));
        for (let i = 0; i < 4; i++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.1), MAT_LIGHT);
            blade.position.y = 1.1; blade.rotation.z = (i / 4) * Math.PI * 2; spinGroup.add(blade);
        }
        spinners.push({ mesh: spinGroup, speed: 6, axis: 'y' });
        emitters.push({ pos: new THREE.Vector3(0, 6.2, 0), color: 0x4fc3f7, rate: 5 });

    } else if (type === 'steamGen') {
        createBase(g, 4.0, 0.8);
        const towerBottom = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 2.0, 16), MAT_LIGHT);
        towerBottom.position.y = 1.8; towerBottom.castShadow = true; g.add(towerBottom);
        const towerMid = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 3.2, 4.0, 16), MAT_LIGHT);
        towerMid.position.y = 4.8; towerMid.castShadow = true; g.add(towerMid);
        const towerTop = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.0, 2.0, 16), MAT_LIGHT);
        towerTop.position.y = 7.8; towerTop.castShadow = true; g.add(towerTop);
        const hole = new THREE.Mesh(new THREE.CircleGeometry(2.35, 20), new THREE.MeshBasicMaterial({ color: 0x080808 }));
        hole.rotation.x = -Math.PI/2; hole.position.y = 8.75; g.add(hole);
        for (let i = 0; i < 3; i++) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4 - i * 0.3, 0.12, 8, 32), MAT_GLOW_ORANGE);
            ring.rotation.x = Math.PI/2; ring.position.y = 1.8 + i * 2.0; g.add(ring);
        }
        emitters.push({ pos: new THREE.Vector3(0, 9.0, 0), color: 0xffffff, rate: 15 });

    } else if (type === 'battery') {
        const base = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.8, 4.5), MAT_DARK);
        base.position.y = 0.4; base.castShadow = base.receiveShadow = true; g.add(base);
        const cellMat = new THREE.MeshStandardMaterial({ color: 0x1e2330, roughness: 0.2, metalness: 0.8 });
        const glowMats = [];
        for (let i = 0; i < 3; i++) {
            const cell = new THREE.Mesh(new RoundedBoxGeometry(2.0, 4.5, 3.5, 4, 0.2), cellMat);
            cell.position.set(-2.5 + i * 2.5, 3.0, 0); cell.castShadow = true; g.add(cell);
            const glowMat = new THREE.MeshBasicMaterial({ color: 0x6dffab });
            const glow = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.8, 0.15), glowMat);
            glow.position.set(-2.5 + i * 2.5, 3.0, 1.8); g.add(glow);
            glowMats.push(glowMat);
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.6, 8), MAT_GLOW_ORANGE);
            cap.position.set(-2.5 + i * 2.5, 5.5, 0); g.add(cap);
        }
        spinners.push({ type: 'batteryGlow', targets: glowMats });

    } else if (type === 'controlSys') {
        const base = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.5, 6.5), MAT_DARK);
        base.position.y = 0.75; base.castShadow = base.receiveShadow = true; g.add(base);
        const building = new THREE.Mesh(new RoundedBoxGeometry(5.5, 4.0, 5.0, 4, 0.2), MAT_LIGHT);
        building.position.y = 3.5; building.castShadow = true; g.add(building);
        for (let i = 0; i < 3; i++) {
            const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.2), MAT_DARK);
            frame.position.set(-1.7 + i * 1.7, 4.2, 2.55); g.add(frame);
            const screenMat = new THREE.MeshBasicMaterial({ color: i === 1 ? 0x5ee0ff : 0x2d8ac0 });
            const screen = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.1), screenMat);
            screen.position.set(-1.7 + i * 1.7, 4.2, 2.65); g.add(screen);
        }
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6.0, 8), MAT_LIGHT);
        mast.position.y = 8.5; g.add(mast);
        const radar = new THREE.Group();
        radar.position.y = 7.0; g.add(radar);
        const dish = new THREE.Mesh(
            new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI*2, 0, Math.PI/2),
            new THREE.MeshStandardMaterial({ color: 0x94a6bc, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide })
        );
        dish.scale.y = 0.4; dish.rotation.x = -Math.PI/3; radar.add(dish);
        spinners.push({ mesh: radar, speed: 1.5, axis: 'y' });
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), MAT_GLOW_RED);
        beacon.position.y = 11.5; g.add(beacon);
        spinners.push({ mesh: beacon, type: 'pulseBeacon', target: MAT_GLOW_RED });

    } else if (type === 'turret') {
        createBase(g, 2.0, 0.6);
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.5, 8), MAT_DARK);
        pillar.position.y = 1.85; pillar.castShadow = true; g.add(pillar);
        
        const head = new THREE.Group(); head.position.y = 3.2; head.name = 'turretHead'; g.add(head);
        
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 10, 0, Math.PI*2, 0, Math.PI/2), MAT_LIGHT);
        dome.castShadow = true; head.add(dome);
        
        barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 2.0, 8), MAT_DARK);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.4, 1.0); head.add(barrel);
        
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), MAT_GLOW_RED);
        eye.position.set(0, 0.4, 0.8); head.add(eye);

    } else if (type === 'nuclear') {
        createBase(g, 8.5, 2.0);
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.0, 6.0, 16), MAT_LIGHT);
        shell.position.y = 5.0; shell.castShadow = true; g.add(shell);
        const domeTop = new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 12, 0, Math.PI*2, 0, Math.PI/2), MAT_LIGHT);
        domeTop.position.y = 8.0; domeTop.castShadow = true; g.add(domeTop);
        
        [[-7.5, 0], [7.5, 0]].forEach(([x, z]) => {
            const cb = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.0, 0.8, 10), MAT_DARK);
            cb.position.set(x, 0.4, z); cb.castShadow = true; g.add(cb);
            const ct = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.5, 5.5, 12), MAT_LIGHT);
            ct.position.set(x, 3.5, z); ct.castShadow = true; g.add(ct);
            const ctop = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 1.5, 1.0, 12), MAT_DARK);
            ctop.position.set(x, 6.8, z); g.add(ctop);
            emitters.push({ pos: new THREE.Vector3(x, 7.2, z), color: 0xffffff, rate: 10 });
        });

        const coreMat = new THREE.MeshStandardMaterial({
            color: 0x0a2a1a, roughness: 0.1, metalness: 0.5,
            emissive: 0x00ff44, emissiveIntensity: 3.0, transparent: true, opacity: 0.9
        });
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(3.0, 1), coreMat);
        core.position.y = 5.5; g.add(core);
        spinners.push({ mesh: core, type: 'reactorPulse', target: coreMat });
        g.userData.reactorCore = coreMat;
        
        const bigRing = new THREE.Mesh(new THREE.TorusGeometry(4.0, 0.25, 12, 40), MAT_GLOW_GREEN);
        bigRing.rotation.x = Math.PI/2; bigRing.position.y = 5.5; g.add(bigRing);
        spinners.push({ mesh: bigRing, speed: 0.8, axis: 'z' });
        
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const light = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), MAT_GLOW_RED);
            light.position.set(Math.cos(a) * 8.8, 2.2, Math.sin(a) * 8.8); g.add(light);
        }
        emitters.push({ pos: new THREE.Vector3(0, 15.0, 0), color: 0x00ff44, rate: 8 });
    }

    g.userData.spinners = spinners;
    g.userData.emitters = emitters;
    g.userData.barrel = barrel;
    g.scale.setScalar(1.5);
    return g;
}

/* --- размещение --- */
const MIN_BUILD_DIST = 16;
let ghost = null, ghostType = null, ghostValid = false;
const ghostPos = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
export const ghostRing = new THREE.Mesh(
    new THREE.RingGeometry(MIN_BUILD_DIST - 0.2, MIN_BUILD_DIST, 56),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
);
ghostRing.rotation.x = -Math.PI / 2; ghostRing.visible = false;

export function initGhost(scene) { scene.add(ghostRing); }

export function canAfford(cost) { 
    if (state.creative) return true;
    for (const k in cost) if (state.res[k] < cost[k]) return false; 
    return true; 
}
export function payCost(cost) { 
    if (state.creative) return;
    for (const k in cost) state.res[k] -= cost[k]; 
}

function isValidPlacement(x, z) {
    if (Math.hypot(x, z) > WORLD_RADIUS - 12) return false;
    for (const b of state.buildings) if (Math.hypot(b.pos.x - x, b.pos.z - z) < MIN_BUILD_DIST) return false;
    for (const c of state.contamination) {
        if (Math.hypot(c.pos.x - x, c.pos.z - z) < c.radius) return false;
    }
    return true;
}

export function addBuilding(scene, type, x, z) {
    const mesh = createBuildingMesh(type);
    const y = terrainHeight(x, z);
    mesh.position.set(x, y, z); mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(mesh);
    state.buildings.push({
        type, mesh, pos: new THREE.Vector3(x, y, z),
        spinners: mesh.userData.spinners, emitters: mesh.userData.emitters,
        barrel: mesh.userData.barrel,
        hp: BUILDING_DEFS[type].hp, maxHp: BUILDING_DEFS[type].hp,
        heat: 0, overheatTimer: 0, active: false, cooldown: 0
    });
}

function makeGhost(type) {
    const obj = createBuildingMesh(type);
    obj.traverse(o => {
        if (o.isMesh) {
            o.material = o.material.clone();
            o.material.transparent = true; o.material.opacity = 0.42;
            o.material.depthWrite = false; o.castShadow = false; o.receiveShadow = false;
        }
    });
    return obj;
}

export function clearGhost() {
    if (ghost) {
        refs.scene.remove(ghost);
        ghost.traverse(o => { if (o.isMesh) o.material.dispose(); });
        ghost = null;
    }
    ghostType = null; ghostRing.visible = false;
}

export function setGhostType(type) {
    clearGhost();
    if (!type) return;
    ghostType = type;
    ghost = makeGhost(type); ghost.visible = false;
    refs.scene.add(ghost); ghostRing.visible = true;
}

export function updateGhostPosition(clientX, clientY, camera) {
    if (!ghost) return;
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    if (Math.abs(ray.direction.y) < 0.0001) return;

    let t = (0 - ray.origin.y) / ray.direction.y;
    if (t < 0) t = 1;
    let px = ray.origin.x + ray.direction.x * t, pz = ray.origin.z + ray.direction.z * t;
    for (let i = 0; i < 4; i++) {
        const h = terrainHeight(px, pz);
        const tt = (h - ray.origin.y) / ray.direction.y;
        if (tt < 0) break;
        px = ray.origin.x + ray.direction.x * tt;
        pz = ray.origin.z + ray.direction.z * tt;
    }
    if (Math.hypot(px, pz) > WORLD_RADIUS) { ghost.visible = false; ghostRing.visible = false; return; }

    const y = terrainHeight(px, pz);
    ghostPos.set(px, y, pz);
    ghost.position.copy(ghostPos); ghost.visible = true;
    ghostRing.position.set(px, y + 0.06, pz); ghostRing.visible = true;
    ghostValid = isValidPlacement(px, pz) && canAfford(BUILDING_DEFS[ghostType].cost);
    const col = ghostValid ? 0x54ff9e : 0xff5a5a;
    ghostRing.material.color.setHex(col);
    ghost.traverse(o => { if (o.isMesh) o.material.color.lerp(new THREE.Color(col), 0.35); });
}

export function tryPlace(clientX, clientY, camera) {
    if (!ghost || !ghostType) return;
    updateGhostPosition(clientX, clientY, camera);
    if (!ghost || !ghost.visible || !ghostValid) return;
    if (!canAfford(BUILDING_DEFS[ghostType].cost)) return;
    payCost(BUILDING_DEFS[ghostType].cost);
    addBuilding(refs.scene, ghostType, ghostPos.x, ghostPos.z);
    spawnBurst(ghostPos, 0x54ff9e, 22);
}

export function removeBuilding(b) {
    if (!b || b._removed) return;
    b._removed = true;
    refs.scene.remove(b.mesh);
    b.mesh.traverse(o => { if (o.isMesh) o.material.dispose(); });
    const i = state.buildings.indexOf(b);
    if (i >= 0) state.buildings.splice(i, 1);
}

/* ========================= АНИМАЦИЯ ЗДАНИЙ ========================= */
export function updateBuildingsVisual(dt, time) {
    const eff = state.energy.eff;
    const reactor = state.reactor;

    for (const b of state.buildings) {
        let shakeX = 0, shakeY = 0, shakeZ = 0;
        const isBroken = b.hp < b.maxHp * 0.3;

        if (b.type === 'nuclear' && (reactor.overheatPhase === 'shake' || isBroken)) {
            shakeX = (Math.random() - 0.5) * 0.8;
            shakeY = (Math.random() - 0.5) * 0.6;
            shakeZ = (Math.random() - 0.5) * 0.8;
            b.mesh.position.x = b.pos.x + shakeX;
            b.mesh.position.y = b.pos.y + shakeY;
            b.mesh.position.z = b.pos.z + shakeZ;
            
            if (Math.random() < 0.8) {
                const wp = new THREE.Vector3(0, 15.0, 0).applyMatrix4(b.mesh.matrixWorld);
                emitParticle(wp, isBroken ? 0xff0000 : 0xff5533, 3.0 + Math.random() * 2, 5 + Math.random() * 3, 2.0);
            }
        } else if (b.type === 'nuclear') {
            b.mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
        }

        // Турели стреляют
        if (b.type === 'turret' && state.enemies.length > 0) {
            let closest = null;
            let minDist = 60; // Радиус действия
            for (const e of state.enemies) {
                const d = b.pos.distanceTo(e.mesh.position);
                if (d < minDist) { minDist = d; closest = e; }
            }
            
            if (closest) {
                // Поворачиваем голову турели к врагу
                const head = b.mesh.getObjectByName('turretHead');
                if (head) {
                    const target = closest.mesh.position.clone();
                    target.y = 0; // Смотрим только по горизонтали
                    const localTarget = b.mesh.worldToLocal(target);
                    const targetYaw = Math.atan2(localTarget.x, localTarget.z);
                    head.rotation.y = lerpAngle(head.rotation.y, targetYaw, 1 - Math.exp(-10 * dt));
                }
                
                b.cooldown -= dt;
                if (b.cooldown <= 0 && state.res.alloys >= 1) {
                    b.cooldown = 0.3; // Скорострельность
                    state.res.alloys -= 1; // Тратим снаряд
                    
                    // Создаём снаряд
                    const pMesh = new THREE.Mesh(
                        new THREE.SphereGeometry(0.4, 8, 8),
                        new THREE.MeshBasicMaterial({ color: 0xffa53d })
                    );
                    pMesh.position.copy(b.pos).y += 4.5; // Высота ствола
                    refs.scene.add(pMesh);
                    state.projectiles.push({
                        mesh: pMesh,
                        target: closest,
                        speed: 60,
                        dmg: 25
                    });
                }
            }
        }

        for (const s of b.spinners) {
            if (s.type === 'pulse') { if (s.target) s.target.emissiveIntensity = 1.5 + Math.sin(time * 3) * 0.9; }
            else if (s.type === 'beamPulse') { if (s.target) s.target.opacity = 0.15 + Math.sin(time * 2.5) * 0.1; }
            else if (s.type === 'sweep') { s.mesh.rotation.y = Math.sin(time * 0.5) * 0.6; }
            else if (s.type === 'waterLevel') {
                if (s.target) {
                    const hasIce = state.res.ice > 0.5;
                    s.target.opacity = hasIce ? 0.7 + Math.sin(time * 3) * 0.15 : 0.3;
                }
            }
            else if (s.type === 'pulseBeacon') {
                if (s.target) s.target.color.setRGB(1, 0.2 + Math.sin(time * 6) * 0.3, 0.2);
            }
            else if (s.type === 'batteryGlow') {
                if (s.targets) {
                    const pct = state.batteries.capacity > 0 ? state.batteries.charge / state.batteries.capacity : 0;
                    const overload = state.batteries.overload;
                    for (const mat of s.targets) {
                        if (overload > 20) {
                            mat.color.setRGB(1, 0.2 + Math.sin(time * 25) * 0.2, 0.15);
                        } else {
                            mat.color.setRGB(0.1 + 0.4 * pct, 0.3 + 0.7 * pct, 0.2 + 0.3 * pct);
                        }
                    }
                }
            }
            else if (s.type === 'reactorPulse') {
                if (s.target) {
                    const heat = reactor.heat / 100;
                    if (reactor.overheatPhase === 'shake' || isBroken) {
                        s.target.emissiveIntensity = 4 + Math.sin(time * 30) * 2;
                        s.target.emissive.setHex(0xff0000);
                    } else {
                        s.target.emissiveIntensity = 2.0 + heat * 3 + Math.sin(time * 2) * 0.5;
                        s.target.emissive.setRGB(heat, 1 - heat * 0.7, 0.2 - heat * 0.2);
                    }
                }
            }
            else { s.mesh.rotation[s.axis] += s.speed * dt * (0.25 + 0.75 * eff); }
        }
        for (const em of b.emitters) {
            if (Math.random() < em.rate * dt) {
                const wp = em.pos.clone().applyMatrix4(b.mesh.matrixWorld);
                emitParticle(wp, em.color, 1.2 + Math.random() * 1.5, 3.0 + Math.random() * 2.5, 2.5 + Math.random() * 1.5);
            }
        }
    }
}

/* ========================= ВРАГИ (ИНОПЛАНЕТЯНЕ) ========================= */
export function spawnAlien(scene, waveCount) {
    const g = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: 0x22aa44, roughness: 0.5, metalness: 0.3, emissive: 0x004400, emissiveIntensity: 0.8 });
    const matEye = new THREE.MeshBasicMaterial({ color: 0xff0000 });

    // Тело
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), matBody);
    body.castShadow = true; g.add(body);
    
    // Глаза
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), matEye);
    e1.position.set(-0.6, 0.5, 1.2); g.add(e1);
    const e2 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), matEye);
    e2.position.set(0.6, 0.5, 1.2); g.add(e2);

    // Щупальца
    for (let i = 0; i < 4; i++) {
        const tent = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.0, 6), matBody);
        tent.position.set((i - 1.5) * 0.8, -1.2, 0);
        tent.rotation.x = Math.PI;
        g.add(tent);
    }

    // Спавн по краям карты
    const angle = Math.random() * Math.PI * 2;
    const r = 150 + Math.random() * 100;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const y = terrainHeight(x, z) + 15 + Math.random() * 20;
    
    g.position.set(x, y, z);
    g.castShadow = true;
    scene.add(g);

    state.enemies.push({
        mesh: g,
        hp: 50 + waveCount * 20,
        maxHp: 50 + waveCount * 20,
        speed: 8 + Math.random() * 4,
        dmg: 15
    });
}

export function updateEnemies(dt, scene) {
    for (let i = state.enemies.length - 1; i >= 0; i--) {
        const e = state.enemies[i];
        if (e.hp <= 0) {
            spawnBurst(e.mesh.position, 0x22aa44, 15);
            scene.remove(e.mesh);
            state.enemies.splice(i, 1);
            continue;
        }

        // Ищем ближайшую цель (здание или дрон)
        let targetPos = dronePos;
        let minDist = e.mesh.position.distanceTo(dronePos);
        
        for (const b of state.buildings) {
            const d = e.mesh.position.distanceTo(b.pos);
            if (d < minDist) {
                minDist = d;
                targetPos = b.pos;
            }
        }

        // Летим к цели
        const dir = targetPos.clone().sub(e.mesh.position).normalize();
        e.mesh.position.addScaledVector(dir, e.speed * dt);
        e.mesh.lookAt(targetPos);

        // Если близко — атакуем
        if (minDist < 6) {
            e.hp -= 15 * dt; // Враг тратит HP на атаку (или просто наносит урон и исчезает)
            if (targetPos === dronePos) {
                droneHP -= e.dmg * dt;
                state.dmgFlash = 1.0;
                if (droneHP <= 0) killDrone();
            } else {
                // Находим здание
                for (const b of state.buildings) {
                    if (b.pos.distanceTo(targetPos) < 1) {
                        b.hp -= e.dmg * dt;
                        if (b.hp <= 0) breakBuilding(b);
                        break;
                    }
                }
            }
        }
    }
}

export function updateProjectiles(dt, scene) {
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
        const p = state.projectiles[i];
        if (!p.target || p.target.hp <= 0) {
            scene.remove(p.mesh);
            state.projectiles.splice(i, 1);
            continue;
        }

        const targetPos = p.target.mesh.position;
        const dir = targetPos.clone().sub(p.mesh.position);
        const dist = dir.length();

        if (dist < 1.5) {
            // Попадание
            p.target.hp -= p.dmg;
            spawnBurst(targetPos, 0xffa53d, 5);
            scene.remove(p.mesh);
            state.projectiles.splice(i, 1);
        } else {
            dir.normalize();
            p.mesh.position.addScaledVector(dir, p.speed * dt);
        }
    }
}

/* ========================= ЛОГИКА ПОЛОМКИ ========================= */
export function breakBuilding(b) {
    if (!b || b._removed) return;
    
    // Если это реактор — ВЗРЫВ
    if (b.type === 'nuclear') {
        const pos = b.pos.clone();
        state.planetContaminated = true;
        state.terra.temp = Math.max(0, state.terra.temp - 30);
        state.terra.atmo = Math.max(0, state.terra.atmo - 30);
        state.terra.water = Math.max(0, state.terra.water - 30);
        
        for (let i = 0; i < 6; i++) spawnBurst(pos, 0xff2200, 60);
        
        state.contamination.push({ pos: pos.clone(), radius: 50 });
        
        // Сносим всё вокруг
        const toRemove = new Set();
        for (const ob of state.buildings) {
            if (ob.pos.distanceTo(pos) < 60) toRemove.add(ob);
        }
        if (dronePos.distanceTo(pos) < 120) killDrone();
        for (const ob of toRemove) removeBuilding(ob);
        
        state.reactor.heat = 0;
        state.reactor.active = false;
        state.reactor.overheatPhase = 'idle';
        return;
    }

    // Обычное здание
    spawnBurst(b.pos, 0xff4400, 15);
    refs.scene.remove(b.mesh);
    const i = state.buildings.indexOf(b);
    if (i >= 0) state.buildings.splice(i, 1);
}

export { droneRoot as droneRootRef };