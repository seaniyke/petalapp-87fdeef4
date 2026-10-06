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
export function IndustrialRobot({
  index,
  selected,
  moving,
  materials,
}: {
  index: number;
  selected: boolean;
  moving: boolean;
  materials: WorkshopMaterials;
}) {
  const turret = useRef<Group>(null);
  const shoulder = useRef<Group>(null);
  const elbow = useRef<Group>(null);
  const wrist = useRef<Group>(null);
  const jaw = useRef<Group>(null);
  const scan = useRef<Group>(null);
  const time = useRef(0);
  const upper = 1.04;
  const fore = 0.95;
  useFrame((_, rawDelta) => {
    if (!moving || !selected) return;
    const dt = Math.min(rawDelta, 0.05);
    time.current += dt;
    const t = time.current;
    // Distinct physical work paths, never a timed sequence of build phases.
    const radial =
      index === 0
        ? 1.1 + Math.sin(t * 1.25) * 0.24
        : index === 1
          ? 1.05 + Math.sin(t * 1.8) * 0.25
          : index === 2
            ? 1.12 + Math.sin(t * 0.95) * 0.3
            : 1.08 + Math.sin(t * 0.8) * 0.2;
    const height =
      index === 1
        ? 0.48 + (1 + Math.sin(t * 2.4)) * 0.19
        : index === 2
          ? 0.65 + Math.sin(t * 0.95) * 0.08
          : 0.48 + Math.cos(t * 1.25) * 0.09;
    const yaw = -0.12 + Math.sin(t * (index === 0 ? 0.75 : 0.55)) * 0.36;
    const bend = Math.acos(
      MathUtils.clamp(
        (radial * radial + height * height - upper * upper - fore * fore) / (2 * upper * fore),
        -1,
        1,
      ),
    );
    const lift =
      Math.atan2(height, radial) + Math.atan2(fore * Math.sin(bend), upper + fore * Math.cos(bend));
    const damping = 1 - Math.exp(-8 * dt);
    if (turret.current)
      turret.current.rotation.y = MathUtils.lerp(turret.current.rotation.y, yaw, damping);
    if (shoulder.current)
      shoulder.current.rotation.z = MathUtils.lerp(shoulder.current.rotation.z, lift, damping);
    if (elbow.current)
      elbow.current.rotation.z = MathUtils.lerp(elbow.current.rotation.z, -bend, damping);
    if (wrist.current)
      wrist.current.rotation.z = MathUtils.lerp(
        wrist.current.rotation.z,
        -Math.PI / 2 - lift + bend,
        damping,
      );
    if (jaw.current) jaw.current.position.z = 0.085 + (1 + Math.sin(t * 2.4)) * 0.035;
    if (scan.current) scan.current.rotation.y = Math.sin(t * 0.95) * 0.35;
  });
  const { steel, graphite, indicator, glass } = materials;
  function Joint({ radius = 0.18 }: { radius?: number }) {
    return (
      <group>
        <mesh rotation-x={Math.PI / 2} material={graphite}>
          <cylinderGeometry args={[radius, radius, 0.3, 20]} />
        </mesh>
        <mesh position-z={0.17} rotation-x={Math.PI / 2} material={steel}>
          <cylinderGeometry args={[radius * 0.82, radius * 0.82, 0.05, 20]} />
        </mesh>
        <mesh position-z={0.201} rotation-x={Math.PI / 2} material={indicator}>
          <torusGeometry args={[radius * 0.55, 0.016, 5, 20]} />
        </mesh>
      </group>
    );
  }
  function Link({ length, width }: { length: number; width: number }) {
    return (
      <group>
        <RoundedBox
          args={[length, width, 0.24]}
          radius={0.06}
          smoothness={2}
          position-x={length / 2}
          material={steel}
        />
        <RoundedBox
          args={[length * 0.64, width * 0.45, 0.015]}
          radius={0.015}
          smoothness={1}
          position={[length / 2, 0, 0.13]}
          material={graphite}
        />
        <mesh position={[length / 2, width * 0.4, 0]} rotation-z={Math.PI / 2} material={graphite}>
          <cylinderGeometry args={[0.035, 0.035, length * 0.75, 8]} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[index % 2 === 0 ? -2 : 1.25, 0, index < 2 ? 0.8 : -2.3]} rotation-y={-0.35}>
      <RoundedBox
        args={[0.72, 0.12, 0.72]}
        radius={0.035}
        smoothness={1}
        position-y={0.08}
        material={graphite}
      />
      <mesh position-y={0.25} material={steel}>
        <cylinderGeometry args={[0.27, 0.32, 0.27, 24]} />
      </mesh>
      <mesh position-y={0.42} material={graphite}>
        <cylinderGeometry args={[0.24, 0.27, 0.09, 24]} />
      </mesh>
      <mesh position-y={0.47} material={indicator}>
        <cylinderGeometry args={[0.255, 0.255, 0.025, 24]} />
      </mesh>
      <group ref={turret} position-y={0.5}>
        <RoundedBox
          args={[0.36, 0.42, 0.32]}
          radius={0.045}
          smoothness={1}
          position-y={0.15}
          material={steel}
        />
        <group ref={shoulder} position={[0, 0.3, 0]} rotation-z={1.15}>
          <Joint radius={0.23} />
          <Link length={upper} width={0.3} />
          <group ref={elbow} position-x={upper} rotation-z={-1.95}>
            <Joint />
            <Link length={fore} width={0.23} />
            <group ref={wrist} position-x={fore} rotation-z={-0.77}>
              <Joint radius={0.115} />
              <mesh position-x={0.14} rotation-z={Math.PI / 2} material={steel}>
                <cylinderGeometry args={[0.095, 0.12, 0.23, 16]} />
              </mesh>
              {index === 0 ? (
                <mesh position-x={0.35} rotation-z={Math.PI / 2} material={graphite}>
                  <cylinderGeometry args={[0.018, 0.06, 0.27, 10]} />
                </mesh>
              ) : index === 2 ? (
                <group ref={scan} position-x={0.29}>
                  <RoundedBox
                    args={[0.2, 0.32, 0.32]}
                    radius={0.025}
                    smoothness={1}
                    material={graphite}
                  />
                  <mesh position-x={0.105} rotation-z={Math.PI / 2} material={glass}>
                    <cylinderGeometry args={[0.095, 0.095, 0.018, 16]} />
                  </mesh>
                  <mesh position-x={0.116} rotation-z={Math.PI / 2} material={indicator}>
                    <torusGeometry args={[0.072, 0.012, 5, 16]} />
                  </mesh>
                </group>
              ) : (
                <group position-x={0.29}>
                  <RoundedBox
                    args={[0.13, 0.22, 0.25]}
                    radius={0.02}
                    smoothness={1}
                    material={graphite}
                  />
                  <group ref={jaw} position-z={0.1}>
                    <RoundedBox
                      args={[0.24, 0.06, 0.06]}
                      radius={0.012}
                      smoothness={1}
                      position-x={0.1}
                      material={steel}
                    />
                  </group>
                  <RoundedBox
                    args={[0.24, 0.06, 0.06]}
                    radius={0.012}
                    smoothness={1}
                    position={[0.1, 0, -0.1]}
                    material={steel}
                  />
                </group>
              )}
            </group>
          </group>
        </group>
      </group>
      {/* Physical bench, contrasting inset, workpiece and service rails. */}
      <RoundedBox
        args={[1.4, 0.12, 1.15]}
        radius={0.03}
        smoothness={1}
        position={[1.18, 0.68, 0]}
        material={graphite}
      />
      <RoundedBox
        args={[1.15, 0.018, 0.88]}
        radius={0.015}
        smoothness={1}
        position={[1.18, 0.75, 0]}
        material={steel}
      />
      <mesh
        position={[1.18, 0.77, 0]}
        rotation-x={-Math.PI / 2}
        material={selected ? indicator : graphite}
      >
        <planeGeometry args={[0.8, 0.6]} />
      </mesh>
      <mesh position={[1.18, 0.32, 0]} material={graphite}>
        <cylinderGeometry args={[0.08, 0.13, 0.6, 12]} />
      </mesh>
      {index === 1 && (
        <RoundedBox
          args={[0.35, 0.16, 0.25]}
          radius={0.025}
          smoothness={1}
          position={[1.18, 0.87, 0]}
          material={graphite}
        />
      )}
      {index === 3 && (
        <mesh position={[1.18, 0.83, 0]} material={indicator}>
          <cylinderGeometry args={[0.14, 0.14, 0.12, 16]} />
        </mesh>
      )}
    </group>
  );
}
