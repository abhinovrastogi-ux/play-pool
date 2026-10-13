(() => {
  "use strict";

  const canvas = document.getElementById("table");
  const ctx = canvas.getContext("2d");
  const modeSelect = document.getElementById("game-mode");
  const powerInput = document.getElementById("power");
  const powerValue = document.getElementById("power-value");
  const shootButton = document.getElementById("shoot");
  const statusText = document.getElementById("status");
  const targetText = document.getElementById("target-name");
  const shotCount = document.getElementById("shot-count");
  const sunkCount = document.getElementById("sunk-count");
  const toast = document.getElementById("toast");
  const soundToggle = document.getElementById("sound-toggle");

  const W = 1000;
  const H = 560;
  const R = 15;
  const REST_SPEED = 14;
  const TABLE = { left: 58, top: 58, right: 942, bottom: 502 };
  const POCKETS = [
    [TABLE.left, TABLE.top], [(TABLE.left + TABLE.right) / 2, TABLE.top],
    [TABLE.right, TABLE.top], [TABLE.left, TABLE.bottom],
    [(TABLE.left + TABLE.right) / 2, TABLE.bottom], [TABLE.right, TABLE.bottom]
  ];
  const palette = {
    1: "#f5c842", 2: "#2872d5", 3: "#d83d43", 4: "#7445b8",
    5: "#ed8236", 6: "#259454", 7: "#78352d", 8: "#20232b",
    9: "#f5c842", 10: "#2872d5", 11: "#d83d43", 12: "#7445b8",
    13: "#ed8236", 14: "#259454", 15: "#78352d"
  };
  const names = {
    1: "Yellow", 2: "Blue", 3: "Red", 4: "Purple", 5: "Orange",
    6: "Green", 7: "Maroon", 8: "8 Ball", 9: "Yellow stripe",
    10: "Blue stripe", 11: "Red stripe", 12: "Purple stripe",
    13: "Orange stripe", 14: "Green stripe", 15: "Maroon stripe"
  };

  let balls = [];
  let aimAngle = 0;
  let selectedBall = null;
  let isMoving = false;
  let ballInHand = false;
  let shotNumber = 0;
  let pocketedCount = 0;
  let lastTime = 0;
  let toastTimer;
  let cueDrag = false;
  let aimDrag = false;
  let cueGhost = null;
  let audioContext = null;
  let masterGain = null;
  let effectsGain = null;
  let soundEnabled = false;
  let lastCollisionSound = 0;

  function makeBall(id, x, y) {
    return { id, x, y, vx: 0, vy: 0, spin: 0, pocketed: false };
  }

  function cueBall() {
    return balls.find(ball => ball.id === 0);
  }

  function rack() {
    const mode = modeSelect.value;
    balls = [makeBall(0, 280, 280)];
    const ids = mode === "9" ? [1, 2, 3, 4, 9, 5, 6, 7, 8] :
      Array.from({ length: 15 }, (_, i) => i + 1);
    const spacing = R * 2 + 1;
    let index = 0;

    for (let column = 0; column < 5 && index < ids.length; column += 1) {
      const count = column + 1;
      for (let row = 0; row < count && index < ids.length; row += 1) {
        let id = ids[index++];
        if (mode === "8") {
          if (column === 2 && row === 1) id = 8;
          else if (id === 8) id = 5;
        }
        const y = 280 + (row - (count - 1) / 2) * spacing;
        balls.push(makeBall(id, 690 + column * spacing * 0.87, y));
      }
    }
    aimAngle = 0;
    selectedBall = null;
    ballInHand = false;
    isMoving = false;
    cueGhost = null;
    shotNumber = 0;
    pocketedCount = 0;
    updateHud();
    showToast("Rack ready — choose a ball or line up your shot");
  }

  function updateHud() {
    shotCount.textContent = String(shotNumber).padStart(2, "0");
    sunkCount.textContent = String(pocketedCount).padStart(2, "0");
    const target = selectedBall && !selectedBall.pocketed ? selectedBall : null;
    targetText.textContent = target ? `${target.id} · ${names[target.id]}` : "Tap a ball to select";
    statusText.textContent = ballInHand ? "BALL IN HAND" : isMoving ? "BALLS IN MOTION" : "YOUR TURN";
    shootButton.disabled = isMoving || ballInHand;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2200);
  }

  function createAudio() {
    if (audioContext) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      showToast("Audio isn't supported in this browser");
      return false;
    }

    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    effectsGain = audioContext.createGain();
    masterGain.gain.value = 0.8;
    effectsGain.gain.value = 0.8;
    effectsGain.connect(masterGain);
    masterGain.connect(audioContext.destination);
    return true;
  }

  function setAudioButton() {
    soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    soundToggle.setAttribute("aria-label", soundEnabled ? "Turn sound effects off" : "Turn sound effects on");
    soundToggle.textContent = soundEnabled ? "♪ EFFECTS ON" : "♪ EFFECTS OFF";
  }

  async function toggleAudio() {
    if (soundEnabled) {
      soundEnabled = false;
      if (effectsGain && audioContext) effectsGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08);
      setAudioButton();
      setTimeout(() => {
        if (!soundEnabled && audioContext) audioContext.suspend();
      }, 350);
      return;
    }
    if (!createAudio()) return;
    try {
      if (audioContext.state !== "running") await audioContext.resume();
      if (audioContext.state !== "running") {
        showToast("Audio is paused by the browser — check your sound settings");
        return;
      }
    } catch (error) {
      showToast(`Audio couldn't start: ${error.message}`);
      return;
    }
    soundEnabled = true;
    effectsGain.gain.setTargetAtTime(0.8, audioContext.currentTime, 0.08);
    setAudioButton();
    showToast("Pool sound effects on");
  }

  function playCueStrike(power) {
    if (!soundEnabled || !audioContext) return;
    const now = audioContext.currentTime;
    const thock = audioContext.createOscillator();
    const thockGain = audioContext.createGain();
    thock.type = "sine";
    thock.frequency.setValueAtTime(185 + power * 80, now);
    thock.frequency.exponentialRampToValueAtTime(75, now + 0.12);
    thockGain.gain.setValueAtTime(0.34, now);
    thockGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    thock.connect(thockGain);
    thockGain.connect(effectsGain);
    thock.start(now);
    thock.stop(now + 0.15);

    const buffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * 0.045), audioContext.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) channel[i] = (Math.random() * 2 - 1) * (1 - i / channel.length);
    const click = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const clickGain = audioContext.createGain();
    click.buffer = buffer;
    filter.type = "highpass";
    filter.frequency.value = 900;
    clickGain.gain.value = 0.2 + power * 0.14;
    click.connect(filter);
    filter.connect(clickGain);
    clickGain.connect(effectsGain);
    click.start(now);
  }

  function playBallHit(impactSpeed, isCueContact) {
    if (!soundEnabled || !audioContext || impactSpeed < 85) return;
    const now = audioContext.currentTime;
    if (now - lastCollisionSound < 0.045) return;
    lastCollisionSound = now;
    const intensity = Math.min(1, impactSpeed / 720);
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime((isCueContact ? 410 : 540) + intensity * 260, now);
    oscillator.frequency.exponentialRampToValueAtTime(180 + intensity * 90, now + 0.055);
    envelope.gain.setValueAtTime(0.015 + intensity * 0.12, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    oscillator.connect(envelope);
    envelope.connect(effectsGain);
    oscillator.start(now);
    oscillator.stop(now + 0.08);
  }

  function playPocketSound() {
    if (!soundEnabled || !audioContext) return;
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, now);
    oscillator.frequency.exponentialRampToValueAtTime(240, now + 0.22);
    envelope.gain.setValueAtTime(0.12, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    oscillator.connect(envelope);
    envelope.connect(effectsGain);
    oscillator.start(now);
    oscillator.stop(now + 0.25);
  }

  function positionFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * W / rect.width,
      y: (event.clientY - rect.top) * H / rect.height
    };
  }

  function nearestBall(point, maxDistance) {
    let nearest = null;
    let best = maxDistance;
    for (const ball of balls) {
      if (ball.pocketed) continue;
      const distance = Math.hypot(ball.x - point.x, ball.y - point.y);
      if (distance < best) {
        nearest = ball;
        best = distance;
      }
    }
    return nearest;
  }

  function pointerDown(event) {
    if (isMoving) return;
    const point = positionFromEvent(event);
    const hit = nearestBall(point, R + 13);
    if (ballInHand && cueBall() && hit === cueBall()) {
      cueDrag = true;
      cueGhost = point;
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (hit && hit.id !== 0) {
      selectedBall = hit;
      const cue = cueBall();
      aimAngle = Math.atan2(hit.y - cue.y, hit.x - cue.x);
      updateHud();
      return;
    }
    if (hit && hit.id === 0) {
      selectedBall = null;
      updateHud();
    }
    aimDrag = true;
    canvas.setPointerCapture(event.pointerId);
    const cue = cueBall();
    if (cue) aimAngle = Math.atan2(point.y - cue.y, point.x - cue.x);
    updateHud();
  }

  function pointerMove(event) {
    const point = positionFromEvent(event);
    if (cueDrag) {
      cueGhost = point;
      draw();
      return;
    }
    if (aimDrag && !isMoving && !ballInHand) {
      const cue = cueBall();
      if (cue) aimAngle = Math.atan2(point.y - cue.y, point.x - cue.x);
    }
    if (ballInHand && cueGhost) cueGhost = point;
  }

  function pointerUp(event) {
    aimDrag = false;
    if (!cueDrag) return;
    const point = positionFromEvent(event);
    cueDrag = false;
    const safe = clampCuePosition(point);
    const cue = cueBall();
    if (cue && safe) {
      cue.x = safe.x;
      cue.y = safe.y;
      ballInHand = false;
      showToast("Cue ball placed — line up your shot");
      updateHud();
    } else {
      showToast("Place the cue ball on a clear part of the table");
    }
    cueGhost = null;
    draw();
  }

  function clampCuePosition(point) {
    const x = Math.max(TABLE.left + R + 6, Math.min(TABLE.right - R - 6, point.x));
    const y = Math.max(TABLE.top + R + 6, Math.min(TABLE.bottom - R - 6, point.y));
    const overlap = balls.some(ball => ball.id !== 0 && !ball.pocketed &&
      Math.hypot(ball.x - x, ball.y - y) < R * 2 + 2);
    return overlap ? null : { x, y };
  }

  function shoot() {
    const cue = cueBall();
    if (!cue || isMoving || ballInHand) return;
    const power = Number(powerInput.value) / 100;
    const speed = 300 + power * 680;
    playCueStrike(power);
    cue.vx = Math.cos(aimAngle) * speed;
    cue.vy = Math.sin(aimAngle) * speed;
    shotNumber += 1;
    isMoving = true;
    updateHud();
    showToast("Nice shot!");
  }

  function resolveCollision(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const minDistance = R * 2;
    if (!distance || distance >= minDistance) return;

    const nx = dx / distance;
    const ny = dy / distance;
    const overlap = minDistance - distance;
    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.y += ny * overlap * 0.5;

    const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (relative < 0) {
      playBallHit(-relative, a.id === 0 || b.id === 0);
      const impulse = -(1 + 0.96) * relative / 2;
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
    }
  }

  function step(dt) {
    const timeScale = dt / 1000;
    const iterations = 2;
    for (let pass = 0; pass < iterations; pass += 1) {
      const slice = timeScale / iterations;
      for (const ball of balls) {
        if (ball.pocketed) continue;
        ball.x += ball.vx * slice;
        ball.y += ball.vy * slice;
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed > 0) {
          const nextSpeed = Math.max(0, speed - 155 * slice);
          const factor = nextSpeed / speed;
          ball.vx *= factor;
          ball.vy *= factor;
        }
      }
      for (let i = 0; i < balls.length; i += 1) {
        const a = balls[i];
        if (a.pocketed) continue;
        for (let j = i + 1; j < balls.length; j += 1) {
          const b = balls[j];
          if (!b.pocketed) resolveCollision(a, b);
        }
      }
    }

    for (const ball of balls) {
      if (ball.pocketed) continue;
      const pocket = POCKETS.find(([x, y]) => Math.hypot(ball.x - x, ball.y - y) < 27);
      if (pocket) {
        playPocketSound();
        if (ball.id === 0) {
          ball.pocketed = true;
          setTimeout(() => {
            const cue = cueBall();
            if (cue) {
              cue.pocketed = false;
              cue.x = 280;
              cue.y = 280;
              cue.vx = 0;
              cue.vy = 0;
            }
            ballInHand = true;
            isMoving = false;
            showToast("Scratch — drag the cue ball to place it");
            updateHud();
          }, 300);
        } else {
          ball.pocketed = true;
          ball.vx = 0;
          ball.vy = 0;
          pocketedCount += 1;
          if (selectedBall === ball) selectedBall = null;
        }
        continue;
      }

      if (ball.x < TABLE.left + R) {
        if (ball.vx < -180) playBallHit(-ball.vx * 0.55, false);
        ball.x = TABLE.left + R;
        ball.vx = Math.abs(ball.vx) * 0.88;
      } else if (ball.x > TABLE.right - R) {
        if (ball.vx > 180) playBallHit(ball.vx * 0.55, false);
        ball.x = TABLE.right - R;
        ball.vx = -Math.abs(ball.vx) * 0.88;
      }
      if (ball.y < TABLE.top + R) {
        if (ball.vy < -180) playBallHit(-ball.vy * 0.55, false);
        ball.y = TABLE.top + R;
        ball.vy = Math.abs(ball.vy) * 0.88;
      } else if (ball.y > TABLE.bottom - R) {
        if (ball.vy > 180) playBallHit(ball.vy * 0.55, false);
        ball.y = TABLE.bottom - R;
        ball.vy = -Math.abs(ball.vy) * 0.88;
      }
    }

    balls.forEach(ball => {
      if (!ball.pocketed && Math.hypot(ball.vx, ball.vy) <= REST_SPEED) {
        ball.vx = 0;
        ball.vy = 0;
      }
    });
    const moving = balls.some(ball => !ball.pocketed && Math.hypot(ball.vx, ball.vy) > REST_SPEED);
    if (isMoving && !moving) {
      balls.forEach(ball => { ball.vx = 0; ball.vy = 0; });
      isMoving = false;
      updateHud();
    }
  }

  function roundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  function drawTable() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#20140f";
    roundedRect(10, 10, W - 20, H - 20, 40);
    ctx.fill();
    ctx.fillStyle = "#573525";
    roundedRect(24, 24, W - 48, H - 48, 32);
    ctx.fill();
    ctx.fillStyle = "#865438";
    roundedRect(39, 39, W - 78, H - 78, 25);
    ctx.fill();
    ctx.fillStyle = "#126b50";
    roundedRect(TABLE.left, TABLE.top, TABLE.right - TABLE.left, TABLE.bottom - TABLE.top, 10);
    ctx.fill();

    const felt = ctx.createLinearGradient(70, 70, 920, 490);
    felt.addColorStop(0, "rgba(255,255,255,.035)");
    felt.addColorStop(0.48, "rgba(0,0,0,0)");
    felt.addColorStop(1, "rgba(0,0,0,.08)");
    ctx.fillStyle = felt;
    roundedRect(TABLE.left + 5, TABLE.top + 5, TABLE.right - TABLE.left - 10, TABLE.bottom - TABLE.top - 10, 7);
    ctx.fill();

    ctx.strokeStyle = "rgba(241,211,153,.38)";
    ctx.lineWidth = 1;
    [TABLE.left + (TABLE.right - TABLE.left) / 4, TABLE.left + (TABLE.right - TABLE.left) / 2,
      TABLE.left + (TABLE.right - TABLE.left) * 3 / 4].forEach(x => {
      ctx.beginPath();
      ctx.moveTo(x, TABLE.top - 13);
      ctx.lineTo(x, TABLE.top - 7);
      ctx.moveTo(x, TABLE.bottom + 7);
      ctx.lineTo(x, TABLE.bottom + 13);
      ctx.stroke();
    });

    POCKETS.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 27, 0, Math.PI * 2);
      ctx.fillStyle = "#100d0c";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 23, 0, Math.PI * 2);
      ctx.fillStyle = "#070707";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  function drawBall(ball) {
    if (ball.pocketed) return;
    const selected = selectedBall === ball;
    if (selected) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, R + 7, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(178,255,221,.88)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowColor = "rgba(125,255,202,.75)";
      ctx.shadowBlur = 14;
    }

    ctx.beginPath();
    ctx.ellipse(ball.x + 2, ball.y + 5, R * 0.98, R * 0.87, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.fill();
    ctx.shadowBlur = 0;
    const base = ball.id === 0 ? "#f5f5ef" : palette[ball.id];
    const gradient = ctx.createRadialGradient(ball.x - 5, ball.y - 6, 1, ball.x, ball.y, R + 2);
    gradient.addColorStop(0, ball.id === 0 ? "#ffffff" : lighten(base, 42));
    gradient.addColorStop(0.5, base);
    gradient.addColorStop(1, darken(base, 38));
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, R, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    if (ball.id > 8) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, R - 0.7, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#fff";
      ctx.fillRect(ball.x - R, ball.y - 4.5, R * 2, 9);
      ctx.restore();
    }
    if (ball.id !== 0) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.fillStyle = "#25252a";
      ctx.font = "bold 8px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(ball.id), ball.x, ball.y + 0.5);
    } else {
      ctx.beginPath();
      ctx.arc(ball.x - 5, ball.y - 6, 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.fill();
    }
  }

  function lighten(hex, amount) {
    const value = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (value >> 16) + amount);
    const g = Math.min(255, ((value >> 8) & 255) + amount);
    const b = Math.min(255, (value & 255) + amount);
    return `rgb(${r},${g},${b})`;
  }

  function darken(hex, amount) {
    const value = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (value >> 16) - amount);
    const g = Math.max(0, ((value >> 8) & 255) - amount);
    const b = Math.max(0, (value & 255) - amount);
    return `rgb(${r},${g},${b})`;
  }

  function drawAim() {
    const cue = cueBall();
    if (!cue || cue.pocketed || isMoving || ballInHand) return;
    const directionX = Math.cos(aimAngle);
    const directionY = Math.sin(aimAngle);
    const power = Number(powerInput.value) / 100;
    const selected = selectedBall && !selectedBall.pocketed ? selectedBall : null;
    let length = 195 + power * 55;
    if (selected) {
      const dx = selected.x - cue.x;
      const dy = selected.y - cue.y;
      const along = dx * directionX + dy * directionY;
      const side = Math.abs(dx * directionY - dy * directionX);
      if (along > 0 && side < R * 1.7) length = Math.max(25, along - R * 1.5);
    }

    ctx.save();
    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(237,255,245,.82)";
    ctx.beginPath();
    ctx.moveTo(cue.x + directionX * (R + 3), cue.y + directionY * (R + 3));
    ctx.lineTo(cue.x + directionX * length, cue.y + directionY * length);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cue.x + directionX * length, cue.y + directionY * length, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#c5ffe5";
    ctx.fill();

    const stickStart = R + 12 + power * 10;
    ctx.strokeStyle = "#d5b88d";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cue.x - directionX * stickStart, cue.y - directionY * stickStart);
    ctx.lineTo(cue.x - directionX * (stickStart + 140), cue.y - directionY * (stickStart + 140));
    ctx.stroke();
    ctx.strokeStyle = "#f2e3ca";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cue.x - directionX * stickStart, cue.y - directionY * stickStart);
    ctx.lineTo(cue.x - directionX * (stickStart + 140), cue.y - directionY * (stickStart + 140));
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    drawTable();
    drawAim();
    balls.forEach(drawBall);
    if (cueGhost) {
      ctx.beginPath();
      ctx.arc(cueGhost.x, cueGhost.y, R, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(248,248,238,.42)";
      ctx.strokeStyle = "#c1ffe0";
      ctx.setLineDash([4, 4]);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function frame(now) {
    const dt = Math.min(now - (lastTime || now), 33);
    lastTime = now;
    if (isMoving) step(dt);
    draw();
    requestAnimationFrame(frame);
  }

  modeSelect.addEventListener("change", rack);
  document.getElementById("new-game").addEventListener("click", rack);
  soundToggle.addEventListener("click", toggleAudio);
  powerInput.addEventListener("input", () => {
    powerValue.textContent = `${powerInput.value}%`;
    draw();
  });
  shootButton.addEventListener("click", shoot);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  document.addEventListener("keydown", event => {
    if (event.code === "Space" && !event.repeat) {
      event.preventDefault();
      shoot();
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      aimAngle += event.key === "ArrowLeft" ? -0.045 : 0.045;
      draw();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!audioContext) return;
    if (document.hidden) {
      audioContext.suspend();
    } else if (soundEnabled) {
      audioContext.resume();
    }
  });

  rack();
  requestAnimationFrame(frame);
})();
