import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Link2, Link2Off, Sun } from 'lucide-react';
import { computeBoundsFromCenter } from '../../data/candidates';
import {
  evaluateColormapRGB,
  type ScientificColormap,
} from '../../lib/elevation/colormaps';
import { formatSiteFullName } from '../../lib/formatSite';
import { getMetricWindowBbox, selectSiteProjection } from '../../lib/geo/polarProjection';
import {
  computeHillshadeAtUV,
  computePercentilesP2P98,
  generateDemNormalMapRgba,
  sampleElevationAtUVStrict,
  sampleSlopeAspectAtUV,
} from '../../lib/terrain/terrainExtractor';
import { useWorkspaceStore, type Layer3dMode } from '../../store/useWorkspaceStore';
import type { DemGridData, GeoBounds, SiteRecord } from '../../types/site';

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function getSite20KmBounds(site: SiteRecord): GeoBounds {
  if (site.demGrid?.bounds) return site.demGrid.bounds;
  return computeBoundsFromCenter(site.lat, site.lon, 10, site.body).bounds;
}

function getImageryUrl2048(site: SiteRecord, bounds: GeoBounds): string {
  const projInfo = selectSiteProjection(site.body, site.lat);
  if (projInfo.isPolar && projInfo.supported) {
    const mb = getMetricWindowBbox(site.body, site.lat, site.lon, site.radiusKm, 'imagery');
    const projParam =
      projInfo.id === 'EPSG:3031'
        ? 'epsg3031'
        : projInfo.id === 'EPSG:3413'
          ? 'epsg3413'
          : mb.pole === 'south'
            ? 'stereo_south'
            : 'stereo_north';
    const mbbox = `${mb.minX},${mb.minY},${mb.maxX},${mb.maxY}`;
    return `/api/gis/imagery?body=${site.body}&proj=${projParam}&mbbox=${encodeURIComponent(mbbox)}&size=2048`;
  }
  const sr = Math.abs(site.lat) > 82 ? '4326' : '3857';
  const bbox = `${bounds.minLon.toFixed(5)},${bounds.minLat.toFixed(5)},${bounds.maxLon.toFixed(5)},${bounds.maxLat.toFixed(5)}`;
  return `/api/gis/imagery?body=${site.body}&bbox=${encodeURIComponent(bbox)}&size=2048&sr=${sr}`;
}

function getImagerySourceLabel(site: SiteRecord): string {
  if (site.body === 'MARS') return 'NASA Trek Viking MDIM 2.1';
  if (site.body === 'MOON') return 'NASA Trek LRO WAC Mosaic';
  return 'Esri World Imagery';
}

interface NormalizedTerrainField {
  normalized: Float32Array;
  minY: number;
  maxY: number;
  minElevM: number;
  maxElevM: number;
  p2M: number;
  p98M: number;
}

function sampleNormalizedMeshFromDem(
  dem: DemGridData,
  res: number,
  exaggeration: number
): NormalizedTerrainField {
  const pct = computePercentilesP2P98(dem.elevations);
  const span = Math.max(1, pct.maxM - pct.minM);
  const out = new Float32Array(res * res);
  let minY = Infinity;
  let maxY = -Infinity;

  for (let gy = 0; gy < res; gy++) {
    const v = gy / (res - 1);
    for (let gx = 0; gx < res; gx++) {
      const u = gx / (res - 1);
      const z = sampleElevationAtUVStrict(dem, u, v) ?? pct.minM;
      const norm = Math.max(0, Math.min(1, (z - pct.minM) / span));
      out[gy * res + gx] = norm;
      const y = (norm - 0.35) * 1.9 * exaggeration;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return {
    normalized: out,
    minY: Number.isFinite(minY) ? minY : -0.6,
    maxY: Number.isFinite(maxY) ? maxY : 0.8,
    minElevM: pct.minM,
    maxElevM: pct.maxM,
    p2M: pct.p2M,
    p98M: pct.p98M,
  };
}

function createProceduralCanvasTexture(
  dem: DemGridData,
  mode: 'hillshade' | 'elevation' | 'slope',
  colormap: ScientificColormap,
  sunAzimuthDeg: number,
  hillshadeZFactor: number,
  p2M: number,
  p98M: number,
  maxAniso: number
): THREE.CanvasTexture {
  const texSize = 512;
  const canvas = document.createElement('canvas');
  canvas.width = texSize;
  canvas.height = texSize;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(texSize, texSize);
    const pSpan = Math.max(1e-3, p98M - p2M);

    for (let py = 0; py < texSize; py++) {
      const v = py / (texSize - 1);
      for (let px = 0; px < texSize; px++) {
        const u = px / (texSize - 1);
        const idx = (py * texSize + px) * 4;
        if (mode === 'hillshade') {
          const shade = computeHillshadeAtUV(dem, u, v, sunAzimuthDeg, 35, hillshadeZFactor);
          const g = Math.round(Math.max(0, Math.min(255, shade * 255)));
          img.data[idx] = g;
          img.data[idx + 1] = g;
          img.data[idx + 2] = g;
          img.data[idx + 3] = 255;
        } else if (mode === 'elevation') {
          const zStrict = sampleElevationAtUVStrict(dem, u, v);
          if (zStrict === null) {
            img.data[idx] = 22;
            img.data[idx + 1] = 26;
            img.data[idx + 2] = 32;
            img.data[idx + 3] = 255;
          } else {
            const norm = Math.max(0, Math.min(1, (zStrict - p2M) / pSpan));
            const [r, g, b] = evaluateColormapRGB(colormap, norm);
            const shade = 0.72 + 0.32 * computeHillshadeAtUV(dem, u, v, sunAzimuthDeg, 35, hillshadeZFactor);
            img.data[idx] = Math.round(Math.min(255, r * shade));
            img.data[idx + 1] = Math.round(Math.min(255, g * shade));
            img.data[idx + 2] = Math.round(Math.min(255, b * shade));
            img.data[idx + 3] = 255;
          }
        } else {
          const { slopeDeg } = sampleSlopeAspectAtUV(dem, u, v);
          if (slopeDeg === null) {
            // PSR / no data pixel rendered in muted dark slate
            img.data[idx] = 22;
            img.data[idx + 1] = 26;
            img.data[idx + 2] = 32;
          } else if (slopeDeg > 35) {
            // Steep hazard highlight (>35 deg) in calibrated Mars rust
            img.data[idx] = 200;
            img.data[idx + 1] = 85;
            img.data[idx + 2] = 61;
          } else {
            const t = Math.max(0, Math.min(1, slopeDeg / 35));
            // Flat #1B2028 -> Steep #D4D8DF
            img.data[idx] = Math.round(27 + (212 - 27) * t);
            img.data[idx + 1] = Math.round(32 + (216 - 32) * t);
            img.data[idx + 2] = Math.round(40 + (223 - 40) * t);
          }
          img.data[idx + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(16, Math.max(8, maxAniso));
  texture.needsUpdate = true;
  return texture;
}

function createDemNormalDataTexture(dem: DemGridData, exaggeration: number): THREE.DataTexture {
  const rgba = generateDemNormalMapRgba(dem, exaggeration * 1.15);
  const tex = new THREE.DataTexture(rgba, dem.width, dem.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

function disposeGroupResources(group: THREE.Group | null) {
  if (!group) return;
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        std.map?.dispose();
        std.normalMap?.dispose();
        mat.dispose();
      }
    }
  });
}

function updateKeyLightFromAzimuth(light: THREE.DirectionalLight | null, azimuthDeg: number) {
  if (!light) return;
  const rad = ((azimuthDeg - 90) * Math.PI) / 180;
  const radius = 12;
  light.position.set(Math.cos(rad) * radius, 11.5, Math.sin(rad) * radius);
}

export interface CameraSyncPayload {
  position: [number, number, number];
  target: [number, number, number];
}

interface SingleTerrainViewportProps {
  side: 'target' | 'analog';
  site: SiteRecord;
  layer3dMode: Layer3dMode;
  colormap: ScientificColormap;
  verticalExaggeration: number;
  sunAzimuthDeg: number;
  hillshadeZFactor: number;
  showWireframe: boolean;
  transectA: { u: number; v: number };
  transectB: { u: number; v: number };
  accentColor: string;
  label: string;
  testId: string;
  linkCameras: boolean;
  onCameraMove: (side: 'target' | 'analog', payload: CameraSyncPayload) => void;
  registerSyncReceiver: (
    side: 'target' | 'analog',
    fn: ((payload: CameraSyncPayload) => void) | null
  ) => void;
}

const SingleTerrainViewport: React.FC<SingleTerrainViewportProps> = ({
  side,
  site,
  layer3dMode,
  colormap,
  verticalExaggeration,
  sunAzimuthDeg,
  hillshadeZFactor,
  showWireframe,
  transectA,
  transectB,
  accentColor,
  label,
  testId,
  linkCameras,
  onCameraMove,
  registerSyncReceiver,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const terrainGroupRef = useRef<THREE.Group | null>(null);
  const terrainMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const wireMeshRef = useRef<THREE.Mesh | null>(null);
  const requestRenderRef = useRef<(() => void) | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const suppressSyncEmitRef = useRef(false);

  const linkCamerasRef = useRef(linkCameras);
  linkCamerasRef.current = linkCameras;
  const onCameraMoveRef = useRef(onCameraMove);
  onCameraMoveRef.current = onCameraMove;

  const [surfaceCanvasTex, setSurfaceCanvasTex] = useState<THREE.CanvasTexture | null>(null);
  const [surfaceUnavailable, setSurfaceUnavailable] = useState(false);

  const bounds20Km = useMemo(() => getSite20KmBounds(site), [site]);

  // Fetch high-res 2048x2048 surface imagery aligned to the site's 20x20 km bounds
  useEffect(() => {
    let cancelled = false;
    setSurfaceUnavailable(false);

    const url = getImageryUrl2048(site, bounds20Km);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
      if (cancelled || img.naturalWidth === 0) return;
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 2048;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, 2048, 2048);

      const maxAniso = rendererRef.current?.capabilities.getMaxAnisotropy() ?? 8;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = Math.min(16, Math.max(8, maxAniso));
      tex.needsUpdate = true;

      setSurfaceCanvasTex((prev) => {
        prev?.dispose();
        return tex;
      });
    };

    img.onerror = () => {
      if (!cancelled) {
        setSurfaceUnavailable(true);
        setSurfaceCanvasTex((prev) => {
          prev?.dispose();
          return null;
        });
      }
    };

    img.src = url;

    return () => {
      cancelled = true;
    };
  }, [site.id, site.body, bounds20Km]);

  // Dispose cached surface texture on unmount
  useEffect(() => {
    return () => {
      surfaceCanvasTex?.dispose();
    };
  }, [surfaceCanvasTex]);

  // Single mount lifecycle for WebGLRenderer & OrbitControls
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = Math.max(260, container.clientWidth);
    const height = Math.max(260, container.clientHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d10);
    scene.fog = new THREE.FogExp2(0x0b0d10, 0.018);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 100);
    camera.position.set(6.8, 5.2, 7.0);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = false;
    rendererRef.current = renderer;

    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x181b22, 0.7);
    const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.55);
    updateKeyLightFromAzimuth(keyLight, sunAzimuthDeg);
    keyLightRef.current = keyLight;
    const rimLight = new THREE.DirectionalLight(0x94a3b8, 0.35);
    rimLight.position.set(-8, 4.5, -7);
    scene.add(hemi, keyLight, rimLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.autoRotate = false;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 4.2;
    controls.maxDistance = 18;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      gl.flush();
      const poll = () => {
        if (disposed) {
          gl.deleteSync(sync);
          return;
        }
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        controls.update();
        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty && !disposed) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    requestRenderRef.current = requestRender;

    const onControlsChange = () => {
      requestRender();
      if (suppressSyncEmitRef.current || !linkCamerasRef.current) return;
      onCameraMoveRef.current(side, {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      });
    };
    controls.addEventListener('change', onControlsChange);

    registerSyncReceiver(side, (payload) => {
      if (disposed) return;
      suppressSyncEmitRef.current = true;
      camera.position.set(payload.position[0], payload.position[1], payload.position[2]);
      controls.target.set(payload.target[0], payload.target[1], payload.target[2]);
      controls.update();
      suppressSyncEmitRef.current = false;
      requestRender();
    });

    const observer = new ResizeObserver(() => {
      if (disposed || !container) return;
      const w = Math.max(220, container.clientWidth);
      const h = Math.max(220, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    observer.observe(container);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    requestRender();

    return () => {
      disposed = true;
      registerSyncReceiver(side, null);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      observer.disconnect();
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      disposeGroupResources(terrainGroupRef.current);
      if (terrainGroupRef.current) scene.remove(terrainGroupRef.current);
      envTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      rendererRef.current = null;
      keyLightRef.current = null;
      terrainGroupRef.current = null;
      terrainMatRef.current = null;
      wireMeshRef.current = null;
      requestRenderRef.current = null;
      controlsRef.current = null;
      cameraRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build / rebuild terrain mesh when DEM, exaggeration, layer mode, colormap, sun azimuth, or transect changes
  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene || !renderer) return;

    updateKeyLightFromAzimuth(keyLightRef.current, sunAzimuthDeg);

    if (terrainGroupRef.current) {
      scene.remove(terrainGroupRef.current);
      // Do not dispose shared surfaceCanvasTex managed by separate effect
      terrainGroupRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            const std = mat as THREE.MeshStandardMaterial;
            if (std.map && std.map !== surfaceCanvasTex) {
              std.map.dispose();
            }
            std.normalMap?.dispose();
            mat.dispose();
          }
        }
      });
      terrainGroupRef.current = null;
      terrainMatRef.current = null;
      wireMeshRef.current = null;
    }

    if (!site.demGrid) {
      requestRenderRef.current?.();
      return;
    }

    const dem = site.demGrid;
    const group = new THREE.Group();
    const res = 72;
    const size = 8.4;
    const field = sampleNormalizedMeshFromDem(dem, res, verticalExaggeration);

    const geom = new THREE.PlaneGeometry(size, size, res - 1, res - 1);
    geom.rotateX(-Math.PI / 2);

    const posAttr = geom.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const hNorm = field.normalized[i] ?? 0.5;
      posAttr.setY(i, (hNorm - 0.35) * 1.9 * verticalExaggeration);
    }
    geom.computeVertexNormals();

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    let diffuseTex: THREE.CanvasTexture;
    if (layer3dMode === 'surface' && surfaceCanvasTex) {
      diffuseTex = surfaceCanvasTex;
      diffuseTex.anisotropy = Math.min(16, Math.max(8, maxAniso));
    } else {
      const fallbackMode = layer3dMode === 'surface' ? 'hillshade' : layer3dMode;
      diffuseTex = createProceduralCanvasTexture(
        dem,
        fallbackMode,
        colormap,
        sunAzimuthDeg,
        hillshadeZFactor,
        field.p2M,
        field.p98M,
        maxAniso
      );
    }

    const normalMap = createDemNormalDataTexture(dem, verticalExaggeration);
    const terrainMat = new THREE.MeshStandardMaterial({
      map: diffuseTex,
      normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: layer3dMode === 'surface' ? 0.82 : 0.74,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    terrainMatRef.current = terrainMat;

    const terrainMesh = new THREE.Mesh(geom, terrainMat);
    group.add(terrainMesh);

    // Thinner neutral plinth neatly anchored below lowest vertex
    const plinthHeight = 0.14;
    const plinthGeo = new THREE.BoxGeometry(size, plinthHeight, size);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x14171e,
      roughness: 0.9,
      metalness: 0.15,
    });
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    plinthMesh.position.y = field.minY - plinthHeight * 0.5 - 0.08;
    group.add(plinthMesh);

    // Subtle toggleable wireframe (default OFF)
    const wireGeo = geom.clone();
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x9aa3b2,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
    });
    const wireMesh = new THREE.Mesh(wireGeo, wireMat);
    wireMesh.position.y = 0.015;
    wireMesh.visible = showWireframe;
    wireMeshRef.current = wireMesh;
    group.add(wireMesh);

    // Thin 2px-like transect A–A' line + minimal clean pins
    const transectPoints: THREE.Vector3[] = [];
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = transectA.u + (transectB.u - transectA.u) * t;
      const v = transectA.v + (transectB.v - transectA.v) * t;
      const gx = Math.min(res - 1, Math.max(0, Math.round(u * (res - 1))));
      const gy = Math.min(res - 1, Math.max(0, Math.round(v * (res - 1))));
      const hNorm = field.normalized[gy * res + gx] ?? 0.5;
      const wx = (u - 0.5) * size;
      const wz = (v - 0.5) * size;
      const wy = (hNorm - 0.35) * 1.9 * verticalExaggeration + 0.06;
      transectPoints.push(new THREE.Vector3(wx, wy, wz));
    }

    const curve = new THREE.CatmullRomCurve3(transectPoints);
    const tubeGeo = new THREE.TubeGeometry(curve, 36, 0.015, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
    group.add(new THREE.Mesh(tubeGeo, tubeMat));

    const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.38, 8);
    const stemMat = new THREE.MeshBasicMaterial({ color: 0xe2e6ed });
    const headGeo = new THREE.SphereGeometry(0.06, 12, 12);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });

    const startPt = transectPoints[0];
    const endPt = transectPoints[transectPoints.length - 1];
    const stemA = new THREE.Mesh(stemGeo, stemMat);
    stemA.position.set(startPt.x, startPt.y + 0.19, startPt.z);
    const headA = new THREE.Mesh(headGeo, headMat);
    headA.position.set(startPt.x, startPt.y + 0.39, startPt.z);

    const stemB = new THREE.Mesh(stemGeo, stemMat);
    stemB.position.set(endPt.x, endPt.y + 0.19, endPt.z);
    const headB = new THREE.Mesh(headGeo, headMat);
    headB.position.set(endPt.x, endPt.y + 0.39, endPt.z);
    group.add(stemA, headA, stemB, headB);

    scene.add(group);
    terrainGroupRef.current = group;
    requestRenderRef.current?.();
  }, [
    site.demGrid,
    layer3dMode,
    surfaceCanvasTex,
    colormap,
    verticalExaggeration,
    sunAzimuthDeg,
    hillshadeZFactor,
    transectA,
    transectB,
    showWireframe,
  ]);

  // Fast toggle for wireframe without full mesh rebuild
  useEffect(() => {
    if (wireMeshRef.current) {
      wireMeshRef.current.visible = showWireframe;
      requestRenderRef.current?.();
    }
  }, [showWireframe]);

  const elevStats = useMemo(() => {
    if (!site.demGrid) return null;
    return computePercentilesP2P98(site.demGrid.elevations);
  }, [site.demGrid]);

  const demSourceLabel = site.features?.provenance.source ?? site.demGrid?.source ?? 'DEM pending';
  const imageryLabel = getImagerySourceLabel(site);

  return (
    <div className="relative w-full h-full bg-[#0B0D10]">
      <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full bg-[#101217]/85 border border-white/10 px-3.5 py-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accentColor }} />
        <span className="text-[14px] font-medium text-[#F2F4F8] whitespace-nowrap">{label}</span>
      </div>

      {layer3dMode === 'surface' && surfaceUnavailable && site.demGrid && (
        <div className="pointer-events-none absolute top-32 left-1/2 -translate-x-1/2 z-10 rounded-lg bg-[#101217]/90 border border-[#D9A441]/35 px-3 py-1 text-[13px] text-[#D9A441] whitespace-nowrap">
          Surface imagery unavailable, showing hillshade
        </div>
      )}

      {elevStats && (
        <div
          className={`pointer-events-none absolute bottom-10 ${
            side === 'target' ? 'left-4' : 'right-4'
          } z-10 flex items-center gap-2 rounded-lg bg-[#101217]/85 border border-white/10 px-2.5 py-1 font-mono text-[13px] text-[#C7CEDB] tabular-nums`}
        >
          <span>min {Math.round(elevStats.minM)} m</span>
          <span className="text-[#6B7280]">&middot;</span>
          <span>max {Math.round(elevStats.maxM)} m</span>
        </div>
      )}

      <div
        className={`pointer-events-none absolute bottom-4 ${
          side === 'target' ? 'left-4 text-left' : 'right-4 text-right'
        } z-10 text-[13px] text-[#9AA3B2] truncate max-w-[300px]`}
      >
        {layer3dMode === 'surface' && !surfaceUnavailable
          ? `${imageryLabel} · ${demSourceLabel}`
          : demSourceLabel}
      </div>

      {!site.demGrid && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
          <div className="rounded-xl bg-[#101217]/92 border border-white/10 px-4 py-3 text-[14px] text-[#9AA3B2] text-center max-w-sm">
            {site.demStatus === 'loading'
              ? 'Acquiring real elevation raster…'
              : '3D DEM mesh unavailable — no measured raster cached for this site.'}
          </div>
        </div>
      )}

      <div ref={mountRef} className="w-full h-full" data-testid={testId} />
    </div>
  );
};

const MODE_3D_OPTIONS: Array<{ id: Layer3dMode; label: string }> = [
  { id: 'surface', label: 'Surface' },
  { id: 'hillshade', label: 'Hillshade' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'slope', label: 'Slope' },
];

export const Terrain3DPreview: React.FC = () => {
  const sites = useWorkspaceStore((s) => s.sites);
  const activeTargetId = useWorkspaceStore((s) => s.activeTargetId);
  const activeAnalogId = useWorkspaceStore((s) => s.activeAnalogId);
  const layer3dMode = useWorkspaceStore((s) => s.layer3dMode);
  const colormap = useWorkspaceStore((s) => s.colormap);
  const verticalExaggeration = useWorkspaceStore((s) => s.verticalExaggeration);
  const sunAzimuthDeg = useWorkspaceStore((s) => s.sunAzimuthDeg);
  const hillshadeZFactor = useWorkspaceStore((s) => s.hillshadeZFactor);
  const link3dCameras = useWorkspaceStore((s) => s.link3dCameras);
  const show3dWireframe = useWorkspaceStore((s) => s.show3dWireframe);
  const transectA = useWorkspaceStore((s) => s.transectA);
  const transectB = useWorkspaceStore((s) => s.transectB);

  const setLayer3dMode = useWorkspaceStore((s) => s.setLayer3dMode);
  const setLink3dCameras = useWorkspaceStore((s) => s.setLink3dCameras);
  const setSunAzimuthDeg = useWorkspaceStore((s) => s.setSunAzimuthDeg);

  const [showOrbitHint, setShowOrbitHint] = useState(true);
  const receiversRef = useRef<{
    target: ((payload: CameraSyncPayload) => void) | null;
    analog: ((payload: CameraSyncPayload) => void) | null;
  }>({ target: null, analog: null });

  const registerSyncReceiver = useCallback(
    (side: 'target' | 'analog', fn: ((payload: CameraSyncPayload) => void) | null) => {
      receiversRef.current[side] = fn;
    },
    []
  );

  const handleCameraMove = useCallback(
    (sourceSide: 'target' | 'analog', payload: CameraSyncPayload) => {
      if (!link3dCameras) return;
      const otherSide = sourceSide === 'target' ? 'analog' : 'target';
      receiversRef.current[otherSide]?.(payload);
    },
    [link3dCameras]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setShowOrbitHint(false), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  const target =
    sites.find((s) => s.id === activeTargetId) ?? sites.find((s) => s.body !== 'EARTH');
  const analog =
    sites.find((s) => s.id === activeAnalogId) ?? sites.find((s) => s.body === 'EARTH');

  if (!target || !analog) return null;

  const targetAccent = target.body === 'MOON' ? '#A9B4BF' : '#E08A5B';

  return (
    <section
      aria-label="Side-by-side 3D elevation meshes"
      className="relative w-full h-full bg-[#0B0D10] overflow-hidden"
    >
      <div className="w-full h-full grid grid-cols-1 lg:grid-cols-2">
        <div className="relative w-full h-full lg:border-r lg:border-white/10">
          <SingleTerrainViewport
            side="target"
            site={target}
            layer3dMode={layer3dMode}
            colormap={colormap}
            verticalExaggeration={verticalExaggeration}
            sunAzimuthDeg={sunAzimuthDeg}
            hillshadeZFactor={hillshadeZFactor}
            showWireframe={show3dWireframe}
            transectA={transectA}
            transectB={transectB}
            accentColor={targetAccent}
            label={formatSiteFullName(target)}
            testId="three-target-canvas"
            linkCameras={link3dCameras}
            onCameraMove={handleCameraMove}
            registerSyncReceiver={registerSyncReceiver}
          />
        </div>
        <div className="relative w-full h-full">
          <SingleTerrainViewport
            side="analog"
            site={analog}
            layer3dMode={layer3dMode}
            colormap={colormap}
            verticalExaggeration={verticalExaggeration}
            sunAzimuthDeg={sunAzimuthDeg}
            hillshadeZFactor={hillshadeZFactor}
            showWireframe={show3dWireframe}
            transectA={transectA}
            transectB={transectB}
            accentColor="#8FA886"
            label={formatSiteFullName(analog)}
            testId="three-analog-canvas"
            linkCameras={link3dCameras}
            onCameraMove={handleCameraMove}
            registerSyncReceiver={registerSyncReceiver}
          />
        </div>
      </div>

      {/* Bottom-center 3D surface mode selector & camera/sun controls */}
      <div className="no-print fixed bottom-[68px] left-1/2 -translate-x-1/2 z-[690] flex items-center gap-2 rounded-xl bg-[#101217]/95 border border-white/12 px-3 py-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.55)] font-mono whitespace-nowrap">
        <div role="tablist" aria-label="3D terrain surface mode" className="flex items-center gap-1">
          {MODE_3D_OPTIONS.map((opt) => {
            const active = layer3dMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`terrain3d-mode-${opt.id}`}
                onClick={() => setLayer3dMode(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-[13px] cursor-pointer transition-colors ${
                  active
                    ? 'bg-white/18 text-[#F2F4F8] font-bold'
                    : 'text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/6'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="h-4 w-px bg-white/12 hidden sm:block" />

        <button
          type="button"
          onClick={() => setLink3dCameras(!link3dCameras)}
          aria-pressed={link3dCameras}
          data-testid="terrain3d-link-cameras"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[13px] cursor-pointer transition-colors ${
            link3dCameras
              ? 'bg-white/15 text-[#F2F4F8] font-semibold'
              : 'text-[#9AA3B2] hover:text-[#F2F4F8]'
          }`}
        >
          {link3dCameras ? <Link2 className="w-3.5 h-3.5" /> : <Link2Off className="w-3.5 h-3.5" />}
          <span>Link cameras</span>
        </button>

        <label className="hidden md:flex items-center gap-2 text-[13px] text-[#9AA3B2] pl-1">
          <Sun className="w-3.5 h-3.5" />
          <input
            type="range"
            min={0}
            max={360}
            step={5}
            aria-label="Sun azimuth degrees"
            value={sunAzimuthDeg}
            onChange={(e) => setSunAzimuthDeg(Number(e.target.value))}
            className="sci-slider w-16"
          />
          <span className="tabular-nums text-[#E2E6ED] w-10">{sunAzimuthDeg}°</span>
        </label>

        <span
          className="hidden sm:inline text-[13px] text-[#9AA3B2] tabular-nums pl-1"
          title="Vertical exaggeration"
        >
          Vertical exaggeration {verticalExaggeration.toFixed(1)}×
        </span>
      </div>

      <div
        aria-hidden={!showOrbitHint}
        className={`pointer-events-none absolute top-20 left-5 z-20 rounded-lg bg-[#101217]/88 px-3 py-1.5 text-[13px] text-[#9AA3B2] transition-opacity duration-500 ${
          showOrbitHint ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Drag to orbit · Scroll to zoom
      </div>
    </section>
  );
};
