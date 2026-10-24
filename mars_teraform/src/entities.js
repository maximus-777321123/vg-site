import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import {
    UP, clamp, damp, lerpAngle, terrainHeight, state, refs,
    BUILDING_DEFS, RES_INFO, WORLD_RADIUS
} from './core.js';
import { spawnBurst, emitParticle } from './world.js';

// ... (Дрон и узлы без изменений)

/* ========================= ЗДАНИЯ (ОГРОМНЫЕ) ========================= */
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
        createBase(g, 8.0, 2.0);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 10, 8), MAT_LIGHT);
        mast.position.y = 7.0; g.add(mast);
        
        const tracker = new THREE.Group(); tracker.position.y = 12.0; g.add(tracker);
        const panelMat = new THREE.MeshStandardMaterial({ color: 0x14315c, roughness: 0.1, metalness: 0.95, emissive: 0x0d3a72, emissiveIntensity: 1.2 });
        
        const p1 = new THREE.Mesh(new THREE.BoxGeometry(24.0, 0.5, 16.0), panelMat);
        p1.rotation.x = -0.45; p1.castShadow = true; tracker.add(p1);
        
        const frame = new THREE.Mesh(new THREE.BoxGeometry(24.6, 0.4, 16.6), MAT_LIGHT);
        frame.rotation.x = -0.45; frame.position.y = -0.1; tracker.add(frame);
        spinners.push({ mesh: tracker, type: 'sweep' });

    } else if (type === 'drill') {
        createBase(g, 10.0, 3.0);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(6.0, 7.0, 12.0, 12), MAT_LIGHT);
        body.position.y = 9.0; body.castShadow = true; g.add(body);
        
        const head = new THREE.Group(); head.position.y = 15.0; g.add(head);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 6.0, 12), MAT_LIGHT);
        shaft.position.y = 2.0; head.add(shaft);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(4.0, 8.0, 12), MAT_DARK);
        cone.position.y = 8.0; head.add(cone);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(2.0, 3.0, 12), MAT_GLOW_ORANGE);
        tip.position.y = 13.0; head.add(tip);
        spinners.push({ mesh: head, speed: 4.5, axis: 'y' });

    } else if (type === 'factory') {
        createBase(g, 15.0, 2.0);
        const hall = new THREE.Mesh(new RoundedBoxGeometry(25.0, 15.0, 20.0, 4, 0.5), MAT_LIGHT);
        hall.position.y = 9.5; hall.castShadow = true; hall.receiveShadow = true; g.add(hall);
        
        for (let i = -2; i <= 2; i++) {
            const w = new THREE.Mesh(new THREE.BoxGeometry(4.0, 3.0, 0.2), MAT_GLOW_ORANGE);
            w.position.set(i * 5, 10, 10.1); g.add(w);
        }
        [[-8.0, -7.0], [0, -7.0], [8.0, -7.0]].forEach(([x, z]) => {
            const chim = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.5, 18.0, 12), MAT_DARK);
            chim.position.set(x, 20.0, z); chim.castShadow = true; g.add(chim);
            emitters.push({ pos: new THREE.Vector3(x, 29.0, z), color: 0x909090, rate: 5 });
        });

    } else if (type === 'terraformer') {
        createBase(g, 20.0, 4.0);
        const mid = new THREE.Mesh(new THREE.CylinderGeometry(12.0, 16.0, 10.0, 6), MAT_LIGHT);
        mid.position.y = 9.0; mid.castShadow = true; g.add(mid);
        const upper = new THREE.Mesh(new THREE.CylinderGeometry(8.0, 10.0, 8.0, 6), MAT_LIGHT);
        upper.position.y = 18.0; upper.castShadow = true; g.add(upper);
        
        const coreMat = new THREE.MeshStandardMaterial({ color: 0x0e4a2a, roughness: 0.1, metalness: 0.5, emissive: 0x2bff88, emissiveIntensity: 2.5 });
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(7.0, 1), coreMat);
        core.position.y = 26.0; g.add(core);
        spinners.push({ mesh: core, speed: 1.0, axis: 'y' });
        spinners.push({ mesh: core, type: 'pulse', target: coreMat });
        
        const r1 = new THREE.Mesh(new THREE.TorusGeometry(12.0, 0.8, 12, 48), MAT_GLOW_GREEN);
        r1.position.y = 26.0; r1.rotation.x = Math.PI / 2 + 0.35; g.add(r1);
        spinners.push({ mesh: r1, speed: 1.4, axis: 'z' });
        
        const beamMat = new THREE.MeshBasicMaterial({ color: 0x6dffab, transparent: true, opacity: 0.2, depthWrite: false });
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 6.0, 100, 16, 1, true), beamMat);
        beam.position.y = 75.0; g.add(beam);
        spinners.push({ mesh: beam, type: 'beamPulse', target: beamMat });
        emitters.push({ pos: new THREE.Vector3(0, 26.0, 0), color: 0x6dffab, rate: 16 });

    } else if (type === 'powerPole') {
        createBase(g, 2.0, 0.5);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 20, 8), MAT_DARK);
        pole.position.y = 10.5; pole.castShadow = true; g.add(pole);
        
        const arm1 = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.3, 0.3), MAT_LIGHT);
        arm1.position.y = 18.0; g.add(arm1);
        const arm2 = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.3, 0.3), MAT_LIGHT);
        arm2.position.y = 15.0; g.add(arm2);
        
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 100, 4), MAT_GLOW_CYAN);
        wire.rotation.z = Math.PI / 2;
        wire.position.y = 18.0; g.add(wire);
        
    } else if (type === 'battery') {
        createBase(g, 10.0, 2.0);
        const cellMat = new THREE.MeshStandardMaterial({ color: 0x1e2330, roughness: 0.2, metalness: 0.8 });
        const glowMats = [];
        for (let i = 0; i < 3; i++) {
            const cell = new THREE.Mesh(new RoundedBoxGeometry(6.0, 12.0, 8.0, 4, 0.5), cellMat);
            cell.position.set(-8 + i * 8, 8, 0); cell.castShadow = true; g.add(cell);
            const glowMat = new THREE.MeshBasicMaterial({ color: 0x6dffab });
            const glow = new THREE.Mesh(new THREE.BoxGeometry(4.0, 10.0, 0.4), glowMat);
            glow.position.set(-8 + i * 8, 8, 4.2); g.add(glow);
            glowMats.push(glowMat);
        }
        spinners.push({ type: 'batteryGlow', targets: glowMats });
    } else if (type === 'turret') {
        createBase(g, 5.0, 1.0);
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.0, 6.0, 8), MAT_DARK);
        pillar.position.y = 4.0; pillar.castShadow = true; g.add(pillar);
        
        const head = new THREE.Group(); head.position.y = 7.0; head.name = 'turretHead'; g.add(head);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 10, 0, Math.PI*2, 0, Math.PI/2), MAT_LIGHT);
        dome.castShadow = true; head.add(dome);
        
        barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 6.0, 8), MAT_DARK);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.0, 3.0); head.add(barrel);
        
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), MAT_GLOW_RED);
        eye.position.set(0, 1.0, 2.5); head.add(eye);
    }

    g.userData.spinners = spinners;
    g.userData.emitters = emitters;
    g.userData.barrel = barrel;
    
    g.scale.setScalar(2.5); 
    return g;
}

// ... (Функции размещения и т.д. остаются)

/* ========================= ВРАГИ (ИНОПЛАНЕТЯНЕ) ========================= */
export function spawnAlien(scene, waveCount) {
    const g = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: 0x22aa44, roughness: 0.5, metalness: 0.3, emissive: 0x004400, emissiveIntensity: 0.8 });
    const matEye = new THREE.MeshBasicMaterial({ color: 0xff0000 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), matBody);
    body.castShadow = true; g.add(body);
    
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), matEye);
    e1.position.set(-0.6, 0.5, 1.2); g.add(e1);
    const e2 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), matEye);
    e2.position.set(0.6, 0.5, 1.2); g.add(e2);

    for (let i = 0; i < 4; i++) {
        const tent = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.0, 6), matBody);
        tent.position.set((i - 1.5) * 0.8, -1.2, 0);
        tent.rotation.x = Math.PI;
        g.add(tent);
    }

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
            
            // НАГРАДА ЗА УБИЙСТВО (Сундук)
            const loot = new THREE.Mesh(
                new THREE.BoxGeometry(1.5, 1.5, 1.5),
                new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.3, metalness: 0.8 })
            );
            loot.position.copy(e.mesh.position);
            loot.position.y = terrainHeight(loot.position.x, loot.position.z) + 0.75;
            scene.add(loot);
            
            // Сразу даем ресурсы, чтобы не заморачиваться с подбором
            const types = ['iron', 'silicon', 'carbon', 'ice'];
            const main = types[Math.floor(Math.random() * types.length)];
            state.res[main] += 30 + Math.floor(Math.random() * 30);
            types.forEach(t => { if (t !== main) state.res[t] += 10 + Math.floor(Math.random() * 15); });
            state.res.alloys += 5;
            
            scene.remove(e.mesh);
            state.enemies.splice(i, 1);
            continue;
        }

        let targetPos = dronePos;
        let minDist = e.mesh.position.distanceTo(dronePos);
        
        for (const b of state.buildings) {
            const d = e.mesh.position.distanceTo(b.pos);
            if (d < minDist) {
                minDist = d;
                targetPos = b.pos;
            }
        }

        const dir = targetPos.clone().sub(e.mesh.position).normalize();
        e.mesh.position.addScaledVector(dir, e.speed * dt);
        e.mesh.lookAt(targetPos);

        if (minDist < 6) {
            e.hp -= 15 * dt; 
            if (targetPos === dronePos) {
                state.dmgFlash = 1.0;
            } else {
                for (const b of state.buildings) {
                    if (b.pos.distanceTo(targetPos) < 1) {
                        b.hp -= e.dmg * dt;
                        if (b.hp <= 0) {
                            spawnBurst(b.pos, 0xff4400, 15);
                            removeBuilding(b);
                        }
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

export { droneRoot as droneRootRef };
