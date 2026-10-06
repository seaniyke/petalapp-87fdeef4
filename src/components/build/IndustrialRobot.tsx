import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { useRef } from "react";
import { Group, MathUtils, MeshStandardMaterial } from "three";

export type WorkshopMaterials = {
  steel: MeshStandardMaterial;
  graphite: MeshStandardMaterial;
  indicator: MeshStandardMaterial;
  glass: MeshStandardMaterial;
};

// Bespoke industrial manipulators: real joint pivots and a two-link IK chain.
// Coordinates are metres; the tool always stays normal to the work surface.
export function IndustrialRobot({ index, selected, moving, materials }: {
  index: number; selected: boolean; moving: boolean; materials: WorkshopMaterials;
}) {
  const turret = useRef<Group>(null);
  const shoulder = useRef<Group>(null);
  const elbow = useRef<Group>(null);
  const wrist = useRef<Group>(null);
  const jaw = useRef<Group>(null);
  const scan = useRef<Group>(null);
  const time = useRef(0);
  const upper = 1.04;
  const fore = .95;
  useFrame((_, rawDelta) => {
    if (!moving || !selected) return;
    const dt = Math.min(rawDelta, .05);
    time.current += dt;
    const t = time.current;
    // Distinct physical work paths, never a timed sequence of build phases.
    const radial = index === 0 ? 1.1 + Math.sin(t * 1.25) * .24
      : index === 1 ? 1.05 + Math.sin(t * 1.8) * .25
      : index === 2 ? 1.12 + Math.sin(t * .95) * .3 : 1.08 + Math.sin(t * .8) * .2;
    const height = index === 1 ? .48 + (1 + Math.sin(t * 2.4)) * .19
      : index === 2 ? .65 + Math.sin(t * .95) * .08 : .48 + Math.cos(t * 1.25) * .09;
    const yaw = -.12 + Math.sin(t * (index === 0 ? .75 : .55)) * .36;
    const bend = Math.acos(MathUtils.clamp((radial * radial + height * height - upper * upper - fore * fore) / (2 * upper * fore), -1, 1));
    const lift = Math.atan2(height, radial) + Math.atan2(fore * Math.sin(bend), upper + fore * Math.cos(bend));
    const damping = 1 - Math.exp(-8 * dt);
    if (turret.current) turret.current.rotation.y = MathUtils.lerp(turret.current.rotation.y, yaw, damping);
    if (shoulder.current) shoulder.current.rotation.z = MathUtils.lerp(shoulder.current.rotation.z, lift, damping);
    if (elbow.current) elbow.current.rotation.z = MathUtils.lerp(elbow.current.rotation.z, -bend, damping);
    if (wrist.current) wrist.current.rotation.z = MathUtils.lerp(wrist.current.rotation.z, -Math.PI / 2 - lift + bend, damping);
    if (jaw.current) jaw.current.position.z = .085 + (1 + Math.sin(t * 2.4)) * .035;
    if (scan.current) scan.current.rotation.y = Math.sin(t * .95) * .35;
  });
  const { steel, graphite, indicator, glass } = materials;
  function Joint({ radius = .18 }: { radius?: number }) {
    return <group>
      <mesh rotation-x={Math.PI / 2} material={graphite}><cylinderGeometry args={[radius, radius, .3, 20]} /></mesh>
      <mesh position-z={.17} rotation-x={Math.PI / 2} material={steel}><cylinderGeometry args={[radius * .82, radius * .82, .05, 20]} /></mesh>
      <mesh position-z={.201} rotation-x={Math.PI / 2} material={indicator}><torusGeometry args={[radius * .55, .016, 5, 20]} /></mesh>
    </group>;
  }
  function Link({ length, width }: { length: number; width: number }) {
    return <group>
      <RoundedBox args={[length, width, .24]} radius={.06} smoothness={2} position-x={length / 2} material={steel} />
      <RoundedBox args={[length * .64, width * .45, .015]} radius={.015} smoothness={1} position={[length / 2, 0, .13]} material={graphite} />
      <mesh position={[length / 2, width * .4, 0]} rotation-z={Math.PI / 2} material={graphite}><cylinderGeometry args={[.035, .035, length * .75, 8]} /></mesh>
    </group>;
  }
  return <group position={[index % 2 === 0 ? -2 : 1.25, 0, index < 2 ? .8 : -2.3]} rotation-y={-.35}>
    <RoundedBox args={[.72, .12, .72]} radius={.035} smoothness={1} position-y={.08} material={graphite} />
    <mesh position-y={.25} material={steel}><cylinderGeometry args={[.27, .32, .27, 24]} /></mesh>
    <mesh position-y={.42} material={graphite}><cylinderGeometry args={[.24, .27, .09, 24]} /></mesh>
    <mesh position-y={.47} material={indicator}><cylinderGeometry args={[.255, .255, .025, 24]} /></mesh>
    <group ref={turret} position-y={.5}>
      <RoundedBox args={[.36, .42, .32]} radius={.045} smoothness={1} position-y={.15} material={steel} />
      <group ref={shoulder} position={[0, .3, 0]} rotation-z={1.15}>
        <Joint radius={.23} /><Link length={upper} width={.3} />
        <group ref={elbow} position-x={upper} rotation-z={-1.95}>
          <Joint /><Link length={fore} width={.23} />
          <group ref={wrist} position-x={fore} rotation-z={-.77}>
            <Joint radius={.115} />
            <mesh position-x={.14} rotation-z={Math.PI / 2} material={steel}><cylinderGeometry args={[.095, .12, .23, 16]} /></mesh>
            {index === 0 ? <mesh position-x={.35} rotation-z={Math.PI / 2} material={graphite}><cylinderGeometry args={[.018, .06, .27, 10]} /></mesh>
              : index === 2 ? <group ref={scan} position-x={.29}>
                <RoundedBox args={[.2, .32, .32]} radius={.025} smoothness={1} material={graphite} />
                <mesh position-x={.105} rotation-z={Math.PI / 2} material={glass}><cylinderGeometry args={[.095, .095, .018, 16]} /></mesh>
                <mesh position-x={.116} rotation-z={Math.PI / 2} material={indicator}><torusGeometry args={[.072, .012, 5, 16]} /></mesh>
              </group> : <group position-x={.29}>
                <RoundedBox args={[.13, .22, .25]} radius={.02} smoothness={1} material={graphite} />
                <group ref={jaw} position-z={.1}><RoundedBox args={[.24, .06, .06]} radius={.012} smoothness={1} position-x={.1} material={steel} /></group>
                <RoundedBox args={[.24, .06, .06]} radius={.012} smoothness={1} position={[.1, 0, -.1]} material={steel} />
              </group>}
          </group>
        </group>
      </group>
    </group>
    {/* Physical bench, contrasting inset, workpiece and service rails. */}
    <RoundedBox args={[1.4, .12, 1.15]} radius={.03} smoothness={1} position={[1.18, .68, 0]} material={graphite} />
    <RoundedBox args={[1.15, .018, .88]} radius={.015} smoothness={1} position={[1.18, .75, 0]} material={steel} />
    <mesh position={[1.18, .77, 0]} rotation-x={-Math.PI / 2} material={selected ? indicator : graphite}><planeGeometry args={[.8, .6]} /></mesh>
    <mesh position={[1.18, .32, 0]} material={graphite}><cylinderGeometry args={[.08, .13, .6, 12]} /></mesh>
    {index === 1 && <RoundedBox args={[.35, .16, .25]} radius={.025} smoothness={1} position={[1.18, .87, 0]} material={graphite} />}
    {index === 3 && <mesh position={[1.18, .83, 0]} material={indicator}><cylinderGeometry args={[.14, .14, .12, 16]} /></mesh>}
  </group>;
}