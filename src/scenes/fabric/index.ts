// Stage 2 · Spacetime is a fabric. A sheet of spacetime (a 2D slice drawn as a grid); a star settles in and dimples
// it; rays of light crossing the sheet follow the dimple and bend; a planet rolls round the well. At the very end the
// sheet itself starts to shiver: the cue for ripples. A metaphor for curvature, exaggerated and stated.

import { Scene, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { BlockScene, RenderContext } from '../types.ts';
import { OrbitRig, type RigPose } from '../../shared/gfx/rig.ts';
import { LabelSet } from '../../shared/gfx/labels.ts';
import { createGlowLine, createGlowPoints, type GlowLine, type GlowPoints } from '../../shared/gfx/glow.ts';
import { PAL } from '../../shared/gfx/palette.ts';
import { $reducedMotion } from '../../state/store.ts';
import { createSpaceGrid, wellHeight, type SpaceGrid } from '../../shared/space/grid.ts';
import { fabric, fabricLight, fabricMass, fabricOrbit, fabricRipple } from '../../script/fabric.ts';
import { track } from '../../time/tracks.ts';

const params = {
  fov: 34,
  az: track([
    [0, 0.6],
    [0.5, 0.25],
    [1, 0.05],
  ]),
  el: track([
    [0, 0.5],
    [0.4, 0.42],
    [1, 0.36],
  ]),
  dist: track([
    [0, 26],
    [0.4, 22],
    [1, 21],
  ]),
  extent: 13,
  depth: 3.6,
  soft: 1.5,
  /** Ray impact parameters (world units) and the pull that bends them (picture, not to scale). */
  rays: [2.4, 3.6, 5.2, -3.0],
  pull: 1.1,
  rayPoints: 360,
  planetR: 4.6,
  planetTrail: 40,
};

export default function fabricScene(): BlockScene {
  let renderer: WebGPURenderer;
  const scene = new Scene();
  const rig = new OrbitRig(params.fov);
  const pose: RigPose = { az: 0, el: 0, dist: 22, tx: 0, tt: 0, ty: 0 };
  let grid: SpaceGrid;
  let star: GlowPoints;
  let planet: GlowPoints;
  let photons: GlowPoints;
  const rays: GlowLine[] = [];
  const rayN: number[] = [];
  const rayXYZ: Float32Array[] = [];
  const labels = new LabelSet([
    { id: 'sheet', text: 'Spacetime (a 2D slice)', tone: 'mute', side: 'right', size: 'sm' },
    { id: 'star', text: 'A star', tone: 'warm', side: 'right', size: 'sm' },
    { id: 'light', text: 'Light follows the curve', tone: 'light', side: 'above', size: 'sm' },
    { id: 'planet', text: 'A planet rolls round it', tone: 'b', side: 'right', size: 'sm' },
  ]);
  const L = { sheet: labels.index('sheet'), star: labels.index('star'), light: labels.index('light'), planet: labels.index('planet') };

  const self: BlockScene = {
    id: 'fabric',
    status: 'established',
    statusNote: fabric.note,
    labels,
    async init(c: RenderContext) {
      renderer = c.renderer;
      grid = createSpaceGrid({
        resolution: c.globals.uResolution,
        layout: 'square',
        extent: params.extent,
        lines: 41,
        segments: 260,
        colour: [0.32, 0.4, 0.85],
        width: 1.2,
      });
      grid.fade.value = 0.62;
      scene.add(grid.mesh);
      star = createGlowPoints(1, PAL.sun, { radius: 0.55, intensity: 2.4 });
      planet = createGlowPoints(params.planetTrail, PAL.earth, { radius: 0.09, intensity: 1.6 });
      photons = createGlowPoints(params.rays.length, PAL.light, { radius: 0.12, intensity: 2.2 });
      scene.add(star.mesh, planet.mesh, photons.mesh);
      // Light rays: straight lines pulled toward the star, riding the sheet's surface.
      const D = params.depth;
      const S = params.soft;
      for (const b of params.rays) {
        const line = createGlowLine(params.rayPoints, PAL.light, { width: 0.02, intensity: 1.6 });
        const xyz = new Float32Array(params.rayPoints * 3);
        let x = -params.extent * 0.95;
        let z = b;
        let vx = 1;
        let vz = 0;
        const dt = (params.extent * 1.9) / params.rayPoints;
        let n = 0;
        for (let i = 0; i < params.rayPoints; i++) {
          const r = Math.hypot(x, z);
          const y = wellHeight(D, S, r) + 0.05;
          xyz[i * 3] = x;
          xyz[i * 3 + 1] = y;
          xyz[i * 3 + 2] = z;
          line.set(i, x, y, z);
          n = i + 1;
          const r2 = r * r + S * S;
          const a = params.pull / (r2 * Math.sqrt(r2));
          vx -= a * x * dt;
          vz -= a * z * dt;
          const sp = Math.hypot(vx, vz);
          vx /= sp;
          vz /= sp;
          x += vx * dt;
          z += vz * dt;
          if (Math.abs(x) > params.extent * 0.97 || Math.abs(z) > params.extent * 0.97) break;
        }
        line.commit(n);
        rays.push(line);
        rayN.push(n);
        rayXYZ.push(xyz);
        scene.add(line.mesh);
      }
      await renderer.compileAsync(scene, rig.camera);
    },
    update(local, _dt, elapsed) {
      const reduced = $reducedMotion.get();
      rig.drift = reduced ? 0 : 1;
      const mass = fabricMass(local);
      const D = params.depth * mass;
      grid.wells[0]!.set(0, 0, D, params.soft);
      const rip = fabricRipple(local);
      grid.hp.value = reduced ? 0 : 0.07 * rip * Math.sin(elapsed * 2.6);
      grid.opacity.value = 0.75;
      star.set(0, 0, -D + 0.35, 0, Math.min(1, local / 0.12) * (0.4 + 0.6 * mass));
      star.commit();

      // Rays: drawn progressively, each with a photon at its head.
      const lr = fabricLight(local);
      for (let i = 0; i < rays.length; i++) {
        const n = Math.max(2, Math.round(rayN[i]! * Math.min(1, lr * 1.15 - i * 0.05)));
        rays[i]!.commit(lr > 0 ? n : 0);
        rays[i]!.intensity.value = 1.6 * Math.min(1, lr * 3);
        const k = (n - 1) * 3;
        const xyz = rayXYZ[i]!;
        photons.set(i, xyz[k]!, xyz[k + 1]!, xyz[k + 2]!, lr > 0 && lr < 0.98 ? 1 : 0);
      }
      photons.commit();

      // Planet with a short trail.
      const po = fabricOrbit(local);
      const w0 = reduced ? 0 : elapsed * 0.55;
      for (let i = 0; i < params.planetTrail; i++) {
        const a = w0 - i * 0.045;
        const x = params.planetR * Math.cos(a);
        const z = params.planetR * Math.sin(a);
        const y = wellHeight(D, params.soft, params.planetR) + 0.1;
        const f = 1 - i / params.planetTrail;
        planet.set(i, x, y, z, po * f * f * (i === 0 ? 1.6 : 0.7));
      }
      planet.commit();

      pose.az = params.az(local);
      pose.el = params.el(local);
      pose.dist = params.dist(local);
      pose.tx = rig.camera.aspect > 1 ? -3.2 : 0;
      pose.tt = -1.2;
      pose.ty = 0;
      rig.apply(pose, elapsed);
      rig.camera.updateMatrixWorld();

      const lo = Math.min(1, local / 0.1);
      labels.place(L.sheet, params.extent * 0.55, 0, params.extent * 0.55, rig.camera, lo * (1 - mass * 0.6) * 0.8);
      labels.place(L.star, 0.6, -D + 0.4, 0, rig.camera, mass * (1 - po));
      const xyz = rayXYZ[1]!;
      const mid = Math.floor(rayN[1]! * 0.75) * 3;
      labels.place(L.light, xyz[mid]!, xyz[mid + 1]! + 0.2, xyz[mid + 2]!, rig.camera, lr * (1 - po * 0.5));
      labels.place(L.planet, params.planetR * Math.cos(w0), wellHeight(D, params.soft, params.planetR) + 0.2, params.planetR * Math.sin(w0), rig.camera, po * 0.9);
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, rig.camera);
    },
    resize(w, h) {
      rig.resize(w, h);
    },
    dispose() {
      grid?.dispose();
      star?.dispose();
      planet?.dispose();
      photons?.dispose();
      for (const r of rays) r.dispose();
    },
  };
  return self;
}
