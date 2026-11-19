// The right controller's pointer on the VR panel: a thin beam from the controller and a ring where it lands.
// (Babylon's own selection dot is only a few millimetres wide, which is invisible on a hand-sized panel.)
/* global BABYLON */
const B = () => window.BABYLON;

export class VrPointer {
  constructor(scene) {
    const BABYLON = B();
    this.scene = scene; this._s = new BABYLON.Vector3(); this._q = new BABYLON.Quaternion(); this._n = new BABYLON.Vector3(); this._t = new BABYLON.Vector3();
    const mat = (name, alpha) => {
      const m = new BABYLON.StandardMaterial(name, scene);
      m.disableLighting = true; m.diffuseColor = new BABYLON.Color3(0, 0, 0); m.specularColor = new BABYLON.Color3(0, 0, 0); m.fogEnabled = false; m.alpha = alpha; return m;
    };
    const style = (mesh) => { mesh.renderingGroupId = 3; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true; mesh.metadata = { noReflect: true }; mesh.setEnabled(false); };
    // the beam: a thin cylinder along +Z, 1 m long, stretched to the distance it needs
    this.beam = BABYLON.MeshBuilder.CreateCylinder('vrbeam', { diameter: 0.003, height: 1, tessellation: 8 }, scene);
    this.beam.rotation.x = Math.PI / 2; this.beam.position.z = 0.5; this.beam.bakeCurrentTransformIntoVertices();
    this.beamMat = mat('vrbeamm', 0.5); this.beamMat.emissiveColor = new BABYLON.Color3(1, 0.76, 0.24); this.beam.material = this.beamMat; style(this.beam);
    // the ring: a plane with a ring and dot drawn on it
    this.cursor = BABYLON.MeshBuilder.CreatePlane('vrcursor', { width: 0.036, height: 0.036 }, scene);
    const tex = new BABYLON.DynamicTexture('vrcursortex', { width: 128, height: 128 }, scene, true); tex.hasAlpha = true;
    const g = tex.getContext(); g.clearRect(0, 0, 128, 128);
    g.lineWidth = 16; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(64, 64, 42, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 9; g.strokeStyle = '#ffc23d'; g.beginPath(); g.arc(64, 64, 42, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(64, 64, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffc23d'; g.beginPath(); g.arc(64, 64, 10, 0, Math.PI * 2); g.fill();
    tex.update();
    const cm = mat('vrcursorm', 1); cm.emissiveTexture = tex; cm.opacityTexture = tex; cm.backFaceCulling = false; this.cursor.material = cm; style(this.cursor);
    this.tex = tex;
  }
  hide() { this.beam.setEnabled(false); this.cursor.setEnabled(false); }
  /**
   * ray: the controller's pointer ray (null = no pointer), panelMesh: the panel plane, pressed: trigger held.
   * Draws the beam and ring, and returns { uv, point, distance } when the beam lands on the panel (otherwise null).
   */
  update(ray, panelMesh, pressed) {
    const BABYLON = B();
    if (!ray || !panelMesh) { this.hide(); return null; }
    ray.length = 4;
    const pick = this.scene.pickWithRay(ray, (m) => m === panelMesh), hit = !!(pick && pick.hit && pick.pickedPoint);
    const start = 0.03, len = hit ? pick.distance : 0.45;
    this.beam.position.set(ray.origin.x + ray.direction.x * start, ray.origin.y + ray.direction.y * start, ray.origin.z + ray.direction.z * start);
    this._t.set(ray.origin.x + ray.direction.x * len, ray.origin.y + ray.direction.y * len, ray.origin.z + ray.direction.z * len);
    this.beam.lookAt(this._t); this.beam.scaling.z = Math.max(0.001, len - start);
    this.beam.setEnabled(true); this.beamMat.alpha = hit ? (pressed ? 0.95 : 0.65) : 0.22;
    if (!hit) { this.cursor.setEnabled(false); return null; }
    const wm = panelMesh.getWorldMatrix();
    BABYLON.Vector3.TransformNormalToRef(this._n.set(0, 0, -1), wm, this._n); this._n.normalize();     // the side you read it from
    this.cursor.position.set(pick.pickedPoint.x + this._n.x * 0.003, pick.pickedPoint.y + this._n.y * 0.003, pick.pickedPoint.z + this._n.z * 0.003);
    wm.decompose(this._s, this._q, undefined);
    if (!this.cursor.rotationQuaternion) this.cursor.rotationQuaternion = new BABYLON.Quaternion();
    this.cursor.rotationQuaternion.copyFrom(this._q);
    this.cursor.scaling.setAll(pressed ? 0.7 : 1); this.cursor.setEnabled(true);
    return { uv: pick.getTextureCoordinates(), point: pick.pickedPoint, distance: pick.distance };
  }
  dispose() { this.beam.dispose(false, true); this.cursor.dispose(false, true); this.tex.dispose(); }
}
