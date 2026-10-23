import * as THREE from 'three';

export const UP = new THREE.Vector3(0, 1, 0);
export const clamp = THREE.MathUtils.clamp;
export const smoothstep = THREE.MathUtils.smoothstep;
export const damp = (a, b, l, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-l * dt));

export function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

function hash2(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
}
function vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}
export function fbm(x, y) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < 4; i++) { v += amp * vnoise(x * f, y * f); amp *= 0.5; f *= 2; }
    return v;
}

export const WORLD_RADIUS = 1000;
export const MAP_SIZE = 3000;
export const WATER_BASE = -8;
export const WATER_MAX = 0;

export const RES_INFO = {
    iron:    { short: 'Fe',    color: 0xc07a4a },
    silicon: { short: 'Si',    color: 0xb9c9dc },
    carbon:  { short: 'C',     color: 0x5a5a68 },
    ice:     { short: 'H₂O',   color: 0x7fd8ff },
    water:   { short: 'W',     color: 0x4fc3f7 },
    alloys:  { short: 'Alloy', color: 0xffc94a }
};

export const BUILDING_DEFS = {
    solar: { 
        name: 'Солнечная панель', cost: { silicon: 4, iron: 3 }, energy: 25, hp: 100,
        desc: 'Базовый генератор энергии. Не работает во время бурь.' 
    },
    drill: { 
        name: 'Бур', cost: { iron: 8, silicon: 5 }, energy: -5, hp: 150,
        production: { iron: 0.8, silicon: 0.5, carbon: 0.3 }, 
        desc: 'Автоматически добывает железо, кремний и углерод.' 
    },
    iceExtractor: { 
        name: 'Ледяной экстрактор', cost: { iron: 6, silicon: 4 }, energy: -5, hp: 120,
        production: { ice: 0.7 }, 
        desc: 'Добывает лёд из марсианской почвы.' 
    },
    factory: { 
        name: 'Завод', cost: { iron: 20, silicon: 12, carbon: 10 }, energy: -20, hp: 300,
        production: { alloys: 0.4 }, consumes: { iron: 0.8, carbon: 0.5 }, 
        desc: 'Сплавляет железо и углерод в прочные сплавы.' 
    },
    terraformer: { 
        name: 'Терраформер', cost: { iron: 35, silicon: 25, carbon: 20, ice: 15, alloys: 10 }, 
        energy: -35, hp: 500, consumes: { ice: 0.5, alloys: 0.2 }, 
        terra: { temp: 0.25, atmo: 0.25, water: 0.25 }, 
        desc: 'Главный инструмент. Повышает температуру, атмосферу и воду.' 
    },
    waterPump: { 
        name: 'Водяная помпа', cost: { iron: 12, silicon: 6, alloys: 3 }, energy: -15, hp: 100,
        production: { water: 1.5 }, consumes: { ice: 1.0 }, 
        desc: 'Превращает лёд в воду.' 
    },
    steamGen: { 
        name: 'Парогенератор', cost: { iron: 18, silicon: 8, alloys: 4 }, energy: -8, hp: 200,
        desc: 'Охлаждает ядерный реактор.' 
    },
    battery: { 
        name: 'Батарея', cost: { iron: 15, silicon: 10, carbon: 8 }, energy: 0, hp: 80, storage: 500,
        desc: 'Буфер энергии (до 500). Взрывается при перегрузке!' 
    },
    controlSys: { 
        name: 'Система контроля', cost: { silicon: 20, carbon: 12, alloys: 6 }, energy: -12, hp: 150,
        desc: 'Обязательна для запуска ядерного реактора.' 
    },
    turret: {
        name: 'Турель', cost: { iron: 15, alloys: 5 }, energy: -10, hp: 200,
        desc: 'Автоматически стреляет по пришельцам, тратя сплавы.'
    },
    nuclear: { 
        name: 'ЯДЕРНЫЙ РЕАКТОР', cost: { iron: 80, silicon: 50, carbon: 30, alloys: 25 }, energy: 0, hp: 400,
        desc: 'Даёт +250 энергии. Взрывается при 0 HP или перегреве!' 
    }
};

export function terrainHeight(x, z) {
    const d = Math.hypot(x, z);
    const base = fbm(x * 0.004, z * 0.004);
    const mid = fbm(x * 0.018 + 5, z * 0.018 + 3);
    const detail = fbm(x * 0.07 + 11, z * 0.07 + 7);
    let h = (base - 0.5) * 6 + (mid - 0.5) * 2 + (detail - 0.5) * 0.4;
    const ridge = 1 - Math.abs(fbm(x * 0.0035 + 23, z * 0.0035 + 19) - 0.5) * 2;
    h += Math.pow(Math.max(0, ridge), 10) * 20;
    const flat = smoothstep(d, 30, 120);
    return h * (0.06 + 0.94 * flat);
}

export const state = {
    res: { iron: 8, silicon: 6, carbon: 4, ice: 2, water: 0, alloys: 0 },
    buildings: [],
    enemies: [],        // <-- ДОБАВЛЕНО
    projectiles: [],    // <-- ДОБАВЛЕНО
    energy: { prod: 0, cons: 0, eff: 1 },
    terra: { temp: 0, atmo: 0, water: 0 },
    selected: null,
    droneDead: false,
    creative: false,
    startTime: performance.now(),
    weather: { storm: false, timer: 45 },
    batteries: { charge: 0, capacity: 0, overload: 0 },
    reactor: { heat: 0, active: false, overheatPhase: 'idle', overheatTimer: 0 },
    contamination: [],
    planetContaminated: false,
    waveTimer: 30,
    waveCount: 0,
    dmgFlash: 0
};

export const refs = {};