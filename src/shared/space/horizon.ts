// A black hole's horizon: an opaque black sphere (it hides the grid lines behind it) inside a glowing shell whose light
// peaks at the silhouette and falls off outward. The shape can ring in the l = m = 2 "bar" mode of a ringing remnant:
//   r(θ, φ) = R [1 + ε sin²θ cos 2(φ − ψ)]       (y is the spin axis; ε and ψ are uniforms; a drawing of the
// quasi-normal mode the template's ringdown carries, labelled modelled). Group scale = horizon radius in world units.

import { AdditiveBlending, BackSide, Group, Mesh, MeshBasicNodeMaterial, SphereGeometry } from 'three/webgpu';
import {
  cameraPosition,
  cos,
  Discard,
  exp,
  float,
  Fn,
  If,
  max,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  sin,
  sqrt,
  step,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { RGB } from '../gfx/palette.ts';

const _f = () => uniform(0);
type FloatU = ReturnType<typeof _f>;

export interface Horizon {
  group: Group;
  core: Mesh;
  /** Bar-mode distortion amplitude and angle (rad). */
  eps: FloatU;
  psi: FloatU;
  /** Glow intensity (0 hides the shell). */
  glow: FloatU;
  /** Overall visibility (scales the core too: at 0 nothing draws). */
  opacity: FloatU;
  dispose(): void;
}

const SHELL = 1.9;
let sharedGeo: SphereGeometry | null = null;
let users = 0;

export function createHorizon(colour: RGB): Horizon {
  if (!sharedGeo) sharedGeo = new SphereGeometry(1, 64, 40);
  users++;
  const geo = sharedGeo;
  const eps = uniform(0);
  const psi = uniform(0);
  const glow = uniform(1);
  const opacity = uniform(1);
  const bar = (p: Node<'vec3'>) => {
    const n = normalize(p);
    const c2 = cos(psi.mul(2));
    const s2 = sin(psi.mul(2));
    const m = n.x.mul(n.x).sub(n.z.mul(n.z)).mul(c2).add(n.x.mul(n.z).mul(2).mul(s2));
    return p.mul(float(1).add(eps.mul(m)));
  };

  const coreMat = new MeshBasicNodeMaterial({ transparent: false, depthWrite: true, depthTest: true });
  coreMat.positionNode = bar(positionGeometry);
  coreMat.colorNode = vec3(0, 0, 0);
  const core = new Mesh(geo, coreMat);
  core.renderOrder = -5;

  // Shell: drawn on its back faces (always behind the core's silhouette); brightness from the projected distance ρ
  // to the centre in horizon radii: a sharp rim at ρ = 1 and a soft halo outward.
  const shellMat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    side: BackSide,
  });
  shellMat.positionNode = bar(positionGeometry).mul(SHELL);
  const centre = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
  const radius = modelWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz.length();
  const wpos = modelWorldMatrix.mul(vec4(bar(positionGeometry).mul(SHELL), 1)).xyz;
  const vW = varying(wpos, 'hzW');
  const vC = varying(centre, 'hzC');
  const vRad = varying(radius, 'hzR');
  const view = normalize(vW.sub(cameraPosition));
  const oc = vC.sub(cameraPosition);
  const along = oc.dot(view);
  const perp = sqrt(max(oc.dot(oc).sub(along.mul(along)), 0));
  const rho = perp.div(vRad);
  const dr = rho.sub(1);
  const rim = exp(dr.div(0.06).mul(dr.div(0.06)).negate()).mul(1.4);
  const halo = exp(max(dr, 0).mul(-3.2)).mul(0.32).mul(step(1, rho));
  const amount = rim.add(halo).mul(glow).mul(opacity);
  const col = vec3(colour[0], colour[1], colour[2]);
  shellMat.colorNode = Fn(() => {
    If(amount.lessThan(0.003), () => {
      Discard();
    });
    return vec4(col.mul(amount), 1);
  })();
  const shell = new Mesh(geo, shellMat);
  shell.renderOrder = 6;
  shell.frustumCulled = false;

  const group = new Group();
  group.add(core, shell);
  return {
    group,
    core,
    eps,
    psi,
    glow,
    opacity,
    dispose() {
      coreMat.dispose();
      shellMat.dispose();
      users--;
      if (users <= 0 && sharedGeo) {
        sharedGeo.dispose();
        sharedGeo = null;
        users = 0;
      }
    },
  };
}
