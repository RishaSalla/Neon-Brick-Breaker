/* =========================================================================
   إعدادات شريط التسويق والهوية (Configurable Branding)
   ========================================================================= */
const PROMO_CONFIG = {
    showBanner: true,
    text: "استكشف أحدث الألعاب والمنتجات الرقمية على ريشة!",
    buttonText: "زيارة المتجر",
    url: "https://www.risha.sa"
};

/* =========================================================================
   الثوابت الأساسية وأبعاد المحرك الافتراضية
   ========================================================================= */
const GAME_WIDTH = 480;
const GAME_HEIGHT = 800;
const PHYSICS_STEPS = 4; // Sub-stepping لمنع اختراق الكتل (Anti-Tunneling)
const MIN_BALL_VY = 80;  // الحد الأدنى للسرعة الرأسية لمنع الانحباس الأفقي
const PADDLE_Y = 700;

/* =========================================================================
   نظام الصوت (Web Audio API Synthesizer) - صفر أصول خارجية
   ========================================================================= */
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.enabled = false;
    }
    init() {
        if (!this.ctx) {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.enabled = true;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }
    playTone(freq, type, duration, vol = 0.1) {
        if (!this.enabled || !this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }
    playHitPaddle() { this.playTone(400, 'sine', 0.1, 0.3); }
    playHitBrick() { this.playTone(600, 'square', 0.1, 0.2); }
    playHitArmor() { this.playTone(200, 'sawtooth', 0.15, 0.3); }
    playExplosion() { this.playTone(100, 'square', 0.4, 0.4); }
    playPowerupSpawn() { this.playTone(800, 'sine', 0.2, 0.1); }
    playPowerupCatch() { this.playTone(1200, 'sine', 0.3, 0.3); }
    playLaser() { this.playTone(900, 'sawtooth', 0.1, 0.1); }
    playLoseLife() { this.playTone(150, 'sawtooth', 0.5, 0.5); }
    playWin() { 
        this.playTone(400, 'sine', 0.2, 0.2);
        setTimeout(() => this.playTone(600, 'sine', 0.4, 0.2), 200);
    }
}
const audio = new AudioEngine();

/* =========================================================================
   توليد الـ 25 مرحلة باستخدام محلل نصوص (Map Parser)
   0: فارغ | 1: عادي | 2: مدرع (ضربتان) | 3: متفجر
   ========================================================================= */
const rawMaps = [
    ["0111110","0111110"],                                      // 1
    ["1111111","1000001","1111111"],                            // 2
    ["1121211","0111110","0011100"],                            // 3
    ["0300030","1111111","1111111","1111111"],                  // 4
    ["2222222","1111111","1111111","2222222"],                  // 5
    ["1010101","0101010","1010101","0101010"],                  // 6
    ["2113112","2111112","2111112"],                            // 7
    ["1100011","1103011","1100011","2222222"],                  // 8
    ["1111111","2222222","3333333","1111111"],                  // 9
    ["2000002","0200020","0020200","0002000","1111111"],        // 10
    ["3111113","1222221","1233321","1222221"],                  // 11
    ["1020301","0102030","0010203","3020100"],                  // 12
    ["2223222","1111111","2222222","1111111","2223222"],        // 13
    ["1111111","1333331","1311131","1333331","1111111"],        // 14
    ["2020202","0303030","2020202","0303030","2020202"],        // 15
    ["1122211","1133311","1122211","1111111","2222222"],        // 16
    ["3002003","0302030","0032300","2222222","1111111"],        // 17
    ["2222222","2111112","2133312","2111112","2222222"],        // 18
    ["1313131","3131313","1313131","3131313","2222222"],        // 19
    ["2200022","2203022","2200022","1111111","1111111"],        // 20
    ["1231231","1231231","1231231","1231231","1231231"],        // 21
    ["3333333","2222222","1111111","2222222","3333333"],        // 22
    ["2113112","1213121","1123211","1112111","3333333"],        // 23
    ["3000003","0200020","0010100","0003000","2222222","1111111"],// 24
    ["3232323","2323232","3232323","2323232","3232323","1111111"] // 25
];

const LEVELS_DATA = rawMaps.map((mapRows, index) => {
    let bricks = [];
    const cols = 7;
    const blockW = 60, blockH = 25, pad = 5;
    const startX = (GAME_WIDTH - (cols * (blockW + pad))) / 2 + pad/2;
    const startY = 80;

    mapRows.forEach((row, r) => {
        for(let c = 0; c < row.length; c++) {
            const type = parseInt(row[c]);
            if (type > 0) {
                bricks.push({
                    x: startX + c * (blockW + pad),
                    y: startY + r * (blockH + pad),
                    w: blockW, h: blockH,
                    type: type,
                    hp: type === 2 ? 2 : 1
                });
            }
        }
    });
    return { id: index + 1, bricks, baseSpeed: 300 + (index * 10) };
});

/* =========================================================================
   محرك اللعبة (الفيزياء، الكيانات، الإدخال)
   ========================================================================= */
class GameEngine {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = GAME_WIDTH;
        this.canvas.height = GAME_HEIGHT;
        
        this.state = 'MENU'; // MENU, PLAYING, PAUSED, OVER, READY
        this.currentLevel = 1;
        this.score = 0;
        this.lives = 3;
        this.starsData = JSON.parse(localStorage.getItem('neonBrick_progress')) || {};
        
        // الكيانات
        this.paddle = { x: 200, w: 80, h: 15, vx: 0, speed: 500 };
        this.balls = [];
        this.bricks = [];
        this.powerups = [];
        this.particles = [];
        this.lasers = [];
        
        // المؤقتات للـ Power-ups
        this.activePowers = {
            wide: 0, fire: 0, laser: 0, shield: 0
        };
        this.laserTimer = 0;
        
        this.keys = { left: false, right: false };
        this.touchX = null;
        this.lastTime = 0;
        this.animFrame = null;
        
        this.setupInputs();
        this.updateHUD();
        this.renderLevelGrid();
        this.initPromoBanner();
    }

    /* --- الإعدادات والإدخال --- */
    initPromoBanner() {
        if(PROMO_CONFIG.showBanner) {
            document.getElementById('promo-banner-container').classList.remove('hidden');
            document.getElementById('promo-text').textContent = PROMO_CONFIG.text;
            const link = document.getElementById('promo-link');
            link.textContent = PROMO_CONFIG.buttonText;
            link.href = PROMO_CONFIG.url;
            document.getElementById('promo-close').onclick = () => {
                document.getElementById('promo-banner-container').style.display = 'none';
            };
        }
    }

    setupInputs() {
        // لوحة المفاتيح
        window.addEventListener('keydown', e => {
            if(e.key === 'ArrowLeft' || e.key === 'a') this.keys.left = true;
            if(e.key === 'ArrowRight' || e.key === 'd') this.keys.right = true;
        });
        window.addEventListener('keyup', e => {
            if(e.key === 'ArrowLeft' || e.key === 'a') this.keys.left = false;
            if(e.key === 'ArrowRight' || e.key === 'd') this.keys.right = false;
        });

        // تحويل الإحداثيات (Virtual Resolution Mapping)
        const getMappedX = (clientX) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = GAME_WIDTH / rect.width;
            return (clientX - rect.left) * scaleX;
        };

        // الماوس واللمس
        const handleMove = (e) => {
            if (this.state !== 'PLAYING') return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const mappedX = getMappedX(clientX);
            this.paddle.x = mappedX - this.paddle.w / 2;
            this.clampPaddle();
        };

        this.canvas.addEventListener('mousemove', handleMove);
        this.canvas.addEventListener('touchmove', handleMove, {passive: false});
        
        // الأزرار و الـ UI
        document.getElementById('btn-play-menu').onclick = () => this.showScreen('screen-level-select');
        document.getElementById('btn-back-menu').onclick = () => this.showScreen('screen-main-menu');
        document.getElementById('btn-pause').onclick = () => this.pauseGame();
        document.getElementById('btn-resume').onclick = () => this.resumeGame();
        document.getElementById('btn-exit-game').onclick = () => { this.state = 'MENU'; this.showScreen('screen-level-select'); };
        document.getElementById('btn-result-exit').onclick = () => { this.state = 'MENU'; this.showScreen('screen-main-menu'); };
        document.getElementById('btn-retry').onclick = () => this.loadLevel(this.currentLevel);
        document.getElementById('btn-next-level').onclick = () => this.loadLevel(this.currentLevel + 1);
        
        document.getElementById('btn-start').onclick = () => {
            audio.init();
            document.getElementById('ready-overlay').classList.add('hidden');
            this.state = 'PLAYING';
            this.lastTime = performance.now();
            this.loop(this.lastTime);
        };

        // إدارة البيانات
        document.getElementById('btn-reset-progress').onclick = () => document.getElementById('screen-confirm-reset').classList.remove('hidden');
        document.getElementById('btn-confirm-no').onclick = () => document.getElementById('screen-confirm-reset').classList.add('hidden');
        document.getElementById('btn-confirm-yes').onclick = () => {
            localStorage.removeItem('neonBrick_progress');
            this.starsData = {};
            this.renderLevelGrid();
            document.getElementById('screen-confirm-reset').classList.add('hidden');
        };
    }

    /* --- إدارة الشاشات والمراحل --- */
    showScreen(id) {
        document.querySelectorAll('.screen:not(.popup-overlay)').forEach(s => s.classList.add('hidden'));
        document.getElementById(id).classList.remove('hidden');
        if(id === 'screen-level-select') this.renderLevelGrid();
    }

    renderLevelGrid() {
        const grid = document.getElementById('level-select-grid');
        grid.innerHTML = '';
        let highestUnlocked = 1;
        for(let key in this.starsData) {
            if(parseInt(key) >= highestUnlocked) highestUnlocked = parseInt(key) + 1;
        }

        LEVELS_DATA.forEach(level => {
            const btn = document.createElement('button');
            btn.className = 'level-btn';
            const isUnlocked = level.id <= highestUnlocked;
            
            if(!isUnlocked) {
                btn.classList.add('locked');
                btn.innerHTML = `🔒<br><span style="font-size:0.8rem">مرحلة ${level.id}</span>`;
            } else {
                let stars = this.starsData[level.id] || 0;
                let starsHtml = `<div class="level-stars">`;
                for(let i=0; i<3; i++) starsHtml += `<span class="star ${i < stars ? 'earned' : ''}">★</span>`;
                starsHtml += `</div>`;
                btn.innerHTML = `مرحلة ${level.id} ${starsHtml}`;
                btn.onclick = () => this.loadLevel(level.id);
            }
            grid.appendChild(btn);
        });
    }

    loadLevel(id) {
        if(id > LEVELS_DATA.length) return; // ختم اللعبة
        this.currentLevel = id;
        const levelData = LEVELS_DATA[id - 1];
        
        // استنساخ الكتل عميقاً (Deep Copy)
        this.bricks = JSON.parse(JSON.stringify(levelData.bricks));
        
        this.lives = 3;
        this.score = 0;
        this.balls = [{ x: GAME_WIDTH/2, y: PADDLE_Y - 10, vx: 200, vy: -levelData.baseSpeed, r: 6, isFire: false }];
        this.paddle.w = 80;
        this.paddle.x = GAME_WIDTH/2 - this.paddle.w/2;
        this.powerups = [];
        this.particles = [];
        this.lasers = [];
        this.activePowers = { wide: 0, fire: 0, laser: 0, shield: 0 };
        
        this.updateHUD();
        this.showScreen('screen-game');
        document.getElementById('ready-overlay').classList.remove('hidden');
        document.getElementById('screen-result').classList.add('hidden');
        document.getElementById('screen-pause').classList.add('hidden');
        this.state = 'READY';
        
        // رسم شاشة البداية
        this.ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        this.drawWorld();
    }

    /* --- منطق اللعب الفيزيائي (Game Loop) --- */
    pauseGame() {
        if (this.state !== 'PLAYING') return;
        this.state = 'PAUSED';
        document.getElementById('screen-pause').classList.remove('hidden');
    }

    resumeGame() {
        this.state = 'PLAYING';
        document.getElementById('screen-pause').classList.add('hidden');
        this.lastTime = performance.now();
        this.loop(this.lastTime);
    }

    gameOver(isWin) {
        this.state = 'OVER';
        document.getElementById('screen-result').classList.remove('hidden');
        document.getElementById('result-title').textContent = isWin ? "لقد فزت!" : "انتهت اللعبة";
        document.getElementById('result-score').textContent = this.score;
        
        const starsCont = document.getElementById('result-stars');
        starsCont.innerHTML = '';
        const btnNext = document.getElementById('btn-next-level');
        
        if (isWin) {
            audio.playWin();
            let starsEarned = 1;
            if(this.lives === 3) starsEarned = 3;
            else if(this.lives === 2) starsEarned = 2;
            
            // حفظ التقدم إذا كان أعلى
            const prevStars = this.starsData[this.currentLevel] || 0;
            if (starsEarned > prevStars) {
                this.starsData[this.currentLevel] = starsEarned;
                localStorage.setItem('neonBrick_progress', JSON.stringify(this.starsData));
            }
            
            for(let i=0; i<3; i++) {
                starsCont.innerHTML += `<span class="star ${i < starsEarned ? 'earned' : ''}">★</span>`;
            }
            if(this.currentLevel < LEVELS_DATA.length) btnNext.classList.remove('hidden');
            else btnNext.classList.add('hidden');
        } else {
            starsCont.innerHTML = `<span class="star">☠️</span>`;
            btnNext.classList.add('hidden');
        }
    }

    spawnPowerup(x, y) {
        if(Math.random() > 0.25) return; // 25% فرصة سقوط
        const types = ['wide', 'multi', 'fire', 'laser', 'shield'];
        const type = types[Math.floor(Math.random() * types.length)];
        this.powerups.push({ x, y, vy: 150, type, w: 20, h: 20 });
        audio.playPowerupSpawn();
    }

    createExplosion(x, y, color) {
        for(let i=0; i<15; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 150 + 50;
            this.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                color
            });
        }
    }

    explodeBrick(bx, by) {
        audio.playExplosion();
        this.createExplosion(bx + 30, by + 12, 'var(--neon-red)');
        const radius = 80;
        this.bricks.forEach(b => {
            if(b.hp > 0) {
                const cx = b.x + b.w/2, cy = b.y + b.h/2;
                const dist = Math.hypot(cx - (bx+30), cy - (by+12));
                if(dist <= radius) {
                    b.hp = 0;
                    this.score += 20;
                    this.createExplosion(cx, cy, 'var(--neon-yellow)');
                }
            }
        });
    }

    updateHUD() {
        document.getElementById('hud-score').textContent = this.score;
        document.getElementById('hud-lives').textContent = this.lives;
        document.getElementById('hud-level').textContent = this.currentLevel;
    }

    clampPaddle() {
        if (this.paddle.x < 0) this.paddle.x = 0;
        if (this.paddle.x + this.paddle.w > GAME_WIDTH) this.paddle.x = GAME_WIDTH - this.paddle.w;
    }

    /* --- التحديث الفيزيائي (Sub-stepping) --- */
    updatePhysics(dt) {
        // حركة المضرب بالكيبورد
        if(this.keys.left) this.paddle.x -= this.paddle.speed * dt;
        if(this.keys.right) this.paddle.x += this.paddle.speed * dt;
        this.clampPaddle();

        // تحديث المؤقتات
        for(let key in this.activePowers) {
            if(this.activePowers[key] > 0) {
                this.activePowers[key] -= dt;
                if(this.activePowers[key] <= 0) {
                    this.activePowers[key] = 0;
                    if(key === 'wide') this.paddle.w = 80;
                }
            }
        }

        // إطلاق الليزر
        if (this.activePowers.laser > 0) {
            this.laserTimer -= dt;
            if (this.laserTimer <= 0) {
                this.lasers.push({ x: this.paddle.x + 10, y: PADDLE_Y, vy: -400 });
                this.lasers.push({ x: this.paddle.x + this.paddle.w - 15, y: PADDLE_Y, vy: -400 });
                audio.playLaser();
                this.laserTimer = 0.5; // كل نصف ثانية
            }
        }

        // حركة الليزر واصطدامه
        for(let i = this.lasers.length -1; i >= 0; i--) {
            let l = this.lasers[i];
            l.y += l.vy * dt;
            let hit = false;
            for(let b of this.bricks) {
                if(b.hp > 0 && l.x > b.x && l.x < b.x + b.w && l.y > b.y && l.y < b.y + b.h) {
                    b.hp--;
                    hit = true;
                    this.score += 10;
                    this.createExplosion(l.x, l.y, 'var(--neon-green)');
                    if(b.hp === 0 && b.type === 3) this.explodeBrick(b.x, b.y);
                    else if(b.hp === 0) audio.playHitBrick();
                    else audio.playHitArmor();
                    break;
                }
            }
            if(hit || l.y < 0) this.lasers.splice(i, 1);
        }

        // الجوائز (Power-ups)
        for(let i = this.powerups.length -1; i >= 0; i--) {
            let p = this.powerups[i];
            p.y += p.vy * dt;
            
            // التقاط الجائزة
            if (p.y + p.h > PADDLE_Y && p.y < PADDLE_Y + this.paddle.h &&
                p.x + p.w > this.paddle.x && p.x < this.paddle.x + this.paddle.w) {
                audio.playPowerupCatch();
                this.score += 50;
                
                switch(p.type) {
                    case 'wide': 
                        this.paddle.w = 120; 
                        this.activePowers.wide = 10; 
                        break;
                    case 'fire': 
                        this.activePowers.fire = 8; 
                        this.balls.forEach(b => b.isFire = true); 
                        break;
                    case 'laser': 
                        this.activePowers.laser = 8; 
                        break;
                    case 'shield': 
                        this.activePowers.shield = 15; 
                        break;
                    case 'multi':
                        let newBalls = [];
                        this.balls.forEach(b => {
                            newBalls.push({ x: b.x, y: b.y, vx: -b.vx, vy: b.vy, r: b.r, isFire: b.isFire });
                        });
                        this.balls.push(...newBalls);
                        break;
                }
                this.powerups.splice(i, 1);
                continue;
            }
            if(p.y > GAME_HEIGHT) this.powerups.splice(i, 1);
        }

        // إزالة حالة النار إذا انتهى الوقت
        if(this.activePowers.fire === 0) {
            this.balls.forEach(b => b.isFire = false);
        }

        // حركة الكرات واصطداماتها
        for(let i = this.balls.length -1; i >= 0; i--) {
            let ball = this.balls[i];
            
            // تقسيم الحركة الدقيقة (Sub-stepping) للكرة
            for(let step = 0; step < PHYSICS_STEPS; step++) {
                let sdt = dt / PHYSICS_STEPS;
                ball.x += ball.vx * sdt;
                ball.y += ball.vy * sdt;

                // الجدران
                if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx *= -1; }
                if (ball.x + ball.r > GAME_WIDTH) { ball.x = GAME_WIDTH - ball.r; ball.vx *= -1; }
                if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy *= -1; }
                
                // درع الحماية السفلي
                if (ball.y + ball.r > GAME_HEIGHT - 20 && this.activePowers.shield > 0) {
                    ball.y = GAME_HEIGHT - 20 - ball.r;
                    ball.vy *= -1;
                    audio.playHitPaddle();
                }

                // السقوط والخسارة
                if (ball.y > GAME_HEIGHT + 20) {
                    this.balls.splice(i, 1);
                    break; // الكرة ماتت، اخرج من Sub-stepping
                }

                // منع الانحباس الأفقي (Anti-trapping)
                if (Math.abs(ball.vy) < MIN_BALL_VY) {
                    ball.vy = (ball.vy >= 0 ? 1 : -1) * MIN_BALL_VY;
                }

                // الاصطدام بالمضرب
                if (ball.vy > 0 && ball.y + ball.r >= PADDLE_Y && ball.y - ball.r <= PADDLE_Y + this.paddle.h) {
                    if (ball.x + ball.r >= this.paddle.x && ball.x - ball.r <= this.paddle.x + this.paddle.w) {
                        audio.playHitPaddle();
                        ball.y = PADDLE_Y - ball.r;
                        
                        // زاوية الارتداد تعتمد على مكان ضرب الكرة للمضرب
                        let hitPoint = ball.x - (this.paddle.x + this.paddle.w/2);
                        let normalizedHit = hitPoint / (this.paddle.w/2); // -1 to 1
                        let maxAngle = Math.PI / 3; // 60 degrees
                        let speed = Math.hypot(ball.vx, ball.vy);
                        
                        ball.vx = speed * Math.sin(normalizedHit * maxAngle);
                        ball.vy = -speed * Math.cos(normalizedHit * maxAngle);
                    }
                }

                // الاصطدام بالكتل (AABB)
                for (let b of this.bricks) {
                    if (b.hp > 0) {
                        let nearestX = Math.max(b.x, Math.min(ball.x, b.x + b.w));
                        let nearestY = Math.max(b.y, Math.min(ball.y, b.y + b.h));
                        let dx = ball.x - nearestX;
                        let dy = ball.y - nearestY;
                        
                        if (dx*dx + dy*dy <= ball.r*ball.r) {
                            // الاصطدام حدث!
                            if(ball.isFire) {
                                // الكرة النارية تخترق بدون ارتداد وتدمر فوراً
                                b.hp = 0;
                            } else {
                                b.hp--;
                                // تحديد جهة الارتداد
                                if (Math.abs(dx) > Math.abs(dy)) ball.vx *= -1;
                                else ball.vy *= -1;
                            }
                            
                            this.score += 10;
                            if (b.hp === 0) {
                                this.createExplosion(b.x + b.w/2, b.y + b.h/2, 'var(--neon-cyan)');
                                this.spawnPowerup(b.x + b.w/2, b.y + b.h/2);
                                if(b.type === 3) this.explodeBrick(b.x, b.y);
                                else audio.playHitBrick();
                            } else {
                                audio.playHitArmor();
                            }
                            break; // كسر حلقة الكتل لتفادي اصطدام مزدوج في نفس الخطوة
                        }
                    }
                }
            }
        }

        // تحديث الجسيمات
        for (let i = this.particles.length -1; i >= 0; i--) {
            let p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt * 2;
            if(p.life <= 0) this.particles.splice(i, 1);
        }

        this.updateHUD();

        // فحص حالة الخسارة/الفوز
        if (this.balls.length === 0) {
            this.lives--;
            audio.playLoseLife();
            if (this.lives > 0) {
                // إعادة كرة جديدة
                const speed = LEVELS_DATA[this.currentLevel-1].baseSpeed;
                this.balls.push({ x: this.paddle.x + this.paddle.w/2, y: PADDLE_Y - 10, vx: 200, vy: -speed, r: 6, isFire: false });
                this.activePowers.fire = 0;
            } else {
                this.gameOver(false);
            }
        } else if (this.bricks.every(b => b.hp <= 0)) {
            this.gameOver(true);
        }
    }

    /* --- الرسم (Rendering) --- */
    drawWorld() {
        this.ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

        // رسم الدرع السفلي
        if (this.activePowers.shield > 0) {
            this.ctx.shadowBlur = 15;
            this.ctx.shadowColor = 'var(--neon-pink)';
            this.ctx.fillStyle = 'rgba(255, 0, 255, 0.4)';
            this.ctx.fillRect(0, GAME_HEIGHT - 20, GAME_WIDTH, 5);
            this.ctx.shadowBlur = 0;
        }

        // رسم الكتل
        this.bricks.forEach(b => {
            if (b.hp > 0) {
                this.ctx.shadowBlur = 10;
                if (b.type === 1) { this.ctx.fillStyle = b.hp===1 ? '#00ffff' : '#fff'; this.ctx.shadowColor = '#00ffff'; }
                if (b.type === 2) { this.ctx.fillStyle = b.hp===2 ? '#ffff00' : '#888800'; this.ctx.shadowColor = '#ffff00'; }
                if (b.type === 3) { this.ctx.fillStyle = '#ff3333'; this.ctx.shadowColor = '#ff3333'; }
                
                this.ctx.fillRect(b.x, b.y, b.w, b.h);
                // تأثير الإطار الداخلي
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 1;
                this.ctx.strokeRect(b.x+2, b.y+2, b.w-4, b.h-4);
            }
        });

        // رسم الجوائز
        this.powerups.forEach(p => {
            this.ctx.shadowBlur = 15;
            let color = '#fff';
            let icon = '?';
            if(p.type === 'wide') { color = '#00ff00'; icon = 'W'; }
            if(p.type === 'fire') { color = '#ff3333'; icon = 'F'; }
            if(p.type === 'laser') { color = '#ff00ff'; icon = 'L'; }
            if(p.type === 'shield') { color = '#00ffff'; icon = 'S'; }
            if(p.type === 'multi') { color = '#ffff00'; icon = 'M'; }
            
            this.ctx.shadowColor = color;
            this.ctx.fillStyle = color;
            this.ctx.fillRect(p.x, p.y, p.w, p.h);
            
            this.ctx.fillStyle = '#000';
            this.ctx.font = '14px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(icon, p.x + p.w/2, p.y + p.h/2);
        });

        // رسم الليزر
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = 'var(--neon-green)';
        this.ctx.fillStyle = 'var(--neon-green)';
        this.lasers.forEach(l => {
            this.ctx.fillRect(l.x - 2, l.y, 4, 15);
        });

        // رسم المضرب
        this.ctx.shadowBlur = 20;
        this.ctx.shadowColor = 'var(--neon-cyan)';
        this.ctx.fillStyle = 'var(--neon-cyan)';
        this.ctx.beginPath();
        this.ctx.roundRect(this.paddle.x, PADDLE_Y, this.paddle.w, this.paddle.h, 5);
        this.ctx.fill();

        // رسم الكرات
        this.balls.forEach(ball => {
            this.ctx.beginPath();
            this.ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
            if (ball.isFire) {
                this.ctx.fillStyle = '#ffaa00';
                this.ctx.shadowColor = '#ff3333';
                this.ctx.shadowBlur = 25;
            } else {
                this.ctx.fillStyle = '#ffffff';
                this.ctx.shadowColor = 'var(--neon-pink)';
                this.ctx.shadowBlur = 15;
            }
            this.ctx.fill();
        });

        // رسم الجسيمات
        this.particles.forEach(p => {
            this.ctx.globalAlpha = p.life;
            this.ctx.fillStyle = p.color;
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = p.color;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 3, 0, Math.PI*2);
            this.ctx.fill();
        });
        this.ctx.globalAlpha = 1.0;
        this.ctx.shadowBlur = 0; // إعادة الضبط
    }

    loop(timestamp) {
        if (this.state !== 'PLAYING') return;
        
        let dt = (timestamp - this.lastTime) / 1000;
        if (dt > 0.1) dt = 0.1; // حماية من القفزات الزمنية عند تصغير المتصفح
        this.lastTime = timestamp;

        this.updatePhysics(dt);
        this.drawWorld();

        this.animFrame = requestAnimationFrame((ts) => this.loop(ts));
    }
}

// بدء التشغيل عند تحميل الصفحة
window.onload = () => {
    const game = new GameEngine();
};
