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
    spawnAlien, updateEnemies, updateProjectiles, breakBuilding
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

/* ============ СУЩНОСТИ ============ */
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
refs.controls = controls;

/* ============ ВВОД ============ */
const keys = {};
const menuEl = document.getElementById('buildMenu');

addEventListener('keydown', e => {
    if (e.code === 'Space') e.preventDefault();
    keys[e.code] = true;
    
    if (e.code === 'Escape') { 
        clearGhost(); state.selected = null; 
        menuEl.classList.remove('show'); 
    }
    if (e.code === 'KeyB') {
        menuEl.classList.toggle('show');
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
    if (e.button === 0) pointerDown = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', e => {
    if (e.button !== 0 || !pointerDown) return;
    const d = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
    pointerDown = null;
    if (d > 7) return;
    if (state.selected) tryPlace(e.clientX, e.clientY, camera);
});
renderer.domElement.addEventListener('pointermove', e => {
    if (state.selected) updateGhostPosition(e.clientX, e.clientY, camera);
});

/* ============ МЕНЮ ПОСТРОЙКИ ============ */
const menuGrid = document.getElementById('menuGrid');

function renderMenu() {
    const cards = menuGrid.querySelectorAll('.build-card');
    cards.forEach(c => c.remove());

    Object.keys(BUILDING_DEFS).forEach(type => {
        const def = BUILDING_DEFS[type];
        const affordable = canAfford(def.cost);
        
        const card = document.createElement('div');
        card.className = `build-card ${affordable || state.creative ? '' : 'disabled'}`;
        
        let reqText = '';
        if (type === 'nuclear') reqText = 'Требует: Система контроля, 2 Парогенератора, Помпа';
        if (type === 'terraformer') reqText = 'Требует: Лёд, Сплавы, Энергия';

        let outText = '';
        if (def.energy > 0) outText = `+${def.energy} энергии`;
        else if (def.energy < 0) outText = `-${-def.energy} энергии`;
        if (def.production) outText += ` | Производит: ${Object.entries(def.production).map(([k,v])=>`${k} ${v}/с`).join(', ')}`;
        if (def.terra) outText += ` | Терраформинг`;

        card.innerHTML = `
            <div class="bc-header">
                <span class="bc-name">${def.name}</span>
                ${state.creative ? '<span class="bc-cost" style="color:#6dffab">FREE</span>' : `<span class="bc-cost">${Object.entries(def.cost).map(([k,v]) => `${v} ${RES_INFO[k].short}`).join(' · ')}</span>`}
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

/* ============ UI ============ */
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
    
    const bc = state.batteries;
    if (bc.capacity > 0) {
        ui.battery.textContent = `${Math.floor(bc.charge)} / ${bc.capacity}${bc.overload > 5 ? ' ⚠' : ''}`;
        ui.batteryLine.style.display = 'flex';
        ui.batteryLine.classList.toggle('warn', bc.overload > 20);
    } else {
        ui.battery.textContent = '—';
        ui.batteryLine.style.display = 'none';
    }
    
    const reactor = state.buildings.find(b => b.type === 'nuclear');
    if (reactor) {
        ui.heat.textContent = `${Math.floor(state.reactor.heat)}%`;
        ui.heat.style.color = state.reactor.heat > 80 ? '#ff5a5a' : '#ffa53d';
        ui.heatLine.style.display = 'flex';
    } else {
        ui.heatLine.style.display = 'none';
    }

    if (state.reactor.overheatPhase === 'shake') {
        ui.eff.textContent = `☢ ПЕРЕГРЕВ! ${(8 - state.reactor.overheatTimer).toFixed(1)}с`;
        ui.eff.classList.add('warn');
    } else if (bc.overload > 20) {
        ui.eff.textContent = `⚠ ПЕРЕГРУЗ БАТАРЕЙ — ${(100 - bc.overload).toFixed(0)}%`;
        ui.eff.classList.add('warn');
    } else if (state.weather.storm) {
        ui.eff.textContent = `⚠ ПЫЛЬНАЯ БУРЯ`;
        ui.eff.classList.add('warn');
    } else if (cons > 0 && prod < cons) {
        ui.eff.textContent = `⚠ НЕХВАТКА ЭНЕРГИИ — ${(eff * 100).toFixed(0)}%`;
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
    state.weather.timer -= dt;
    if (state.weather.timer <= 0) {
        state.weather.storm = !state.weather.storm;
        state.weather.timer = state.weather.storm ? 15 : 45 + Math.random() * 30;
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
                reactorProd = 250;
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
    for (const b of state.buildings) if (b.type === 'battery') capacity += 500;
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

/* ============ ВОЛНЫ ВРАГОВ ============ */
function updateWaves(dt) {
    state.waveTimer -= dt;
    if (state.waveTimer <= 0) {
        state.waveCount++;
        state.waveTimer = 40 + Math.random() * 20;
        const count = 3 + state.waveCount * 2;
        for (let i = 0; i < count; i++) {
            setTimeout(() => spawnAlien(scene, state.waveCount), i * 1000);
        }
    }
}

/* ============ КАМЕРА ============ */
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
    camTarget.set(dronePos.x, dronePos.y + 1.5, dronePos.z);
    const d = camTarget.clone().sub(controls.target);
    d.multiplyScalar(1 - Math.exp(-7 * dt));
    controls.target.add(d);
    camera.position.add(d);
    controls.update();
}

/* ============ ОКРУЖЕНИЕ ============ */
function updateEnvironment() {
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

/* ============ ЦИКЛ ============ */
const clock = new THREE.Clock();
let uiTimer = 0;
let deathShown = false;

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    updateWeather(dt);
    updateWaves(dt);
    updateDrone(dt, t, keys, camera);
    updateNodes(dt);
    updateCrates(dt, t);
    updateEconomy(dt);
    updateEnemies(dt, scene);
    updateProjectiles(dt, scene);
    updateBuildingsVisual(dt, t);
    updateCamera(dt);
    updateEnvironment();
    updateDust(dt, t, dronePos);
    updateBursts(dt);
    updateSmoke(dt);
    applyTerraforming(t);

    // Урон от красной вспышки
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

/* ============ СТАРТ ============ */
addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

controls.target.copy(dronePos);
camera.position.set(dronePos.x + 25, dronePos.y + 18, dronePos.z + 25);
controls.update();

document.getElementById('restartBtn').addEventListener('click', () => location.reload());

updateUI();
animate();

setTimeout(() => {
    const l = document.getElementById('loading');
    l.classList.add('hide');
    setTimeout(() => l.remove(), 700);
}, 500);