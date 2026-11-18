// Real-world dimensions (metres, FIBA) and session settings. Coordinates:
// +X to the shooter's right when facing the basket, +Y up, +Z toward the basket.
export const COURT_LENGTH = 28.0, COURT_WIDTH = 15.0;
export const BASKET_FROM_BASELINE = 1.575, BACKBOARD_FROM_BASELINE = 1.2, FT_LINE_FROM_BASELINE = 5.8;
export const RIM_HEIGHT_REGULATION = 3.05, RIM_INNER_R = 0.225, RIM_TUBE_R = 0.010;
export const BACKBOARD_W = 1.80, BACKBOARD_H = 1.05, BACKBOARD_BOTTOM_ABOVE_RIM = -0.15;
export const TARGET_BOX_W = 0.59, TARGET_BOX_H = 0.45, NET_LENGTH = 0.42;
export const BALL_RADII = { 5: 0.110, 6: 0.1153, 7: 0.1194 };
export const GRAVITY = 9.81;
export const basketZ = () => COURT_LENGTH / 2 - BASKET_FROM_BASELINE;
export const ftLineZ = () => COURT_LENGTH / 2 - FT_LINE_FROM_BASELINE;

export function defaultSettings() {
  return {
    player_height: 1.60, handedness: 'right', rim_height: RIM_HEIGHT_REGULATION, ball_size: 6,
    jersey_number: 7, jersey_color: [0.10, 0.28, 0.75], trim_color: [1.0, 0.80, 0.15],
    skin_color: [0.80, 0.60, 0.45], hair_color: [0.12, 0.08, 0.05],
    release_angle: null, backspin_rps: 2.5, playback_speed: 0.5, skill: 'shooting',
    shadows: true, crowd: true, reflections: true,
  };
}
export const ballRadius = (s) => BALL_RADII[s.ball_size] ?? BALL_RADII[6];
