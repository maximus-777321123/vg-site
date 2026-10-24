import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
    state, refs, BUILDING_DEFS, RES_INFO, WORLD_RADIUS, clamp, terrainHeight
} from './core.js';
import {
    initSky, initTerrain, initWater, initVegetation, initClouds,
    initDust, initSmoke, updateDust, updateBursts, updateSmoke,
    applyTerraforming, waterUniforms, spawnBurst, skyUniforms
} from './world.js';
import {
    initDrone, updateDrone, dronePos, droneRootRef, killDrone, isDroneDead,
    initNodes, updateNodes, initCrates, updateCrates,
    initGhost, ghostRing, setGhostType, clearGhost, updateGhostPosition,
    tryPlace, updateBuildingsVisual, canAfford, payCost, removeBuilding,
    spawnAlien, updateEnemies, updateProjectiles
} from './entities.js';

/* ============ СЦЕНА ============ */
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x6b3a24, 80, 420);
refs.scene = scene;

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 4000);
camera.position.set(28, 22, 28);
refs.camera = camera;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);
refs.renderer = renderer;

/* ============ СВЕТ ============ */
const hemi = new THREE.HemisphereLight(0xffb27a, 0x3a1508, 0.7);
scene.add(hemi); refs.hemi = hemi;

const sun = new THREE.DirectionalLight(0xffd9b0, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SR = 35;
Object.assign(sun.shadow.camera, { left: -SR, right: SR, top: SR, bottom: -SR, near: 1, far: 150 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun); scene.add(sun.target);
refs.sun = sun;

const rimLight = new THREE.DirectionalLight(0x5599ff, 0.7);
rimLight.position.set(-40, 24, -40);
scene.add(rimLight);

/* ============ МИР ============ */
initSky(scene);
initTerrain(scene);
initWater(scene);
initVegetation(scene);
initClouds(scene);
initDust(scene);
initSmoke(scene);

initDrone(scene);
initNodes(scene);
initCrates(scene);
initGhost(scene);

/* ============ КАМЕРА ============ */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 10;
controls.maxDistance = 65;
controls.minPolarAngle = 0.05;
controls.maxPolarAngle = Math.PI / 2 + 0.1;
controls.rotateSpeed = 0.7;
controls.enabled = false;
refs.controls = controls;

/* ============ ЛОКАЛЬНАЯ ФУНКЦИЯ РАЗРУШЕНИЯ ============ */
function breakBuilding(b) {
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
    removeBuilding(b);
}

/* ============ ВВОД ============ */
const keys = {};
const menuEl = document.getElementById('buildMenu');
const npcDialogEl = document.getElementById('npcDialog');
const subtitleEl = document.getElementById('subtitle');
const alienDialogEl = document.getElementById('alienDialog'); // Новый диалог

function showSubtitle(text, duration) {
    if (!subtitleEl) return;
    subtitleEl.textContent = text;
    subtitleEl.classList.add('show');
    setTimeout(() => subtitleEl.classList.remove('show'), duration);
}

addEventListener('keydown', e => {
    if (state.mode !== 'game') return;
    if (e.code === 'Space') e.preventDefault();
    keys[e.code] = true;
    
    if (e.code === 'Escape') { 
        clearGhost(); state.selected = null; 
        menuEl.classList.remove('show'); 
        npcDialogEl.classList.remove('show');
        if(alienDialogEl) alienDialogEl.classList.remove('show');
    }
    if (e.code === 'KeyB') {
        menuEl.classList.toggle('show');
    }
    if (e.code === 'KeyE') {
        // NPC
        let nearNPC = null;
        for (const npc of rovers) {
            if (dronePos.distanceTo(npc.mesh.position) < 15) {
                nearNPC = npc;
                break;
            }
        }
        if (nearNPC) {
            document.getElementById('npcName').textContent = nearNPC.name;
            document.getElementById('npcText').textContent = nearNPC.questText;
            npcDialogEl.classList.add('show');
        }
    }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function selectBuilding(type) {
    menuEl.classList.remove('show');
    if (state.selected === type) { clearGhost(); state.selected = null; }
    else { state.selected = type; setGhostType(type); }
}

let pointerDown = null;
renderer.domElement.addEventListener('pointerdown', e => {
    if (state.mode !== 'game') return;
    if (e.button === 0) pointerDown = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', e => {
    if (state.mode !== 'game' || e.button !== 0 || !pointerDown) return;
    const d = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
    pointerDown = null;
    if (d > 7) return;
    if (state.selected) tryPlace(e.clientX, e.clientY, camera);
});
renderer.domElement.addEventListener('pointermove', e => {
    if (state.mode === 'game' && state.selected) updateGhostPosition(e.clientX, e.clientY, camera);
});

/* ============ UI ============ */
const menuGrid = document.getElementById('menuGrid');

function renderMenu() {
    const cards = menuGrid.querySelectorAll('.build-card');
    cards.forEach(c => c.remove());

    Object.keys(BUILDING_DEFS).forEach(type => {
        const def = BUILDING_DEFS[type];
        const affordable = canAfford(def.cost);
        
        const costStr = Object.entries(def.cost)
            .map(([k, v]) => `${v} ${RES_INFO[k].name}`)
            .join(' · ');

        let reqText = '';
        if (type === 'nuclear') reqText = 'Требует: Система контроля, 2 Парогенератора, Помпа';
        if (type === 'terraformer') reqText = 'Требует: Лёд, Сплавы, Энергия';

        let outText = '';
        if (def.energy > 0) outText = `+${def.energy}⚡`;
        else if (def.energy < 0) outText = `-${-def.energy}⚡`;
        if (def.production) outText += ` | Производит: ${Object.entries(def.production).map(([k,v])=>`${k} ${v}/с`).join(', ')}`;
        if (def.terra) outText += ` | Терраформинг`;

        const card = document.createElement('div');
        card.className = `build-card ${affordable || state.creative ? '' : 'disabled'}`;
        
        card.innerHTML = `
            <div class="bc-header">
                <span class="bc-name">${def.name}</span>
                ${state.creative ? '<span class="bc-cost" style="color:#6dffab">БЕСПЛАТНО</span>' : `<span class="bc-cost">${costStr}</span>`}
            </div>
            <div class="bc-desc">${def.desc}</div>
            ${reqText ? `<div class="bc-req">${reqText}</div>` : ''}
            ${outText ? `<div class="bc-out">${outText}</div>` : ''}
        `;
        
        card.addEventListener('click', () => {
            if (!affordable && !state.creative) return;
            selectBuilding(type);
        });
        
        menuGrid.insertBefore(card, menuGrid.querySelector('.close-btn'));
    });
}

document.getElementById('btnMenu').addEventListener('click', () => {
    renderMenu();
    menuEl.classList.add('show');
});

/* ============ РЕЖИМ КРЕАТИВА ============ */
const btnCreative = document.getElementById('btnCreative');
btnCreative.addEventListener('click', () => {
    state.creative = !state.creative;
    btnCreative.classList.toggle('active', state.creative);
    if (state.creative) {
        Object.keys(state.res).forEach(k => state.res[k] = 99999);
    }
    renderMenu();
});

const ui = {
    iron: document.getElementById('ui-iron'),
    silicon: document.getElementById('ui-silicon'),
    carbon: document.getElementById('ui-carbon'),
    ice: document.getElementById('ui-ice'),
    water: document.getElementById('ui-water'),
    alloys: document.getElementById('ui-alloys'),
    energy: document.getElementById('ui-energy'),
    battery: document.getElementById('ui-battery'),
    heat: document.getElementById('ui-heat'),
    batteryLine: document.getElementById('batteryLine'),
    heatLine: document.getElementById('heatLine'),
    eff: document.getElementById('ui-eff'),
    barTemp: document.getElementById('bar-temp'),
    barAtmo: document.getElementById('bar-atmo'),
    barWater: document.getElementById('bar-water'),
    valTemp: document.getElementById('val-temp'),
    valAtmo: document.getElementById('val-atmo'),
    valWater: document.getElementById('val-water'),
    valTotal: document.getElementById('val-total'),
    objText: document.getElementById('objText')
};

function countType(t) { return state.buildings.filter(b => b.type === t).length; }

function updateUI() {
    if (state.mode !== 'game') return;
    
    if (state.creative) {
        Object.keys(state.res).forEach(k => state.res[k] = 99999);
    }

    ui.iron.textContent = Math.floor(state.res.iron);
    ui.silicon.textContent = Math.floor(state.res.silicon);
    ui.carbon.textContent = Math.floor(state.res.carbon);
    ui.ice.textContent = Math.floor(state.res.ice);
    ui.water.textContent = Math.floor(state.res.water);
    ui.alloys.textContent = Math.floor(state.res.alloys);

    const { prod, cons, eff } = state.energy;
    ui.energy.textContent = `${prod.toFixed(0)} / ${cons.toFixed(0)}`;
    
    if (state.reactor.overheatPhase === 'shake') {
        ui.eff.textContent = `☢ ПЕРЕГРЕВ! ${(8 - state.reactor.overheatTimer).toFixed(1)}с`;
        ui.eff.classList.add('warn');
    } else if (state.weather.storm) {
        ui.eff.textContent = `⚠ ПЫЛЬНАЯ БУРЯ`;
        ui.eff.classList.add('warn');
    } else if (cons > 0 && prod < cons) {
        ui.eff.textContent = `⚠ НЕХВАТКА ЭНЕРГИИ`;
        ui.eff.classList.add('warn');
    } else if (state.buildings.length > 0) {
        ui.eff.textContent = `✓ Сеть стабильна`;
        ui.eff.classList.remove('warn');
    } else {
        ui.eff.textContent = '';
        ui.eff.classList.remove('warn');
    }

    ui.barTemp.style.width = state.terra.temp + '%';
    ui.barAtmo.style.width = state.terra.atmo + '%';
    ui.barWater.style.width = state.terra.water + '%';
    ui.valTemp.textContent = Math.floor(state.terra.temp) + '%';
    ui.valAtmo.textContent = Math.floor(state.terra.atmo) + '%';
    ui.valWater.textContent = Math.floor(state.terra.water) + '%';

    const total = (state.terra.temp + state.terra.atmo + state.terra.water) / 3;
    ui.valTotal.textContent = Math.floor(total) + '%';

    let obj;
    if (state.enemies.length > 0) obj = `Отбивайте атаку! Врагов: ${state.enemies.length}`;
    else if (countType('solar') === 0) obj = 'Постройте солнечную панель [B]';
    else if (countType('drill') === 0) obj = 'Постройте бур [B]';
    else if (countType('turret') === 0) obj = 'Постройте турель для защиты [B]';
    else if (countType('iceExtractor') === 0) obj = 'Постройте ледяной экстрактор [B]';
    else if (countType('factory') === 0) obj = 'Постройте завод [B]';
    else if (countType('terraformer') === 0) obj = 'Постройте терраформер [B]';
    else obj = `Терраформируйте Марс: ${Math.floor(total)}% / 100%`;
    ui.objText.textContent = obj;
}

/* ============ ПОГОДА ============ */
function updateWeather(dt) {
    if (state.mode !== 'game') return;
    state.weather.timer -= dt;
    if (state.weather.timer <= 0) {
        state.weather.storm = !state.weather.storm;
        state.weather.timer = state.weather.storm ? 20 : 120 + Math.random() * 60;
        document.getElementById('weatherWarning').style.display = state.weather.storm ? 'block' : 'none';
    }
    const targetSun = state.weather.storm ? 0.5 : 2.5;
    const targetHemi = state.weather.storm ? 0.2 : 0.7;
    sun.intensity = THREE.MathUtils.lerp(sun.intensity, targetSun, dt * 2);
    hemi.intensity = THREE.MathUtils.lerp(hemi.intensity, targetHemi, dt * 2);
}

/* ============ ВЗРЫВЫ ============ */
function explodeBatteries() {
    if (state.creative) return;
    const bats = state.buildings.filter(b => b.type === 'battery');
    if (bats.length === 0) { state.batteries.overload = 0; return; }

    const spots = bats.map(b => ({ pos: b.pos.clone(), radius: 15 }));
    const toRemove = new Set();

    for (const bat of bats) {
        toRemove.add(bat);
        for (const b of state.buildings) {
            if (b !== bat && b.pos.distanceTo(bat.pos) < 15) toRemove.add(b);
        }
    }

    for (const s of spots) {
        if (dronePos.distanceTo(s.pos) < 20) killDrone();
    }

    for (const b of toRemove) removeBuilding(b);

    for (const s of spots) {
        state.contamination.push(s);
        spawnContaminationVisual(s.pos, s.radius);
        spawnBurst(s.pos, 0xff4400, 30);
    }

    state.batteries.charge = 0;
    state.batteries.overload = 0;
    state.batteries.capacity = 0;
}

function spawnContaminationVisual(pos, radius) {
    const geo = new THREE.CircleGeometry(radius, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
        color: 0x00ff44, transparent: true, opacity: 0.28,
        depthWrite: false, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, terrainHeight(pos.x, pos.z) + 0.15, pos.z);
    scene.add(mesh);
    
    const light = new THREE.PointLight(0x00ff44, 2.5, radius * 2);
    light.position.set(pos.x, terrainHeight(pos.x, pos.z) + 4, pos.z);
    scene.add(light);
}

/* ============ ЭКОНОМИКА ============ */
function updateEconomy(dt) {
    if (state.mode !== 'game') return;
    
    let prod = 0, cons = 0;
    const hasControl = countType('controlSys');
    const hasSteam = countType('steamGen');
    const hasPump = countType('waterPump');
    
    for (const b of state.buildings) {
        const def = BUILDING_DEFS[b.type];
        if (def.energy > 0) {
            if (state.weather.storm && b.type === 'solar') prod += def.energy * 0.2;
            else prod += def.energy;
        } else if (def.energy < 0) cons += -def.energy;
    }
    
    const reactor = state.buildings.find(b => b.type === 'nuclear');
    let reactorProd = 0;
    
    if (reactor && state.reactor.overheatPhase !== 'shake' && state.reactor.overheatPhase !== 'boom') {
        if (!state.reactor.active) {
            if (hasControl > 0 && hasSteam > 0 && hasPump > 0 && state.res.water > 5 && !state.planetContaminated) {
                state.reactor.active = true;
            }
        }
        
        if (state.reactor.active) {
            const waterNeed = 3.0 * dt;
            if (state.res.water >= waterNeed) {
                state.res.water -= waterNeed;
                const cooling = hasSteam * 15;
                const heatGen = 25;
                state.reactor.heat = clamp(state.reactor.heat + (heatGen - cooling) * dt, 0, 100);
                reactorProd = 1000; // Реактор дает 1000
            } else {
                state.reactor.heat = Math.min(100, state.reactor.heat + 25 * dt);
            }
            
            if (state.reactor.heat >= 100) {
                state.reactor.overheatPhase = 'shake';
                state.reactor.overheatTimer = 0;
                document.getElementById('reactorWarning').style.display = 'block';
            }
        }
    }
    
    if (state.reactor.overheatPhase === 'shake') {
        state.reactor.overheatTimer += dt;
        
        if (state.reactor.overheatTimer > 1 && state.batteries.capacity > 0) {
            explodeBatteries();
        }
        
        if (state.reactor.overheatTimer > 8) {
            state.reactor.overheatPhase = 'boom';
            if (reactor) breakBuilding(reactor);
            document.getElementById('reactorWarning').style.display = 'none';
        }
    }
    
    let capacity = 0;
    for (const b of state.buildings) if (b.type === 'battery') capacity += 2000; // Батарея 2000
    state.batteries.capacity = capacity;
    
    const totalProd = prod + reactorProd + state.batteries.charge;
    const eff = cons > 0 ? Math.min(1, totalProd / cons) : 1;
    const surplus = prod + reactorProd - cons * eff;
    
    if (surplus > 0.1) {
        if (capacity > 0) {
            const chargeRoom = capacity - state.batteries.charge;
            if (chargeRoom > 0.5) {
                const charge = Math.min(surplus * dt, chargeRoom);
                state.batteries.charge += charge;
                state.batteries.overload = Math.max(0, state.batteries.overload - dt * 25);
            } else {
                state.batteries.overload += dt * 22;
                if (state.batteries.overload >= 100) explodeBatteries();
            }
        } else if (reactorProd > 0) {
            state.batteries.overload += dt * 20;
            if (state.batteries.overload >= 100) explodeBatteries();
        } else {
            state.batteries.overload = Math.max(0, state.batteries.overload - dt * 40);
        }
    } else if (surplus < -0.1) {
        state.batteries.charge = Math.max(0, state.batteries.charge + surplus * dt);
        state.batteries.overload = Math.max(0, state.batteries.overload - dt * 40);
    } else {
        state.batteries.overload = Math.max(0, state.batteries.overload - dt * 40);
    }
    
    state.energy = { prod: prod + reactorProd, cons, eff };
    
    for (const b of state.buildings) {
        const def = BUILDING_DEFS[b.type];
        let run = true;
        if (def.consumes) for (const k in def.consumes) if (state.res[k] < def.consumes[k] * eff * dt) { run = false; break; }
        if (def.production && run) {
            for (const k in def.production) state.res[k] += def.production[k] * eff * dt;
            if (def.consumes) for (const k in def.consumes) state.res[k] -= def.consumes[k] * eff * dt;
        }
        if (def.terra && run) {
            state.terra.temp = Math.min(100, state.terra.temp + def.terra.temp * eff * dt);
            state.terra.atmo = Math.min(100, state.terra.atmo + def.terra.atmo * eff * dt);
            state.terra.water = Math.min(100, state.terra.water + def.terra.water * eff * dt);
            if (def.consumes) for (const k in def.consumes) state.res[k] -= def.consumes[k] * eff * dt;
        }
    }
}

/* ============ ДИПЛОМАТИЯ И ВОЛНЫ ============ */
let alienShipSpawned = false;

function updateWaves(dt) {
    if (state.mode !== 'game') return;
    
    // Если войны нет, раз в 60 секунд прилетает корабль-посол (только 1 раз)
    if (!state.warActive && !alienShipSpawned && state.gameTime > 60) {
        alienShipSpawned = true;
        spawnAlienShip(scene);
    }

    // Если война идет, спавним врагов реже (раз в 3 минуты)
    if (state.warActive) {
        state.waveTimer -= dt;
        if (state.waveTimer <= 0) {
            state.waveCount++;
            state.waveTimer = 180; 
            const count = 3 + Math.floor(state.waveCount * 0.5);
            for (let i = 0; i < count; i++) {
                setTimeout(() => spawnAlien(scene, state.waveCount), i * 3000);
            }
        }
    }
}

function spawnAlienShip(scene) {
    const g = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: 0x8888ff, roughness: 0.2, metalness: 0.8, emissive: 0x111133 });
    
    const hull = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), matBody);
    hull.scale.y = 0.5;
    hull.castShadow = true; g.add(hull);
    
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 12, 0, Math.PI*2, 0, Math.PI/2), new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 }));
    dome.position.y = 2; g.add(dome);

    // Позиция над дроном
    const x = dronePos.x + 30;
    const z = dronePos.z + 30;
    g.position.set(x, terrainHeight(x, z) + 40, z);
    scene.add(g);
    
    state.alienShip = g;
    
    // Показываем диалог
    showSubtitle("Внимание! Обнаружен корабль пришельцев.", 3000);
    
    setTimeout(() => {
        if (document.getElementById('alienDialog')) {
            document.getElementById('alienDialog').classList.add('show');
        }
    }, 2000);
}

// Обработка кнопок в диалоге пришельцев
document.getElementById('btnWar')?.addEventListener('click', () => {
    document.getElementById('alienDialog').classList.remove('show');
    state.warActive = true;
    showSubtitle("Вы объявили войну! Пришельцы в ярости.", 3000);
});

document.getElementById('btnPeace')?.addEventListener('click', () => {
    document.getElementById('alienDialog').classList.remove('show');
    showSubtitle("Вы заключили мир. Пришельцы улетели.", 3000);
    if (state.alienShip) {
        scene.remove(state.alienShip);
        state.alienShip = null;
    }
});


/* ============ NPC (Марсоходы) ============ */
const rovers = [];
function initNPCs() {
    for (let i = 0; i < 3; i++) {
        const g = new THREE.Group();
        const matBody = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
        const matWheel = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
        
        const body = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 6), matBody);
        body.position.y = 2; body.castShadow = true; g.add(body);
        
        for(let j=0; j<4; j++) {
            const w = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.5, 12), matWheel);
            w.rotation.z = Math.PI/2;
            w.position.set((j<2?1:-1)*2.2, 1, (j%2===0?2:-2));
            g.add(w);
        }
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2, 8), matWheel);
        ant.position.set(0, 4, 0); g.add(ant);
        const dish = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), matBody);
        dish.position.set(0, 5, 0); g.add(dish);
        
        const x = (Math.random() - 0.5) * 200;
        const z = (Math.random() - 0.5) * 200;
        g.position.set(x, terrainHeight(x, z), z);
        scene.add(g);
        
        rovers.push({
            mesh: g,
            name: `Марсоход "Кьюриосити-${i+1}"`,
            questText: "Привет, дрон. Мне нужна помощь с энергоснабжением. Построй солнечную панель и соедини её с базой с помощью ЛЭП.",
            targetPos: new THREE.Vector3(x + (Math.random()-0.5)*50, 0, z + (Math.random()-0.5)*50)
        });
    }
}

function updateNPCs(dt) {
    for (const r of rovers) {
        if (r.mesh.position.distanceTo(r.targetPos) < 2) {
            r.targetPos.set(
                (Math.random() - 0.5) * 200,
                0,
                (Math.random() - 0.5) * 200
            );
        }
        const dir = r.targetPos.clone().sub(r.mesh.position);
        dir.y = 0;
        if (dir.length() > 1) {
            dir.normalize();
            r.mesh.position.addScaledVector(dir, 3 * dt);
            r.mesh.position.y = terrainHeight(r.mesh.position.x, r.mesh.position.z);
            r.mesh.lookAt(r.mesh.position.clone().add(dir));
        }
    }
}

/* ============ КАТСЦЕНА ============ */
let cinematicStage = 0;
let cinematicTimer = 0;
let marsPlanet = null;
let spaceScene = null;
let spaceCamera = null;

function initSpaceScene() {
    spaceScene = new THREE.Scene();
    spaceCamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100000);

    const starGeo = new THREE.BufferGeometry();
    const starCount = 5000;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        starPos[i*3] = (Math.random() - 0.5) * 50000;
        starPos[i*3+1] = (Math.random() - 0.5) * 50000;
        starPos[i*3+2] = (Math.random() - 0.5) * 50000;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starField = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 3, transparent: true, opacity: 0.8 }));
    spaceScene.add(starField);

    function createMarsTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#9a4b2a'; ctx.fillRect(0, 0, 1024, 512);
        ctx.fillStyle = '#4a2114';
        for (let i = 0; i < 200; i++) {
            ctx.beginPath(); ctx.arc(Math.random()*1024, Math.random()*512, Math.random()*40+10, 0, Math.PI*2); ctx.fill();
        }
        return new THREE.CanvasTexture(canvas);
    }
    const marsGeo = new THREE.SphereGeometry(5000, 64, 64);
    const marsMat = new THREE.MeshStandardMaterial({ map: createMarsTexture(), roughness: 0.9 });
    marsPlanet = new THREE.Mesh(marsGeo, marsMat);
    marsPlanet.position.set(0, 0, -15000); 
    spaceScene.add(marsPlanet);

    const backLight = new THREE.DirectionalLight(0xffaa88, 3.0);
    backLight.position.set(0, 0, -20000);
    spaceScene.add(backLight);
    spaceScene.add(new THREE.AmbientLight(0x111122, 1.5));
}

function startCinematic() {
    state.mode = 'cinematic';
    document.getElementById('mainMenu').classList.add('hide');
    initSpaceScene();
    showSubtitle("Марс. Спустя годы после крушения...", 5000);
    cinematicStage = 1;
    cinematicTimer = 0;
}

function updateCinematic(dt) {
    cinematicTimer += dt;

    if (cinematicStage === 1) {
        marsPlanet.rotation.y += dt * 0.05;
        
        if (cinematicTimer > 5) {
            renderer.toneMappingExposure = 5.0;
            setTimeout(() => { renderer.toneMappingExposure = 1.15; }, 500);
            
            controls.target.copy(dronePos);
            camera.position.set(dronePos.x + 25, dronePos.y + 18, dronePos.z + 25);
            controls.update();
            
            state.mode = 'game';
            controls.enabled = true;
            document.getElementById('hud').classList.add('active');
            cinematicStage = 2;
            
            spawnCrashSite();
        }
    }
}

/* ============ МЕСТО КРУШЕНИЯ ============ */
function spawnCrashSite() {
    const r = new THREE.Group();
    
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4, metalness: 0.5 });
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 15, 32), matWhite);
    body.castShadow = true;
    r.add(body);
    
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.0, 6, 32), matWhite);
    nose.position.y = 10.5;
    r.add(nose);
    
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 2, 16), matBlack);
    eng.position.y = -8.5;
    r.add(eng);

    r.rotation.z = Math.PI / 1.5; 
    r.rotation.x = 0.2; 
    
    const x = dronePos.x + 25;
    const z = dronePos.z + 15;
    const groundY = terrainHeight(x, z);
    
    r.position.set(x, groundY + 6, z);
    scene.add(r);

    for (let i = 0; i < 12; i++) {
        const lootX = x + (Math.random() - 0.5) * 25;
        const lootZ = z + (Math.random() - 0.5) * 25;
        const lootMesh = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 1.5, 1.5),
            new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.3, metalness: 0.8 })
        );
        lootMesh.position.set(lootX, terrainHeight(lootX, lootZ) + 0.75, lootZ);
        lootMesh.castShadow = true;
        scene.add(lootMesh);
    }
}

document.getElementById('btnStart').addEventListener('click', startCinematic);

/* ============ ЦИКЛ ============ */
const clock = new THREE.Clock();
let uiTimer = 0;
let deathShown = false;

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    if (state.mode === 'menu') {
        camera.position.x = Math.sin(t * 0.1) * 30;
        camera.position.z = Math.cos(t * 0.1) * 30;
        camera.position.y = 15;
        camera.lookAt(0, 5, 0);
        renderer.render(scene, camera);
    } else if (state.mode === 'cinematic') {
        updateCinematic(dt);
        renderer.render(spaceScene, spaceCamera);
    } else if (state.mode === 'game') {
        updateWeather(dt);
        updateWaves(dt);
        updateDrone(dt, t, keys, camera);
        updateNodes(dt);
        updateCrates(dt, t);
        updateEconomy(dt);
        updateEnemies(dt, scene);
        updateProjectiles(dt, scene);
        updateBuildingsVisual(dt, t);
        updateNPCs(dt);
        updateCamera(dt);
        updateEnvironment();
        updateDust(dt, t, dronePos);
        updateBursts(dt);
        updateSmoke(dt);
        applyTerraforming(t);

        if (state.dmgFlash > 0) {
            state.dmgFlash -= dt * 2;
            renderer.domElement.style.boxShadow = `inset 0 0 100px rgba(255, 0, 0, ${state.dmgFlash * 0.8})`;
        } else {
            renderer.domElement.style.boxShadow = 'none';
        }

        waterUniforms.time.value = t;

        if (!deathShown && isDroneDead()) {
            deathShown = true;
            document.getElementById('deathScreen').classList.add('show');
        }

        uiTimer += dt;
        if (uiTimer > 0.08) { 
            uiTimer = 0; 
            updateUI(); 
        }

        renderer.render(scene, camera);
    }
}

/* ============ КАМЕРА ============ */
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
    if (state.mode !== 'game') return;
    camTarget.set(dronePos.x, dronePos.y + 1.5, dronePos.z);
    const d = camTarget.clone().sub(controls.target);
    d.multiplyScalar(1 - Math.exp(-7 * dt));
    controls.target.add(d);
    camera.position.add(d);
    controls.update();
}

/* ============ ОКРУЖЕНИЕ ============ */
function updateEnvironment() {
    if (state.mode !== 'game') return;
    sun.position.set(dronePos.x + 20, dronePos.y + 40, dronePos.z + 20);
    sun.target.position.copy(dronePos);
    sun.target.updateMatrixWorld();
    
    const sunDir = sun.position.clone().sub(dronePos).normalize();
    skyUniforms.sunDirection.value.copy(sunDir);

    scene.children.forEach(o => {
        if (o.geometry && o.geometry.type === 'SphereGeometry' && o.material.type === 'ShaderMaterial') {
            o.position.copy(camera.position);
        }
    });
    
    if (state.planetContaminated) {
        scene.fog.color.lerp(new THREE.Color(0x00ff44), 0.15);
    }
}

/* ============ СТАРТ ============ */
addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    if(spaceCamera) {
        spaceCamera.aspect = innerWidth / innerHeight;
        spaceCamera.updateProjectionMatrix();
    }
    renderer.setSize(innerWidth, innerHeight);
});

camera.position.set(0, 15, 30);
camera.lookAt(0, 5, 0);

document.getElementById('restartBtn').addEventListener('click', () => location.reload());

initNPCs();

animate();

setTimeout(() => {
    const l = document.getElementById('loading');
    l.classList.add('hide');
    setTimeout(() => l.remove(), 700);
}, 500);
