import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, Group, OrthographicCamera, RepeatWrapping } from "three";

export type RobotPalette = { shell: string; joint: string; face: string; light: string; floor: string; line: string };

function Mechanism({ index, selected, moving, palette }: { index: number; selected: boolean; moving: boolean; palette: RobotPalette }) {
  const head = useRef<Group>(null);
  const left = useRef<Group>(null);
  const right = useRef<Group>(null);
  const time = useRef(0);
  useFrame((_, delta) => {
    if (!moving || !selected) return;
    time.current += Math.min(delta, .05);
    const t = time.current;
    if (head.current) head.current.rotation.y = Math.sin(t * (index === 2 ? .9 : .5)) * .2;
    if (left.current) left.current.rotation.x = -.65 + Math.sin(t * 1.4) * .13;
    if (right.current) {
      right.current.rotation.x = -.75 + Math.sin(t * (index === 1 ? 3 : 1.1)) * (index === 1 ? .3 : .14);
      right.current.rotation.z = -.12 + Math.cos(t * .7) * .1;
    }
  });
  const metal = <meshStandardMaterial color={palette.shell} metalness={.82} roughness={.27} />;
  const dark = <meshStandardMaterial color={palette.joint} metalness={.75} roughness={.42} />;
  const lit = <meshStandardMaterial color={palette.light} emissive={palette.light} emissiveIntensity={selected ? 1.3 : .15} metalness={.4} roughness={.3} />;
  return <group position={[(index - 1.5) * 2.25, 0, 0]} rotation-y={-.08}>
    {/* Exposed hip, pinned legs and machined foot housings. */}
    <RoundedBox args={[.65, .23, .36]} radius={.06} position={[0, .83, 0]}>{dark}</RoundedBox>
    {[-1, 1].map(side => <group key={side} position={[side * .21, .65, 0]}>
      <mesh position-y={-.17}><capsuleGeometry args={[.1, .35, 4, 12]} />{metal}</mesh>
      <mesh position={[0, -.4, .01]}><sphereGeometry args={[.12, 12, 8]} />{dark}</mesh>
      <RoundedBox args={[.23, .13, .44]} radius={.045} position={[0, -.56, .08]}>{metal}</RoundedBox>
    </group>)}
    <mesh position={[0, 1.01, 0]}><cylinderGeometry args={[.15, .18, .23, 16]} />{dark}</mesh>
    <RoundedBox args={[.77, .66, .39]} radius={.12} position={[0, 1.38, 0]}>{metal}</RoundedBox>
    <RoundedBox args={[.42, .25, .035]} radius={.035} position={[0, 1.4, .21]}>{dark}</RoundedBox>
    <mesh position={[0, 1.41, .236]}><boxGeometry args={[.27, .027, .01]} />{lit}</mesh>
    <mesh position={[0, 1.82, 0]}><cylinderGeometry args={[.105, .105, .16, 16]} />{dark}</mesh>
    <group ref={head} position={[0, 2.05, 0]}>
      <RoundedBox args={[.66, .44, .46]} radius={.12}>{metal}</RoundedBox>
      <RoundedBox args={[.52, .24, .045]} radius={.06} position={[0, .015, .235]}><meshStandardMaterial color={palette.face} metalness={.55} roughness={.16} /></RoundedBox>
      {[-.13, .13].map(x => <mesh key={x} position={[x, .03, .266]}><boxGeometry args={[.11, .025, .008]} />{lit}</mesh>)}
      {[-.36, .36].map(x => <mesh key={x} position={[x, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[.1, .1, .06, 16]} />{dark}</mesh>)}
    </group>
    {[-1, 1].map(side => <group key={side} ref={side < 0 ? left : right} position={[side * .48, 1.65, 0]} rotation={[-.65, 0, side * .14]}>
      <mesh><sphereGeometry args={[.14, 16, 10]} />{dark}</mesh>
      <mesh position-y={-.24}><capsuleGeometry args={[.09, .29, 4, 12]} />{metal}</mesh>
      <group position={[0, -.45, 0]} rotation-x={-.9}>
        <mesh><sphereGeometry args={[.11, 12, 8]} />{dark}</mesh>
        <mesh position-y={-.2}><capsuleGeometry args={[.075, .25, 4, 12]} />{metal}</mesh>
        <RoundedBox args={[.17, .13, .13]} radius={.025} position={[0, -.4, 0]}>{dark}</RoundedBox>
        {side > 0 && index === 1 && <mesh position={[0, -.5, 0]}><cylinderGeometry args={[.025, .04, .17, 10]} />{metal}</mesh>}
        {side > 0 && index === 2 && <mesh position={[0, -.45, .08]} rotation-x={Math.PI / 2}><cylinderGeometry args={[.09, .09, .035, 16]} />{lit}</mesh>}
      </group>
    </group>)}
    {/* Real stage selects the station; station movement never changes phases. */}
    <RoundedBox args={[1.3, .12, .8]} radius={.035} position={[0, 1.05, .78]}>{dark}</RoundedBox>
    <mesh position={[0, 1.12, .78]} rotation-x={-Math.PI / 2}><planeGeometry args={[.9, .5]} /><meshStandardMaterial color={palette.light} emissive={palette.light} emissiveIntensity={selected ? .55 : .04} roughness={.4} /></mesh>
    <mesh position={[0, .55, .78]}><boxGeometry args={[.09, 1, .09]} />{metal}</mesh>
  </group>;
}

function Workshop({ palette, selected, moving }: { palette: RobotPalette; selected: number; moving: boolean }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    if (camera instanceof OrthographicCamera) {
      camera.zoom = Math.min(size.width / 10.5, size.height / 3.3);
      camera.lookAt(0, 1.08, .3); camera.updateProjectionMatrix(); invalidate();
    }
  }, [camera, size.width, size.height, invalidate]);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = palette.floor; context.fillRect(0, 0, 128, 128);
      context.strokeStyle = palette.line; context.lineWidth = 1;
      context.strokeRect(.5, .5, 127, 127);
      for (let y = 4; y < 128; y += 4) { context.globalAlpha = .09; context.fillStyle = palette.line; context.fillRect(0, y, 128, 1); }
    }
    const map = new CanvasTexture(canvas); map.wrapS = map.wrapT = RepeatWrapping; map.repeat.set(10, 4); return map;
  }, [palette.floor, palette.line]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <>
    <ambientLight intensity={1} />
    <directionalLight position={[3, 6, 5]} intensity={2.5} />
    <Environment resolution={64} frames={1}>
      <Lightformer intensity={3} position={[0, 4, 2]} scale={[10, 3, 1]} />
      <Lightformer intensity={2} position={[-5, 2, 1]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} />
    </Environment>
    <mesh position={[0, -.03, .3]} rotation-x={-Math.PI / 2}><planeGeometry args={[12, 5]} /><meshStandardMaterial map={texture} metalness={.45} roughness={.55} transparent opacity={.7} /></mesh>
    {[0, 1, 2, 3].map(index => <Mechanism key={index} index={index} selected={index === selected} moving={moving} palette={palette} />)}
  </>;
}

export default function RobotScene({ palette, selected, moving, onUnavailable }: { palette: RobotPalette; selected: number; moving: boolean; onUnavailable: () => void }) {
  return <Canvas orthographic camera={{ position: [0, 3.5, 8], zoom: 43 }} dpr={1} frameloop={moving ? "always" : "demand"} gl={{ antialias: true, alpha: true }} onCreated={({ gl, camera }) => {
    camera.lookAt(0, 1.08, .3);
    gl.domElement.addEventListener("webglcontextlost", onUnavailable, { once: true });
  }} fallback={<span className="text-muted-foreground">Kimble is working</span>}>
    <Workshop palette={palette} selected={selected} moving={moving} />
  </Canvas>;
}