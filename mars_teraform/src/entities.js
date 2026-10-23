import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import {
    UP, clamp, damp, lerpAngle, terrainHeight, state, refs,
    BUILDING_DEFS, RES_INFO, WORLD_RADIUS
} from './core.js';
import { spawnBurst, emitParticle } from './world.js';

// ... (Дрон и ресурсы оставляем как было)

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
        // Огромная солнечная станция
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
        // Гигантский бур
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
        // Огромный завод (как цех)
        createBase(g, 15.0, 2.0);
        
        const hall = new THREE.Mesh(new RoundedBoxGeometry(25.0, 15.0, 20.0, 4, 0.5), MAT_LIGHT);
        hall.position.y = 9.5; hall.castShadow = true; hall.receiveShadow = true; g.add(hall);
        
        // Окна
        for (let i = -2; i <= 2; i++) {
            const w = new THREE.Mesh(new THREE.BoxGeometry(4.0, 3.0, 0.2), MAT_GLOW_ORANGE);
            w.position.set(i * 5, 10, 10.1); g.add(w);
        }
        // Трубы
        [[-8.0, -7.0], [0, -7.0], [8.0, -7.0]].forEach(([x, z]) => {
            const chim = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.5, 18.0, 12), MAT_DARK);
            chim.position.set(x, 20.0, z); chim.castShadow = true; g.add(chim);
            emitters.push({ pos: new THREE.Vector3(x, 29.0, z), color: 0x909090, rate: 5 });
        });

    } else if (type === 'terraformer') {
        // Исполинский терраформер
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
        // Столб ЛЭП
        createBase(g, 2.0, 0.5);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 20, 8), MAT_DARK);
        pole.position.y = 10.5; pole.castShadow = true; g.add(pole);
        
        // Перекладины
        const arm1 = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.3, 0.3), MAT_LIGHT);
        arm1.position.y = 18.0; g.add(arm1);
        const arm2 = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.3, 0.3), MAT_LIGHT);
        arm2.position.y = 15.0; g.add(arm2);
        
        // Светящиеся провода (декор)
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 100, 4), MAT_GLOW_CYAN);
        wire.rotation.z = Math.PI / 2;
        wire.position.y = 18.0; g.add(wire);
        
    }
    // ... (Остальные здания: реактор, турели, помпы и т.д. можно оставить как есть, но с увеличенным масштабом)

    g.userData.spinners = spinners;
    g.userData.emitters = emitters;
    g.userData.barrel = barrel;
    
    // ГЛОБАЛЬНОЕ УВЕЛИЧЕНИЕ ВСЕХ МОДЕЛЕЙ
    g.scale.setScalar(2.5); 
    return g;
}
