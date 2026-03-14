<template>
  <div ref="container" class="hero-scene">
    <div ref="glowRef" class="hero-glow" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";

const container = ref<HTMLElement>();
const glowRef = ref<HTMLElement>();
let cleanup: (() => void) | undefined;

onMounted(async () => {
  const el = container.value;
  const glowEl = glowRef.value;
  if (!el || !glowEl) return;

  const [THREE, { LineSegments2 }, { LineSegmentsGeometry }, { LineMaterial }] = await Promise.all([
    import("three"),
    import("three/addons/lines/LineSegments2.js"),
    import("three/addons/lines/LineSegmentsGeometry.js"),
    import("three/addons/lines/LineMaterial.js"),
  ]);

  // --- Scene setup ---
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 4.2;

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  el.appendChild(renderer.domElement);

  // --- Lattice shape ---
  // 11 nodes: two poles (top/bot), a center, and two rings of 4
  const S = 0.7;
  const top = [0, 1, 0],
    bot = [0, -1, 0],
    mid = [0, 0, 0];
  const ulf = [-S, 0.4, S],
    ulb = [-S, 0.4, -S];
  const urf = [S, 0.4, S],
    urb = [S, 0.4, -S];
  const llf = [-S, -0.4, S],
    llb = [-S, -0.4, -S];
  const lrf = [S, -0.4, S],
    lrb = [S, -0.4, -S];

  const upper = [ulf, ulb, urf, urb];
  const lower = [llf, llb, lrf, lrb];
  const allNodes = [top, ...upper, mid, ...lower, bot];

  // hub: connect one node to many others
  const hub = (c: number[], ...spokes: number[][]) => spokes.flatMap((s) => [...c, ...s]);
  // quad: 4 outline edges + 2 diagonal crossbars
  const quad = (a: number[], b: number[], c: number[], d: number[]) => [
    ...a,
    ...b,
    ...b,
    ...c,
    ...c,
    ...d,
    ...d,
    ...a,
    ...a,
    ...c,
    ...b,
    ...d,
  ];

  const linePoints = [
    ...hub(top, ...upper, mid),
    ...hub(bot, ...lower, mid),
    ...hub(mid, ...upper, ...lower),
    ...quad(ulf, urf, lrf, llf), // front
    ...quad(ulb, urb, lrb, llb), // back
    ...quad(ulf, ulb, llb, llf), // left
    ...quad(urf, urb, lrb, lrf), // right
  ];

  const group = new THREE.Group();
  scene.add(group);

  // --- White sphere nodes ---
  const sphereGeo = new THREE.SphereGeometry(0.08, 12, 8);
  const nodeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  for (const [x, y, z] of allNodes) {
    const mesh = new THREE.Mesh(sphereGeo, nodeMat);
    mesh.position.set(x, y, z);
    group.add(mesh);
  }
  const lineGeo = new LineSegmentsGeometry();
  lineGeo.setPositions(linePoints);
  const lineMat = new LineMaterial({
    color: 0xffffff,
    linewidth: 1.5,
    transparent: true,
    opacity: 0.6,
  });
  const lineSegments = new LineSegments2(lineGeo, lineMat);
  lineSegments.computeLineDistances();
  group.add(lineSegments);

  // --- Sizing ---
  function resize() {
    const size = el!.clientWidth;
    renderer.setSize(size, size);
    lineMat.resolution.set(size, size);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  // --- Drag interaction (mouse + touch) ---
  let isDragging = false;
  let prevX = 0;
  let prevY = 0;
  let dragVelX = 0;
  let dragVelY = 0;

  function onPointerDown(e: PointerEvent) {
    isDragging = true;
    prevX = e.clientX;
    prevY = e.clientY;
    dragVelX = 0;
    dragVelY = 0;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    (e.target as HTMLElement).style.cursor = "grabbing";
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging) return;
    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    dragVelX = dx * 0.005;
    dragVelY = dy * 0.005;
    group.rotation.y += dragVelX;
    group.rotation.x += dragVelY;
    prevX = e.clientX;
    prevY = e.clientY;
  }

  function onPointerUp(e: PointerEvent) {
    isDragging = false;
    (e.target as HTMLElement).style.cursor = "grab";
  }

  const canvas = renderer.domElement;
  canvas.style.touchAction = "none";
  canvas.style.cursor = "grab";
  canvas.style.borderRadius = "22%";
  canvas.style.overflow = "hidden";
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);

  // --- Animation ---
  let animId = 0;
  function animate() {
    animId = requestAnimationFrame(animate);
    const t = Date.now() * 0.001;

    if (!isDragging) {
      dragVelX *= 0.95;
      dragVelY *= 0.95;
      group.rotation.y += 0.003 + dragVelX;
      group.rotation.x += dragVelY;
      if (Math.abs(dragVelX) < 0.0001 && Math.abs(dragVelY) < 0.0001) {
        group.rotation.x += (Math.sin(t * 0.3) * 0.15 - group.rotation.x) * 0.01;
      }
    }

    // animate glow via transform (GPU-composited, no repaint)
    const gx = Math.sin(t * 0.7) * 25 + Math.sin(t * 1.3) * 12;
    const gy = Math.cos(t * 0.5) * 25 + Math.cos(t * 1.1) * 12;
    glowEl!.style.transform = `translate(calc(-50% + ${gx}px), calc(-50% + ${gy}px))`;

    renderer.render(scene, camera);
  }
  animate();

  // --- Cleanup ---
  cleanup = () => {
    cancelAnimationFrame(animId);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    ro.disconnect();
    sphereGeo.dispose();
    nodeMat.dispose();
    lineMat.dispose();
    lineGeo.dispose();
    renderer.dispose();
    el.removeChild(renderer.domElement);
  };
});

onBeforeUnmount(() => cleanup?.());
</script>
