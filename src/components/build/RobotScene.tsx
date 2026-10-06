import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { Suspense, useEffect, useMemo } from "react";
import { CanvasTexture, MeshStandardMaterial, OrthographicCamera, RepeatWrapping } from "three";
import { IndustrialRobot } from "./IndustrialRobot";
export type RobotPalette = {
  shell: string;
  joint: string;
  face: string;
  light: string;
  floor: string;
  line: string;
};
function Workshop({
  palette,
  selected,
  moving,
}: {
  palette: RobotPalette;
  selected: number;
  moving: boolean;
}) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    if (camera instanceof OrthographicCamera) {
      camera.zoom = Math.min(size.width / 7.8, size.height / 5.4);
      camera.position.set(5, 5.6, 8);
      camera.lookAt(0.25, 0.85, -0.5);
      camera.updateProjectionMatrix();
      invalidate();
    }
  }, [camera, size.width, size.height, invalidate]);
  const resources = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = palette.shell;
      context.fillRect(0, 0, 256, 256);
      context.fillStyle = palette.joint;
      for (let y = 0; y < 256; y++) {
        context.globalAlpha = 0.025 + (y % 7) * 0.005;
        context.fillRect(0, y, 256, 1);
      }
    }
    const brush = new CanvasTexture(canvas);
    brush.wrapS = brush.wrapT = RepeatWrapping;
    const steel = new MeshStandardMaterial({ map: brush, metalness: 0.86, roughness: 0.32 });
    const graphite = new MeshStandardMaterial({
      color: palette.joint,
      metalness: 0.65,
      roughness: 0.44,
    });
    const indicator = new MeshStandardMaterial({
      color: palette.light,
      emissive: palette.light,
      emissiveIntensity: 0.4,
      metalness: 0.35,
      roughness: 0.3,
    });
    const glass = new MeshStandardMaterial({
      color: palette.face,
      metalness: 0.7,
      roughness: 0.09,
    });
    return { brush, materials: { steel, graphite, indicator, glass } };
  }, [palette]);
  useEffect(
    () => () => {
      resources.brush.dispose();
      Object.values(resources.materials).forEach((m) => m.dispose());
    },
    [resources],
  );
  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[-2, 6, 4]} intensity={3} />
      <directionalLight position={[4, 3, -4]} intensity={2} color={palette.light} />
      <Environment resolution={128} frames={1}>
        <Lightformer
          intensity={4}
          position={[0, 5, 0]}
          rotation-x={Math.PI / 2}
          scale={[7, 5, 1]}
        />
        <Lightformer
          intensity={3}
          position={[-4, 2, 3]}
          rotation-y={Math.PI / 3}
          scale={[2, 5, 1]}
        />
        <Lightformer
          intensity={2}
          position={[4, 2, -2]}
          rotation-y={-Math.PI / 2}
          scale={[2, 4, 1]}
        />
      </Environment>
      <mesh position={[0.3, -0.02, -0.3]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[7.6, 6.7]} />
        <meshStandardMaterial color={palette.floor} metalness={0.35} roughness={0.5} />
      </mesh>
      <gridHelper args={[7.6, 16, palette.line, palette.line]} position={[0.3, -0.008, -0.3]} />
      {[0, 1, 2, 3].map((index) => (
        <IndustrialRobot
          key={index}
          index={index}
          selected={index === selected}
          moving={moving}
          materials={resources.materials}
        />
      ))}
    </>
  );
}
export default function RobotScene({
  palette,
  selected,
  moving,
  onUnavailable,
}: {
  palette: RobotPalette;
  selected: number;
  moving: boolean;
  onUnavailable: () => void;
}) {
  return (
    <Canvas
      orthographic
      camera={{ position: [5, 5.6, 8], zoom: 48 }}
      dpr={[1, 1.5]}
      frameloop={moving ? "always" : "demand"}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", onUnavailable, { once: true });
      }}
      fallback={<span className="text-muted-foreground">Robotics unavailable</span>}
    >
      <Suspense fallback={null}>
        <Workshop palette={palette} selected={selected} moving={moving} />
      </Suspense>
    </Canvas>
  );
}
